import { ipcMain } from 'electron'
import { join } from 'node:path'
import { readFileSync, unlinkSync } from 'node:fs'
import { IPC, type JobListFilter } from '../../../shared/ipc-contract'
import { JobRepository, type NewJob } from '../../../db/repositories/job-repo'
import type { SettingsService } from './settings-service'
import type { Services } from '../ipc'

const DAY_MS = 86_400_000

export class HistoryService {
  constructor(
    private dataDir: string,
    private jobs: JobRepository,
    private settings: SettingsService
  ) {}

  list(filter?: JobListFilter) {
    return Promise.resolve(this.jobs.list(filter ?? {}))
  }
  get(id: string) {
    return Promise.resolve(this.jobs.getById(id))
  }
  insert(job: NewJob): void {
    this.jobs.insert(job)
  }

  /** 手动清理：olderThanDays 缺省/0 表示清空全部；同时回收缩略图文件 */
  cleanup(input: { olderThanDays?: number }): { deletedJobs: number; deletedThumbs: number } {
    const rows = input.olderThanDays && input.olderThanDays > 0
      ? this.jobs.deleteOlderThan(Date.now() - input.olderThanDays * DAY_MS)
      : this.jobs.deleteAll()
    let deletedThumbs = 0
    for (const r of rows) {
      if (r.thumbPath) {
        try {
          unlinkSync(this.thumbAbs(r.thumbPath))
          deletedThumbs++
        } catch {
          /* 缩略图文件已不存在 */
        }
      }
    }
    return { deletedJobs: rows.length, deletedThumbs }
  }

  count(): number {
    return this.jobs.count()
  }

  /** 启动时按设置的保留天数清理；null/<=0 不清理 */
  runScheduledCleanup(): { deletedJobs: number; deletedThumbs: number } | null {
    const days = this.settings.get().historyRetentionDays
    if (!days || days <= 0) return null
    return this.cleanup({ olderThanDays: days })
  }

  /** 缩略图以 dataURL 返回：dev 下渲染页是 http 源，不能直接读 file:// */
  thumbDataUrl(relOrAbs: string): string {
    return 'data:image/png;base64,' + readFileSync(this.thumbAbs(relOrAbs)).toString('base64')
  }

  private thumbAbs(relOrAbs: string): string {
    return relOrAbs.includes(this.dataDir) ? relOrAbs : join(this.dataDir, relOrAbs)
  }
}

export function registerHistoryHandlers(deps: Services): void {
  if (!deps.history) return
  const svc = deps.history
  ipcMain.handle(IPC.jobsList, (_e, filter) => svc.list(filter))
  ipcMain.handle(IPC.jobsGet, (_e, id: string) => svc.get(id))
  ipcMain.removeHandler(IPC.jobsCleanup)
  ipcMain.handle(IPC.jobsCleanup, (_e, input: { olderThanDays?: number }) => svc.cleanup(input ?? {}))
  ipcMain.removeHandler(IPC.jobsCount)
  ipcMain.handle(IPC.jobsCount, () => svc.count())
  ipcMain.handle(IPC.thumbFileUrl, (_e, p: string) => svc.thumbDataUrl(p))
}
