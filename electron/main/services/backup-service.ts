import { ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { readdirSync, unlinkSync, existsSync, readFileSync, rmSync, renameSync } from 'node:fs'
import AdmZip from 'adm-zip'
import { IPC } from '../../../shared/ipc-contract'
import { loadSettings, saveSettings } from '../settings'
import type { DbClient } from '../../../db/client'
import type { Services } from '../ipc'

const KEEP = 7

/**
 * 从备份文件名列表选出应删除的旧文件（保留最新 keep 份）。
 * 新格式为 backup-YYYYMMDD-HHmmss.zip；兼容清理旧版 backup-…​.db 单文件备份。
 */
export function pickPruned(fileNames: string[], keep = KEEP): string[] {
  const sorted = fileNames
    .filter((f) => /^backup-\d{8}-\d{6}\.(zip|db)$/.test(f))
    .sort()
    .reverse() // 新→旧
  return sorted.slice(keep)
}

/** 崩溃遗留的临时文件（.part 压缩包 / .tmp- 前缀的临时 db） */
export function pickStaleTempFiles(fileNames: string[]): string[] {
  return fileNames.filter(
    (f) => /^backup-\d{8}-\d{6}\.zip\.part$/.test(f) || /^\.tmp-backup-\d{8}-\d{6}\.db$/.test(f)
  )
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export class BackupService {
  constructor(private dataDir: string, private backupsDir: string, private client: DbClient) {}

  /**
   * 立即备份：生成单个 zip 包 backup-YYYYMMDD-HHmmss.zip，内含
   *  - app.db        整个数据库（模板/参数/打印历史/资产记录）
   *  - assets/**     模板插入的图片源文件（保持 assets/<模板id>/<文件> 结构）
   *  - settings.json 应用设置（若存在）
   * 先写 .part 临时文件再改名，避免留下半成品压缩包；完成后按 KEEP 清理旧备份。
   */
  async backupNow(): Promise<string> {
    const ts = stamp(new Date())
    const zipPath = join(this.backupsDir, `backup-${ts}.zip`)
    const partPath = join(this.backupsDir, `backup-${ts}.zip.part`)
    const tmpDb = join(this.backupsDir, `.tmp-backup-${ts}.db`)
    try {
      // better-sqlite3 原生在线备份，得到一致性快照
      await this.client.sqlite.backup(tmpDb)

      const zip = new AdmZip()
      zip.addFile('app.db', readFileSync(tmpDb))
      const assetsDir = join(this.dataDir, 'assets')
      if (existsSync(assetsDir)) zip.addLocalFolder(assetsDir, 'assets')
      const settingsFile = join(this.dataDir, 'settings.json')
      if (existsSync(settingsFile)) zip.addFile('settings.json', readFileSync(settingsFile))
      zip.writeZip(partPath)
      renameSync(partPath, zipPath)
    } catch (e) {
      rmSync(partPath, { force: true })
      throw e
    } finally {
      rmSync(tmpDb, { force: true })
    }
    this.prune()
    return zipPath
  }

  /** 同一天只自动备份一次；返回是否执行了备份 */
  async runDaily(): Promise<boolean> {
    const s = loadSettings(this.dataDir)
    const todayStart = new Date().setHours(0, 0, 0, 0)
    if (s.lastBackupAt && s.lastBackupAt >= todayStart) return false
    await this.backupNow()
    saveSettings(this.dataDir, { ...s, lastBackupAt: Date.now() })
    return true
  }

  openBackupsDir(): void {
    void shell.openPath(this.backupsDir)
  }

  private prune(): void {
    if (!existsSync(this.backupsDir)) return
    const files = readdirSync(this.backupsDir)
    for (const f of [...pickPruned(files, KEEP), ...pickStaleTempFiles(files)]) {
      try {
        unlinkSync(join(this.backupsDir, f))
      } catch {
        /* ignore */
      }
    }
  }
}

export function registerBackupHandlers(deps: Services): void {
  const svc = deps.backups
  ipcMain.removeHandler(IPC.backupRun)
  ipcMain.handle(IPC.backupRun, () => svc.backupNow())
  ipcMain.removeHandler(IPC.backupOpen)
  ipcMain.handle(IPC.backupOpen, () => svc.openBackupsDir())
}
