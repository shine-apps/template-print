import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { UpdateService, type UpdateServiceDeps } from '../../electron/main/services/update-service'
import { nodeHttpRequest, type DownloadRequestFn } from '../../electron/main/update/downloader'
import type { CheckResultPayload, UpdateProgressPayload } from '../../shared/update-manifest'

let dir: string
beforeEach(() => {
  dir = join(tmpdir(), `tp-usvc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, 'updates', 'downloads'), { recursive: true })
})

const body = Buffer.from('fake-installer-bytes-'.repeat(500))
const sha = createHash('sha256').update(body).digest('hex')
const manifest = {
  version: '9.9.9',
  releaseDate: '2026-09-25',
  releaseNotes: '测试更新\n- 一条',
  url: 'setup.exe',
  size: body.length,
  sha256: sha
}

/** node http 拉文本（测试替代 electron net） */
function nodeGetText(url: string, _timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        nodeGetText(new URL(res.headers.location, url).toString(), _timeoutMs).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c as Buffer))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

async function startFileServer(template: Record<string, unknown> = manifest): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
    if (req.url === '/latest.json') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(template))
    } else if (m) {
      const start = Number(m[1])
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${body.length - 1}/${body.length}`)
      res.end(body.subarray(start))
    } else {
      res.statusCode = 200
      res.end(body)
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return { server, base: `http://127.0.0.1:${port}/` }
}

function makeSvc(base: string, opts?: { version?: string }): {
  svc: UpdateService
  events: { channel: string; payload: unknown }[]
} {
  const events: { channel: string; payload: unknown }[] = []
  const deps: UpdateServiceDeps = {
    dataDir: dir,
    currentVersion: opts?.version ?? '0.1.0',
    isPackaged: false,
    baseUrl: base,
    requestFn: nodeHttpRequest as DownloadRequestFn,
    httpGetText: nodeGetText,
    now: () => Date.now(),
    sleep: async () => {},
    quit: () => {},
    spawnGuardian: () => { throw new Error('dev 不应启动守护脚本') }
  }
  const svc = new UpdateService(deps)
  svc.on('update:checkResult', (p) => events.push({ channel: 'update:checkResult', payload: p }))
  svc.on('update:progress', (p) => events.push({ channel: 'update:progress', payload: p }))
  svc.on('update:installFailed', (p) => events.push({ channel: 'update:installFailed', payload: p }))
  svc.on('update:installed', (p) => events.push({ channel: 'update:installed', payload: p }))
  return { svc, events }
}

describe('UpdateService.check', () => {
  it('发现新版本 → checkResult 携带清单；更高本地版本手动检查 → up-to-date', async () => {
    const { server, base } = await startFileServer()
    const { svc, events } = makeSvc(base)
    await svc.check(true)
    const r1 = events.map((e) => e.payload as CheckResultPayload).find((p) => p.hasUpdate)!
    expect(r1.manifest?.version).toBe('9.9.9')

    const s2 = makeSvc(base, { version: '99.0.0' })
    await s2.svc.check(true)
    const r2 = s2.events.map((e) => e.payload as CheckResultPayload).at(-1)!
    expect(r2.hasUpdate).toBe(false)
    expect(r2.reason).toBe('up-to-date')
    server.close()
  })

  it('跳过的版本：自动检查静默，手动仍可见', async () => {
    const { server, base } = await startFileServer()
    const { svc, events } = makeSvc(base)
    await svc.skipVersion('9.9.9')
    await svc.check(false)
    expect(events.some((e) => e.channel === 'update:checkResult')).toBe(false)
    await svc.check(true)
    expect(events.some((e) => (e.payload as CheckResultPayload).hasUpdate === true)).toBe(true)
    server.close()
  })

  it('网络失败：自动静默；手动给 net-error', async () => {
    const { svc, events } = makeSvc('http://127.0.0.1:1/')
    await svc.check(false)
    expect(events.length).toBe(0)
    await svc.check(true)
    expect((events.at(-1)!.payload as CheckResultPayload).reason).toBe('net-error')
  })

  it('坏清单 → bad-manifest', async () => {
    const server = createServer((_req, res) => res.end('{bad'))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    const { svc, events } = makeSvc(base)
    await svc.check(true)
    expect((events.at(-1)!.payload as CheckResultPayload).reason).toBe('bad-manifest')
    server.close()
  })

  it('检查时间戳被记录到 settings', async () => {
    const { server, base } = await startFileServer()
    const { svc } = makeSvc(base)
    const before = Date.now()
    await svc.check(false)
    const s = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))
    expect(s.lastUpdateCheckAt).toBeGreaterThanOrEqual(before)
    server.close()
  })
})

describe('UpdateService 下载/校验/安装', () => {
  it('download 全链路：downloading→verifying→ready；dev install 发 simulated 不退出', async () => {
    const { server, base } = await startFileServer()
    const { svc, events } = makeSvc(base)
    await svc.check(false)
    await svc.download()
    const phases = events
      .filter((e) => e.channel === 'update:progress')
      .map((e) => (e.payload as UpdateProgressPayload).phase)
    expect(phases).toContain('verifying')
    expect(phases.at(-1)).toBe('ready')
    await svc.install()
    const sim = events.map((e) => e.payload as UpdateProgressPayload).find((p) => p.phase === 'simulated')
    expect(sim?.version).toBe('9.9.9')
    server.close()
  })

  it('sha 不符 → error(checksum-mismatch) 且残包被删', async () => {
    const bad = { ...manifest, sha256: 'f'.repeat(64) }
    const { server, base } = await startFileServer(bad)
    const { svc, events } = makeSvc(base)
    await svc.check(false)
    await svc.download()
    const err = events.map((e) => e.payload as UpdateProgressPayload).find((p) => p.phase === 'error')
    expect(err?.reason).toBe('checksum-mismatch')
    expect(existsSync(join(dir, 'updates', 'downloads', 'Setup-9.9.9.exe'))).toBe(false)
    server.close()
  })

  it('cancel 后发 canceled 且保留 .part', async () => {
    const { server, base } = await startFileServer()
    const { svc, events } = makeSvc(base)
    writeFileSync(join(dir, 'updates', 'downloads', 'Setup-9.9.9.exe.part'), body.subarray(0, 20))
    await svc.check(false)
    const p = svc.download()
    svc.cancelDownload()
    await p.catch(() => {})
    expect(
      events.map((e) => e.payload as UpdateProgressPayload).some((x) => x.phase === 'canceled')
    ).toBe(true)
    expect(existsSync(join(dir, 'updates', 'downloads', 'Setup-9.9.9.exe.part'))).toBe(true)
    server.close()
  })
})

describe('UpdateService 安装状态与自动检查节流', () => {
  it('done 状态 → installed 事件并清状态文件；failed → installFailed', async () => {
    const { server, base } = await startFileServer()
    const { svc, events } = makeSvc(base)
    const stateFile = join(dir, 'updates', 'install-state.json')
    writeFileSync(stateFile, JSON.stringify({ from: '0.1.0', to: '9.9.9', phase: 'done', reason: null, ts: 1 }))
    await svc.handleInstallState()
    expect(
      events.map((e) => e.payload).some((p) => (p as { version?: string }).version === '9.9.9')
    ).toBe(true)
    expect(existsSync(stateFile)).toBe(false)
    server.close()

    const s2 = makeSvc(base)
    writeFileSync(
      join(dir, 'updates', 'install-state.json'),
      JSON.stringify({ from: '0.1.0', to: '9.9.9', phase: 'failed', reason: 'installer-failed', ts: 1 })
    )
    await s2.svc.handleInstallState()
    expect(s2.events.map((e) => e.channel)).toContain('update:installFailed')
    const payload = s2.events
      .map((e) => e.payload)
      .find((p) => (p as { from?: string }).from === '0.1.0') as { reason: string }
    expect(payload.reason).toBe('installer-failed')
  })

  it('滞留 installing → interrupted', async () => {
    const { server, base } = await startFileServer()
    const { svc, events } = makeSvc(base)
    writeFileSync(
      join(dir, 'updates', 'install-state.json'),
      JSON.stringify({ from: '0.1.0', to: '9.9.9', phase: 'installing', reason: null, ts: 1 })
    )
    await svc.handleInstallState()
    const p = events.map((e) => e.payload).at(-1) as { reason: string }
    expect(p.reason).toBe('interrupted')
    server.close()
  })

  it('shouldAutoCheck：关开关/24h内不查；null时间戳/超过24h 可查；dev 恒 false', () => {
    const { svc } = makeSvc('http://x/')
    const t = 1_000_000_000_000
    // dev（isPackaged=false）恒不自动检查
    expect(svc.shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: null }, t)).toBe(false)
    expect(svc.shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: t - 25 * 3600_000 }, t)).toBe(false)

    // 打包态：验证节流与开关逻辑
    const packaged = new UpdateService({
      dataDir: join(dir, 'pkg'),
      currentVersion: '0.1.0',
      isPackaged: true,
      baseUrl: 'http://x/',
      requestFn: nodeHttpRequest,
      httpGetText: nodeGetText,
      now: () => t,
      sleep: async () => {},
      quit: () => {},
      spawnGuardian: () => {}
    })
    expect(packaged.shouldAutoCheck({ autoCheckUpdates: false, lastUpdateCheckAt: null }, t)).toBe(false)
    expect(packaged.shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: t - 1000 }, t)).toBe(false)
    expect(packaged.shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: null }, t)).toBe(true)
    expect(packaged.shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: t - 25 * 3600_000 }, t)).toBe(true)
  })
})

