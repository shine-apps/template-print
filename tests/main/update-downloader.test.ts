import { describe, it, expect, beforeAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, existsSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import {
  streamDownload,
  nodeHttpRequest,
  parseContentRange,
  DownloadCanceled,
  SizeMismatchError
} from '../../electron/main/update/downloader'

const dir = join(tmpdir(), `tp-dl-${Date.now()}-${Math.random().toString(36).slice(2)}`)
beforeAll(() => mkdirSync(dir, { recursive: true }))

const body = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(200)) // 7000 字节

/** 支持 Range 的静态服务器；recordRange 记录每次请求的 Range 头 */
function rangeServer(recordRange: (r: string | undefined) => void, opts?: { ignoreRange?: boolean }): Server {
  return createServer((req, res) => {
    recordRange(req.headers.range)
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
    if (m && !opts?.ignoreRange) {
      const start = Number(m[1])
      if (start >= body.length) { res.statusCode = 416; res.end(); return }
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${body.length - 1}/${body.length}`)
      res.setHeader('Accept-Ranges', 'bytes')
      res.end(body.subarray(start))
    } else {
      res.statusCode = 200
      res.setHeader('Content-Length', String(body.length))
      res.setHeader('Accept-Ranges', 'bytes')
      res.end(body)
    }
  })
}

async function listen(s: Server): Promise<string> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/setup.exe`
}

function unique(p: string): string {
  return join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${p}`)
}

describe('parseContentRange', () => {
  it('解析总大小', () => {
    expect(parseContentRange('bytes 100-199/1000')).toBe(1000)
    expect(parseContentRange('bytes 0-99/*')).toBeNull()
    expect(parseContentRange(undefined)).toBeNull()
  })
})

describe('streamDownload（node http 打桩）', () => {
  it('首次全量下载，进度 total 正确，落盘字节一致', async () => {
    const ranges: (string | undefined)[] = []
    const s = rangeServer((r) => ranges.push(r))
    const url = await listen(s)
    const part = unique('setup.part'); const final = unique('setup.exe')
    const progress: { downloaded: number; total: number | null }[] = []
    const r = await streamDownload({
      url, partPath: part, finalPath: final,
      requestFn: nodeHttpRequest,
      signal: new AbortController().signal,
      onProgress: (p) => progress.push({ downloaded: p.downloaded, total: p.total }),
      sleep: async () => {}
    })
    s.close()
    expect(r.bytes).toBe(body.length)
    expect(readFileSync(r.path)).toEqual(body)
    expect(progress[progress.length - 1].total).toBe(body.length)
    expect(ranges[0]).toBeUndefined()
    expect(existsSync(part)).toBe(false)
  })

  it('取消后保留 .part；再次下载带 Range 续传且字节完整', async () => {
    const ranges: (string | undefined)[] = []
    const s = rangeServer((r) => ranges.push(r))
    const url = await listen(s)
    const part = unique('setup.part'); const final = unique('setup.exe')

    // 手工造一个 3000 字节的 .part（与服务器前 3000 字节相同）
    writeFileSync(part, body.subarray(0, 3000))
    const ac = new AbortController()
    // 延迟请求，让取消确定性地发生在请求发出之前（生产环境用户取消发生在下载途中，由流上的 abort 监听处理）
    const delayedRequest: typeof nodeHttpRequest = async (u, r, sig) => {
      await new Promise((res) => setTimeout(res, 50))
      return nodeHttpRequest(u, r, sig)
    }
    const p = streamDownload({
      url, partPath: part, finalPath: final,
      requestFn: delayedRequest, signal: ac.signal, sleep: async () => {}
    })
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(DownloadCanceled)
    expect(existsSync(part)).toBe(true)

    const r = await streamDownload({
      url, partPath: part, finalPath: final,
      requestFn: nodeHttpRequest, signal: new AbortController().signal,
      sleep: async () => {}
    })
    s.close()
    // 存在 .part → 续传请求必须带 Range
    expect(ranges.some((x) => x === 'bytes=3000-')).toBe(true)
    expect(readFileSync(r.path)).toEqual(body)
  })

  it('服务器忽略 Range（回 200）时删除 .part 重新全量下载', async () => {
    const s = rangeServer(() => {}, { ignoreRange: true })
    const url = await listen(s)
    const part = unique('setup.part'); const final = unique('setup.exe')
    writeFileSync(part, body.subarray(0, 100)) // 故意只放 100 字节
    const r = await streamDownload({
      url, partPath: part, finalPath: final,
      requestFn: nodeHttpRequest,
      signal: new AbortController().signal,
      sleep: async () => {}
    })
    s.close()
    expect(readFileSync(r.path)).toEqual(body)
    expect(statSync(r.path).size).toBe(body.length)
  })

  it('声明大小不符抛 SizeMismatchError', async () => {
    const s = rangeServer(() => {})
    const url = await listen(s)
    await expect(streamDownload({
      url, partPath: unique('setup.part'), finalPath: unique('setup.exe'),
      expectedSize: body.length + 1,
      requestFn: nodeHttpRequest,
      signal: new AbortController().signal,
      sleep: async () => {}
    })).rejects.toBeInstanceOf(SizeMismatchError)
    s.close()
  })

  it('服务器 500 → 重试耗尽后抛错（sleep 注入，不真实等待）', async () => {
    const s = createServer((_req, res) => { res.statusCode = 500; res.end() })
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/x`
    let attempts = 0
    await expect(streamDownload({
      url, partPath: unique('setup.part'), finalPath: unique('setup.exe'),
      requestFn: async (u, rangeStart, signal) => {
        attempts++
        return nodeHttpRequest(u, rangeStart, signal)
      },
      signal: new AbortController().signal,
      retries: 2,
      sleep: async () => {}
    })).rejects.toThrow(/HTTP 500/)
    s.close()
    expect(attempts).toBe(3)
  })
})
