import { ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { readdirSync, unlinkSync, existsSync } from 'node:fs'
import { IPC } from '../../../shared/ipc-contract'
import { loadSettings, saveSettings } from '../settings'
import type { DbClient } from '../../../db/client'
import type { Services } from '../ipc'

const KEEP = 7

/** 从备份文件名列表（backup-YYYYMMDD-HHmmss.db）选出应删除的旧文件（保留最新 keep 份） */
export function pickPruned(fileNames: string[], keep = KEEP): string[] {
  const sorted = fileNames
    .filter((f) => /^backup-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse() // 新→旧
  return sorted.slice(keep)
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export class BackupService {
  constructor(private dataDir: string, private backupsDir: string, private client: DbClient) {}

  /** 立即备份：better-sqlite3 原生在线备份，完成后按 KEEP 清理旧文件，返回新文件路径 */
  async backupNow(): Promise<string> {
    const file = join(this.backupsDir, `backup-${stamp(new Date())}.db`)
    await this.client.sqlite.backup(file)
    this.prune()
    return file
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
    for (const f of pickPruned(files, KEEP)) {
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
