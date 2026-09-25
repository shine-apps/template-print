import { app } from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import {
  UpdateManifestSchema,
  compareVersions,
  resolveDownloadUrl,
  type UpdateManifest,
  type CheckResultPayload,
  type UpdateProgressPayload,
  type InstallState,
  type InstallFailedPayload
} from '../../../shared/update-manifest'
import { UPDATE_BASE_URL } from '../../../shared/update-config'
import {
  streamDownload,
  DownloadCanceled,
  SizeMismatchError,
  electronNetRequest,
  type DownloadRequestFn
} from '../update/downloader'
import { verifySha256 } from '../update/checksum'
import { buildGuardianScript, type GuardianParams } from '../update/guardian-script'
import { loadSettings, saveSettings, type AppSettings } from '../settings'

export type UpdateChannel =
  | 'update:checkResult' | 'update:progress' | 'update:installFailed' | 'update:installed'

type HttpGetText = (url: string, timeoutMs: number) => Promise<string>
type Listener = (payload: unknown) => void

export interface UpdateServiceDeps {
  dataDir: string
  currentVersion: string
  isPackaged: boolean
  baseUrl: string
  requestFn: DownloadRequestFn
  /** undefined=用内置 electron net 拉 JSON */
  httpGetText?: HttpGetText
  now: () => number
  sleep: (ms: number) => Promise<void>
  quit: () => void
  spawnGuardian: (scriptPath: string) => void
}

const DAY_MS = 24 * 3600 * 1000

/** 用 Electron net 拉文本（8s 超时，自动代理） */
async function netGetText(url: string, timeoutMs: number): Promise<string> {
  const { net } = await import('electron')
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    const chunks: Buffer[] = []
    const timer = setTimeout(() => req.abort(), timeoutMs)
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer)
        ;(res as unknown as { destroy?: () => void }).destroy?.()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.on('data', (c: Buffer) => chunks.push(c as Buffer))
      res.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf-8')) })
      res.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
    })
    req.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
    req.end()
  })
}

export class UpdateService {
  private listeners = new Map<UpdateChannel, Set<Listener>>()
  private latest: UpdateManifest | null = null
  private abort: AbortController | null = null
  private readyFile: string | null = null
  private readonly updatesDir: string
  private readonly downloadsDir: string
  private readonly stateFile: string

  constructor(private deps: UpdateServiceDeps) {
    this.updatesDir = join(deps.dataDir, 'updates')
    this.downloadsDir = join(this.updatesDir, 'downloads')
    this.stateFile = join(this.updatesDir, 'install-state.json')
    mkdirSync(this.downloadsDir, { recursive: true })
  }

  static createDefault(dataDir: string): UpdateService {
    return new UpdateService({
      dataDir,
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      baseUrl: UPDATE_BASE_URL,
      requestFn: electronNetRequest,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      quit: () => app.quit(),
      spawnGuardian: (scriptPath) => {
        spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], {
          detached: true, stdio: 'ignore', windowsHide: true
        }).unref()
      }
    })
  }

  on(channel: UpdateChannel, fn: Listener): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set())
    this.listeners.get(channel)!.add(fn)
    return () => { this.listeners.get(channel)?.delete(fn) }
  }
  private emit(channel: UpdateChannel, payload: unknown): void {
    this.listeners.get(channel)?.forEach((fn) => fn(payload))
  }
  private emitProgress(p: UpdateProgressPayload): void {
    this.emit('update:progress', p)
  }

  // ---------- 检查 ----------
  /** 纯决策：dev/关开关/24h 内均不自动检查 */
  shouldAutoCheck(s: Pick<AppSettings, 'autoCheckUpdates' | 'lastUpdateCheckAt'>, now: number): boolean {
    if (!this.deps.isPackaged) return false
    if (!s.autoCheckUpdates) return false
    if (s.lastUpdateCheckAt && now - s.lastUpdateCheckAt < DAY_MS) return false
    return true
  }

  startAutoCheck(): void {
    const s = loadSettings(this.deps.dataDir)
    if (!this.shouldAutoCheck(s, this.deps.now())) return
    setTimeout(() => { void this.check(false) }, 3000)
  }

  async check(manual: boolean): Promise<void> {
    let manifest: UpdateManifest
    try {
      const getText = this.deps.httpGetText ?? netGetText
      const text = await getText(resolveDownloadUrl(this.deps.baseUrl, 'latest.json'), 8000)
      manifest = UpdateManifestSchema.parse(JSON.parse(text))
    } catch (e) {
      const msg = (e as Error).message ?? ''
      const reason = e instanceof SyntaxError || /expected|invalid|zod|unexpected/i.test(msg)
        ? 'bad-manifest'
        : 'net-error'
      if (manual) this.emit('update:checkResult', { hasUpdate: false, manual, reason } satisfies CheckResultPayload)
      return
    }
    const s = loadSettings(this.deps.dataDir)
    s.lastUpdateCheckAt = this.deps.now()
    saveSettings(this.deps.dataDir, s)

    if (compareVersions(manifest.version, this.deps.currentVersion) <= 0) {
      if (manual) this.emit('update:checkResult', { hasUpdate: false, manual, reason: 'up-to-date' })
      return
    }
    if (!manual && s.skippedUpdateVersion === manifest.version) return
    this.latest = manifest
    this.emit('update:checkResult', { hasUpdate: true, manual, manifest } satisfies CheckResultPayload)
  }

  async skipVersion(version: string | null): Promise<void> {
    const s = loadSettings(this.deps.dataDir)
    s.skippedUpdateVersion = version
    saveSettings(this.deps.dataDir, s)
  }

  // ---------- 下载 + 校验 ----------
  private filePaths(version: string): { part: string; final: string } {
    return {
      part: join(this.downloadsDir, `Setup-${version}.exe.part`),
      final: join(this.downloadsDir, `Setup-${version}.exe`)
    }
  }

  async download(): Promise<void> {
    if (!this.latest) {
      this.emitProgress({ phase: 'error', reason: 'no-manifest' })
      return
    }
    if (this.readyFile || this.abort) return
    const m = this.latest
    const { part, final } = this.filePaths(m.version)
    this.abort = new AbortController()
    try {
      await streamDownload({
        url: resolveDownloadUrl(this.deps.baseUrl, m.url),
        partPath: part,
        finalPath: final,
        expectedSize: m.size,
        requestFn: this.deps.requestFn,
        signal: this.abort.signal,
        sleep: this.deps.sleep,
        onProgress: (p) => this.emitProgress({ phase: 'downloading', ...p })
      })
      this.emitProgress({ phase: 'verifying' })
      const ok = await verifySha256(final, m.sha256)
      if (!ok) {
        rmSync(final, { force: true })
        this.emitProgress({ phase: 'error', reason: 'checksum-mismatch' })
        return
      }
      this.readyFile = final
      this.emitProgress({ phase: 'ready', version: m.version })
    } catch (e) {
      if (e instanceof DownloadCanceled) {
        this.emitProgress({ phase: 'canceled' })
      } else if (e instanceof SizeMismatchError) {
        this.emitProgress({ phase: 'error', reason: 'size-mismatch' })
      } else {
        this.emitProgress({ phase: 'error', reason: 'download-failed' })
      }
    } finally {
      this.abort = null
    }
  }

  cancelDownload(): void {
    this.abort?.abort()
  }

  // ---------- 安装 ----------
  async install(): Promise<void> {
    if (!this.latest) {
      this.emitProgress({ phase: 'error', reason: 'no-manifest' })
      return
    }
    const m = this.latest
    const final = this.readyFile ?? this.filePaths(m.version).final
    if (!existsSync(final) || !(await verifySha256(final, m.sha256))) {
      this.emitProgress({ phase: 'error', reason: 'checksum-mismatch' })
      return
    }

    if (!this.deps.isPackaged) {
      // dev 不退出、不跑安装器
      this.emitProgress({ phase: 'simulated', version: m.version })
      return
    }

    const params: GuardianParams = {
      setupPath: final,
      exePath: process.execPath,
      statePath: this.stateFile,
      backupDir: join(this.updatesDir, `backup-${this.deps.currentVersion}`),
      logPath: join(this.updatesDir, 'guardian.log'),
      fromVersion: this.deps.currentVersion,
      toVersion: m.version
    }
    const state: InstallState = {
      from: params.fromVersion, to: params.toVersion, phase: 'installing', reason: null, ts: this.deps.now()
    }
    mkdirSync(this.updatesDir, { recursive: true })
    writeFileSync(join(this.updatesDir, 'guardian.ps1'), buildGuardianScript(), 'ascii')
    writeFileSync(join(this.updatesDir, 'guardian-params.json'), JSON.stringify(params, null, 2), 'utf-8')
    writeFileSync(this.stateFile, JSON.stringify(state), 'utf-8')
    this.deps.spawnGuardian(join(this.updatesDir, 'guardian.ps1'))
    this.deps.quit()
  }

  /** 启动时读取上次安装结果：done→清理备份+通知；failed/滞留 installing→失败通知 */
  async handleInstallState(): Promise<void> {
    if (!existsSync(this.stateFile)) return
    let st: InstallState
    try {
      st = JSON.parse(readFileSync(this.stateFile, 'utf-8')) as InstallState
    } catch {
      rmSync(this.stateFile, { force: true })
      return
    }
    if (st.phase === 'done') {
      this.pruneBackups()
      rmSync(this.stateFile, { force: true })
      this.emit('update:installed', { version: st.to })
    } else {
      const reason = st.phase === 'installing' ? 'interrupted' : (st.reason ?? 'installer-failed')
      rmSync(this.stateFile, { force: true })
      this.emit('update:installFailed', { from: st.from, to: st.to, reason } satisfies InstallFailedPayload)
    }
  }

  /** 只保留最近一个 backup-* 目录 */
  private pruneBackups(): void {
    const dirs = readdirSync(this.updatesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('backup-'))
      .map((d) => ({ name: d.name, mtime: statSync(join(this.updatesDir, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const d of dirs.slice(1)) rmSync(join(this.updatesDir, d.name), { recursive: true, force: true })
  }

  get logDir(): string {
    return this.updatesDir
  }
}
