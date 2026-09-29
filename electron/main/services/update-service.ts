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
import { UPDATE_BASE_URLS, updateRequestHeaders } from '../../../shared/update-config'
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
  /** 候选更新源，按优先级排列；check() 依次尝试，下载按命中的源解析相对地址 */
  baseUrls: string[]
  requestFn: DownloadRequestFn
  /** undefined=用内置 electron net 拉 JSON */
  httpGetText?: HttpGetText
  now: () => number
  sleep: (ms: number) => Promise<void>
  quit: () => void
  spawnGuardian: (scriptPath: string) => void
}

const DAY_MS = 24 * 3600 * 1000

/**
 * 从清单 URL 提取安装包的真实文件后缀（含点、小写，如 '.msi' / '.exe'）。
 * 规则：下载地址是什么后缀，落地文件就用什么后缀；URL 无后缀时返回 ''，
 * 绝不臆造默认后缀（安装方式由 guardian 读文件头魔数 + 后缀双重判定）。
 * URL 允许是相对地址或带 query（?...），故先经 URL 解析取 pathname。
 * 仅接受形如 .xxx 的短字母数字后缀，防止异常 URL 把路径分隔符带进文件名。
 */
function setupExt(url: string): string {
  let pathname: string
  try {
    pathname = new URL(url, 'http://localhost/').pathname
  } catch {
    return ''
  }
  const base = pathname.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  const ext = base.slice(dot).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}

/** 用 Electron net 拉文本（8s 超时，自动代理） */
async function netGetText(url: string, timeoutMs: number): Promise<string> {
  const { net } = await import('electron')
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    for (const [name, value] of Object.entries(updateRequestHeaders())) req.setHeader(name, value)
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
  /** 命中清单的更新源，用于解析清单里的相对安装包地址 */
  private latestBase = ''
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
      baseUrls: [...UPDATE_BASE_URLS],
      requestFn: electronNetRequest,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      quit: () => app.quit(),
      spawnGuardian: (launcherCmd) => {
        // spawn cmd.exe 而非直接 spawn powershell.exe：cmd 跑完 launch-guardian.cmd 会立即 exit，
        // PowerShell 完全脱离 Electron 的进程树（包括 Windows Job Object 牵连），
        // 即使父进程在 spawn 返回后立刻退出也不会被系统杀掉。
        spawn('cmd.exe', ['/c', launcherCmd], {
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
    const getText = this.deps.httpGetText ?? netGetText
    let manifest: UpdateManifest | null = null
    let source = ''
    // 依次尝试候选源（国内镜像优先，失败回退 GitHub）：首个能拿到合法清单的源胜出
    let reason = 'net-error'
    for (const base of this.deps.baseUrls) {
      try {
        const text = await getText(resolveDownloadUrl(base, 'latest.json'), 8000)
        manifest = UpdateManifestSchema.parse(JSON.parse(text))
        source = base
        break
      } catch (e) {
        const msg = (e as Error).message ?? ''
        reason = e instanceof SyntaxError || /expected|invalid|zod|unexpected/i.test(msg)
          ? 'bad-manifest'
          : 'net-error'
      }
    }
    if (!manifest) {
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
    this.latestBase = source
    this.emit('update:checkResult', { hasUpdate: true, manual, manifest } satisfies CheckResultPayload)
  }

  async skipVersion(version: string | null): Promise<void> {
    const s = loadSettings(this.deps.dataDir)
    s.skippedUpdateVersion = version
    saveSettings(this.deps.dataDir, s)
  }

  // ---------- 下载 + 校验 ----------
  private filePaths(version: string): { part: string; final: string } {
    // 后缀完全沿用清单 URL 中安装包的真实后缀（.msi 就存 .msi，.exe 就存 .exe），
    // 不做任何默认假设；无后缀 URL 落地为无后缀文件。
    // 安装分派由 guardian 读文件头魔数 + 后缀双重判定，错误后缀/无后缀也能走对分支。
    const ext = this.latest ? setupExt(this.latest.url) : ''
    return {
      part: join(this.downloadsDir, `Setup-${version}${ext}.part`),
      final: join(this.downloadsDir, `Setup-${version}${ext}`)
    }
  }

  async download(): Promise<void> {
    if (!this.latest) {
      this.emitProgress({ phase: 'error', reason: 'no-manifest' })
      return
    }
    // 已下载校验通过（如用户上次在安装确认点了取消）→ 直接重新进入安装确认
    if (this.readyFile) {
      this.emitProgress({ phase: 'ready', version: this.latest.version })
      return
    }
    if (this.abort) return
    const m = this.latest
    const { part, final } = this.filePaths(m.version)
    this.abort = new AbortController()
    try {
      await streamDownload({
        url: resolveDownloadUrl(this.latestBase || this.deps.baseUrls[0], m.url),
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
    const ps1Path = join(this.updatesDir, 'guardian.ps1')
    const cmdPath = join(this.updatesDir, 'launch-guardian.cmd')
    writeFileSync(ps1Path, buildGuardianScript(), 'ascii')
    // 3 行纯 ASCII .cmd：cd 到自身目录（%~dp0），相对路径调 guardian.ps1
    // 好处：①路径里有中文（如"模板打印"）也不会被 ASCII 编码吃掉
    //       ②cmd.exe 跑完立即 exit，PowerShell 完全脱离 Electron 进程树（含 Job Object 牵连）
    writeFileSync(
      cmdPath,
      '@echo off\r\ncd /d "%~dp0"\r\npowershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "guardian.ps1"\r\nexit /b 0\r\n',
      'ascii'
    )
    writeFileSync(join(this.updatesDir, 'guardian-params.json'), JSON.stringify(params, null, 2), 'utf-8')
    writeFileSync(this.stateFile, JSON.stringify(state), 'utf-8')
    this.deps.spawnGuardian(cmdPath)
    // 给 cmd → PowerShell 足够时间完成进程创建：确保 PowerShell 已进入等待循环后父进程再退出，
    // 避免 spawn 刚返回就 quit 导致 PowerShell 被系统杀掉（Job Object 牵连）
    setTimeout(() => this.deps.quit(), 500)
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
