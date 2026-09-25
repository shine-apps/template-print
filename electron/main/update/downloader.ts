import { rm, rename, stat } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage } from 'node:http'

export interface DownloadProgress {
  downloaded: number
  total: number | null
  bytesPerMs: number
}

/** 底层 HTTP 响应的最小抽象（node:http 与 Electron net 的 IncomingMessage 都满足） */
export interface DownloadHttpResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  /** 原始可读流（供 stream.pipeline 写盘） */
  stream: IncomingMessage
  onData(cb: (chunk: Buffer) => void): void
  onEnd(cb: () => void): void
  onError(cb: (err: Error) => void): void
  destroy(): void
}

export type DownloadRequestFn = (
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
) => Promise<DownloadHttpResponse>

export class DownloadCanceled extends Error {
  constructor() { super('download-canceled'); this.name = 'DownloadCanceled' }
}
export class SizeMismatchError extends Error {
  constructor(actual: number, expected: number) {
    super(`size-mismatch: ${actual} != ${expected}`); this.name = 'SizeMismatchError'
  }
}
export class DownloadIdleError extends Error {
  constructor() { super('download-idle-timeout'); this.name = 'DownloadIdleError' }
}

/** Content-Range: bytes start-end/total → total；无法解析返回 null */
export function parseContentRange(v: string | undefined): number | null {
  if (!v) return null
  const m = /^bytes \d+-\d+\/(\d+|\*)$/.exec(v.trim())
  if (!m || m[1] === '*') return null
  return Number(m[1])
}

function headerString(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name.toLowerCase()] ?? h[name]
  return Array.isArray(v) ? v[0] : v
}

type RawResponse = Pick<IncomingMessage, 'statusCode' | 'headers' | 'on' | 'destroy'>

function adapt(res: RawResponse): DownloadHttpResponse {
  return {
    statusCode: res.statusCode ?? 0,
    headers: res.headers,
    stream: res as unknown as IncomingMessage,
    onData: (cb) => res.on('data', (c) => cb(c as Buffer)),
    onEnd: (cb) => res.on('end', cb),
    onError: (cb) => res.on('error', cb),
    destroy: () => res.destroy()
  }
}

/** 生产请求函数：Electron net（自动走系统代理）；动态 import 避免测试环境加载 electron */
export async function electronNetRequest(
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
): Promise<DownloadHttpResponse> {
  if (signal.aborted) throw new DownloadCanceled()
  const { net } = await import('electron')
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    if (rangeStart !== null) req.setHeader('Range', `bytes=${rangeStart}-`)
    signal.addEventListener('abort', () => {
      req.abort()
      reject(new DownloadCanceled())
    }, { once: true })
    req.on('response', (res) => resolve(adapt(res as unknown as RawResponse)))
    req.on('error', (err: Error) => reject(signal.aborted ? new DownloadCanceled() : err))
    req.end()
  })
}

/** 测试请求函数：node 原生 http(s)，跟随 3xx 跳转一层 */
export function nodeHttpRequest(
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
): Promise<DownloadHttpResponse> {
  if (signal.aborted) return Promise.reject(new DownloadCanceled())
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { headers: rangeStart !== null ? { Range: `bytes=${rangeStart}-` } : {} }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        nodeHttpRequest(new URL(res.headers.location, url).toString(), rangeStart, signal).then(resolve, reject)
        return
      }
      resolve(adapt(res))
    })
    req.on('error', (err) => reject(signal.aborted ? new DownloadCanceled() : err))
    signal.addEventListener('abort', () => req.destroy(new DownloadCanceled() as Error), { once: true })
  })
}

export interface StreamDownloadOptions {
  url: string
  partPath: string
  finalPath: string
  expectedSize?: number
  requestFn: DownloadRequestFn
  signal: AbortSignal
  onProgress?: (p: DownloadProgress) => void
  /** 重试次数（不含首次），默认 2（共 3 次尝试） */
  retries?: number
  /** 两次数据之间最长等待（毫秒），超时重试；默认 30s */
  idleMs?: number
  sleep?: (ms: number) => Promise<void>
}

const BACKOFF = [500, 1500, 4000]

/**
 * 断点续传下载：
 * 有 .part 发 Range；206→追加；200/其他→删 .part 全量重下。
 * pipeline 处理背压；网络错误/5xx/空闲超时退避重试；abort → DownloadCanceled（保留 .part）。
 * 完成后 expectedSize 软校验（SizeMismatchError 不重试），.part 重命名为最终文件。
 */
export async function streamDownload(opts: StreamDownloadOptions): Promise<{ path: string; bytes: number }> {
  const {
    url, partPath, finalPath, expectedSize, requestFn, signal, onProgress,
    retries = 2,
    idleMs = 30000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  } = opts
  let lastErr: Error | undefined

  for (let attempt = 0; attempt < retries + 1; attempt++) {
    if (signal.aborted) throw new DownloadCanceled()
    try {
      const resumeFrom = existsSync(partPath) ? (await stat(partPath)).size : 0
      const res = await requestFn(url, resumeFrom > 0 ? resumeFrom : null, signal)

      let append: boolean
      let startOffset: number
      let total: number | null
      if (res.statusCode === 206 && resumeFrom > 0) {
        append = true
        startOffset = resumeFrom
        total = parseContentRange(headerString(res.headers, 'content-range'))
      } else if (res.statusCode === 200) {
        append = false
        startOffset = 0
        const cl = Number(headerString(res.headers, 'content-length'))
        total = Number.isFinite(cl) ? cl : null
      } else {
        res.destroy()
        throw new Error(`HTTP ${res.statusCode}`)
      }

      await rm(finalPath, { force: true })
      let downloaded = startOffset
      const t0 = Date.now()
      let lastEmit = 0
      let lastDataAt = Date.now()
      const raw = res.stream

      // 进度监听（独立于 pipeline，不干扰背压）
      raw.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        lastDataAt = Date.now()
        const now = Date.now()
        if (onProgress && now - lastEmit >= 200) {
          lastEmit = now
          const elapsed = Math.max(1, now - t0)
          onProgress({ downloaded, total, bytesPerMs: downloaded / elapsed })
        }
      })

      const out = createWriteStream(partPath, { flags: append ? 'a' : 'w' })
      // 空闲超时：长时间无数据则销毁流进入重试
      const idleWatcher = setInterval(() => {
        if (Date.now() - lastDataAt > idleMs) raw.destroy(new DownloadIdleError())
      }, 1000)
      signal.addEventListener('abort', () => raw.destroy(new DownloadCanceled()), { once: true })

      try {
        await pipeline(raw, out)
      } finally {
        clearInterval(idleWatcher)
      }

      if (signal.aborted) throw new DownloadCanceled()
      onProgress?.({ downloaded, total, bytesPerMs: downloaded / Math.max(1, Date.now() - t0) })

      if (expectedSize !== undefined && downloaded !== expectedSize) {
        await rm(partPath, { force: true })
        throw new SizeMismatchError(downloaded, expectedSize)
      }
      await rm(finalPath, { force: true })
      await rename(partPath, finalPath)
      return { path: finalPath, bytes: downloaded }
    } catch (e) {
      lastErr = e as Error
      if (e instanceof DownloadCanceled) throw e
      if (e instanceof SizeMismatchError) throw e
      if (attempt === retries) break
      await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)])
    }
  }
  throw lastErr ?? new Error('download-failed')
}
