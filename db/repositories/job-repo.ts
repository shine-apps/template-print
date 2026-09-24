import { eq, gte, lt, desc, and, inArray, type SQL } from 'drizzle-orm'
import { printJobs } from '../schema'
import type { DrizzleDb } from '../client'
import { TemplateDocumentSchema, type TemplateDocument } from '../../print-core/template-model'
import { migrateDocument } from '../../print-core/migrate'

export type JobStatus = 'success' | 'failed' | 'cancelled'

export interface NewJob {
  id: string
  templateId: string | null
  templateNameSnapshot: string
  templateSnapshot: TemplateDocument
  paramValues: Record<string, string>
  thumbPath: string | null
  printerName: string
  copies: number
  printMode: 'silent' | 'dialog'
  status: JobStatus
  errorMessage: string | null
  createdAt: number
}

export interface JobListItem extends Omit<NewJob, 'templateSnapshot'> {
  templateSnapshot: TemplateDocument
}

export interface JobFilter {
  templateId?: string
  from?: number
  to?: number
  keyword?: string
  statuses?: JobStatus[]
  printerName?: string
}

interface JobRow {
  id: string
  templateId: string | null
  templateNameSnapshot: string
  templateSnapshot: unknown
  paramValues: unknown
  thumbPath: string | null
  printerName: string
  copies: number
  printMode: 'silent' | 'dialog'
  status: JobStatus
  errorMessage: string | null
  createdAt: number
}

export class JobRepository {
  constructor(private db: DrizzleDb) {}

  insert(job: NewJob): void {
    this.db.insert(printJobs).values(job).run()
  }

  private hydrate(row: JobRow): JobListItem {
    return {
      id: row.id,
      templateId: row.templateId ?? null,
      templateNameSnapshot: row.templateNameSnapshot,
      templateSnapshot: TemplateDocumentSchema.parse(migrateDocument(row.templateSnapshot)),
      paramValues: row.paramValues as Record<string, string>,
      thumbPath: row.thumbPath ?? null,
      printerName: row.printerName,
      copies: row.copies,
      printMode: row.printMode,
      status: row.status,
      errorMessage: row.errorMessage ?? null,
      createdAt: row.createdAt
    }
  }

  getById(id: string): JobListItem | null {
    const row = this.db.select().from(printJobs).where(eq(printJobs.id, id)).all()[0] as JobRow | undefined
    return row ? this.hydrate(row) : null
  }

  list(filter: JobFilter): JobListItem[] {
    // SQL 层只过滤模板与起始时间（可走索引）；结束时间与关键字在 JS 层精确过滤，
    // 避免 JSON 文本 LIKE 的转义误差（M1 数据量小）。
    const conds: SQL[] = []
    if (filter.templateId) conds.push(eq(printJobs.templateId, filter.templateId))
    if (filter.from) conds.push(gte(printJobs.createdAt, filter.from))
    if (filter.statuses && filter.statuses.length > 0) {
      conds.push(inArray(printJobs.status, filter.statuses as string[]))
    }
    if (filter.printerName) conds.push(eq(printJobs.printerName, filter.printerName))
    const rows = this.db
      .select()
      .from(printJobs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(printJobs.createdAt))
      .all() as unknown as JobRow[]
    let list = rows.map((r) => this.hydrate(r))
    const to = filter.to
    if (to) list = list.filter((j) => j.createdAt <= to)
    if (filter.keyword) {
      const kw = filter.keyword
      list = list.filter(
        (j) =>
          j.templateNameSnapshot.includes(kw) ||
          Object.values(j.paramValues).some((v) => String(v).includes(kw))
      )
    }
    return list
  }

  /** 删除指定时间之前（不含）的记录，返回被删行（供上层清理缩略图） */
  deleteOlderThan(ts: number): JobRow[] {
    const rows = this.db.select().from(printJobs).where(lt(printJobs.createdAt, ts)).all() as unknown as JobRow[]
    this.db.delete(printJobs).where(lt(printJobs.createdAt, ts)).run()
    return rows
  }

  /** 清空全部记录，返回被删行 */
  deleteAll(): JobRow[] {
    const rows = this.db.select().from(printJobs).all() as unknown as JobRow[]
    this.db.delete(printJobs).run()
    return rows
  }

  /** 计数 */
  count(): number {
    return (this.db.select().from(printJobs).all() as unknown[]).length
  }
}
