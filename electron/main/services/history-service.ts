import { ipcMain } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { IPC } from '../../../shared/ipc-contract'
import { JobRepository, type NewJob } from '../../../db/repositories/job-repo'
import type { Services } from '../ipc'

export class HistoryService {
  constructor(
    private dataDir: string,
    private jobs: JobRepository
  ) {}

  list(filter?: { templateId?: string; from?: number; to?: number; keyword?: string }) {
    return Promise.resolve(this.jobs.list(filter ?? {}))
  }
  get(id: string) {
    return Promise.resolve(this.jobs.getById(id))
  }
  insert(job: NewJob): void {
    this.jobs.insert(job)
  }
  /** 缩略图以 dataURL 返回：dev 下渲染页是 http 源，不能直接读 file:// */
  thumbDataUrl(relOrAbs: string): string {
    const abs = relOrAbs.includes(this.dataDir) ? relOrAbs : join(this.dataDir, relOrAbs)
    return 'data:image/png;base64,' + readFileSync(abs).toString('base64')
  }
}

export function registerHistoryHandlers(deps: Services): void {
  if (!deps.history) return
  const svc = deps.history
  ipcMain.handle(IPC.jobsList, (_e, filter) => svc.list(filter))
  ipcMain.handle(IPC.jobsGet, (_e, id: string) => svc.get(id))
  ipcMain.handle(IPC.thumbFileUrl, (_e, p: string) => svc.thumbDataUrl(p))
}
