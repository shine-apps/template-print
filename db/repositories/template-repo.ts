import { eq, like, and, desc, type SQL } from 'drizzle-orm'
import { templates, templateParams } from '../schema'
import type { DrizzleDb } from '../client'
import { TemplateDocumentSchema, type TemplateDocument } from '../../print-core/template-model'

interface TemplateRow {
  id: string
  name: string
  category: string
  paper: unknown
  content: unknown
  printMode: 'silent' | 'dialog'
  printerName: string | null
  isBuiltin: number | boolean
  version: number
  createdAt: number
  updatedAt: number
}

interface ParamRow {
  name: string
  type: string
  required: number | boolean
  defaultValue: string
  dateFormat: string
  maxLength: number | null
  min: number | null
  max: number | null
  decimals: number
  thousandsSeparator: number | boolean
  printOnEmpty: 'blank' | 'line'
  order: number
}

export interface TemplateListFilter {
  category?: string
  keyword?: string
}

export class TemplateRepository {
  constructor(private db: DrizzleDb) {}

  upsert(doc: TemplateDocument): void {
    this.db.transaction((tx) => {
      const exists = tx.select({ id: templates.id }).from(templates).where(eq(templates.id, doc.id)).all()
      const row = {
        id: doc.id,
        name: doc.name,
        category: doc.category,
        paper: doc.paper,
        content: doc.content,
        printMode: doc.printMode,
        printerName: doc.printerName,
        isBuiltin: doc.isBuiltin,
        version: doc.version,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      }
      if (exists.length) {
        tx.update(templates).set(row).where(eq(templates.id, doc.id)).run()
      } else {
        tx.insert(templates).values(row).run()
      }
      // 参数整体替换
      tx.delete(templateParams).where(eq(templateParams.templateId, doc.id)).run()
      for (const p of doc.params) {
        tx.insert(templateParams).values({
          templateId: doc.id, name: p.name, type: p.type,
          required: p.required, defaultValue: p.defaultValue, dateFormat: p.dateFormat,
          maxLength: p.maxLength, min: p.min, max: p.max, decimals: p.decimals,
          thousandsSeparator: p.thousandsSeparator, printOnEmpty: p.printOnEmpty, order: p.order
        }).run()
      }
    })
  }

  private hydrate(row: TemplateRow, params: ParamRow[]): TemplateDocument {
    // 启动迁移已保证库内为 v2；Drizzle 查询返回 JS 属性名（camelCase），JSON 模式列已自动反序列化
    return TemplateDocumentSchema.parse({
      id: row.id, name: row.name, category: row.category, paper: row.paper,
      content: row.content, printMode: row.printMode, printerName: row.printerName,
      isBuiltin: !!row.isBuiltin, version: 2,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      params: params
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((pr) => ({
          name: pr.name, type: pr.type, required: !!pr.required, defaultValue: pr.defaultValue,
          dateFormat: pr.dateFormat, maxLength: pr.maxLength, min: pr.min, max: pr.max,
          decimals: pr.decimals, thousandsSeparator: !!pr.thousandsSeparator,
          printOnEmpty: pr.printOnEmpty, order: pr.order
        }))
    })
  }

  getById(id: string): TemplateDocument | null {
    const row = this.db.select().from(templates).where(eq(templates.id, id)).all()[0] as TemplateRow | undefined
    if (!row) return null
    const params = this.db.select().from(templateParams)
      .where(eq(templateParams.templateId, id)).all() as unknown as ParamRow[]
    return this.hydrate(row, params)
  }

  list(filter: TemplateListFilter): TemplateDocument[] {
    const conds: SQL[] = []
    if (filter.category) conds.push(eq(templates.category, filter.category))
    if (filter.keyword) conds.push(like(templates.name, `%${filter.keyword}%`))
    const rows = this.db
      .select()
      .from(templates)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(templates.updatedAt))
      .all() as unknown as TemplateRow[]
    return rows.map((row) => {
      const params = this.db.select().from(templateParams)
        .where(eq(templateParams.templateId, row.id)).all() as unknown as ParamRow[]
      return this.hydrate(row, params)
    })
  }

  categories(): string[] {
    const rows = this.db.selectDistinct({ c: templates.category }).from(templates).all() as { c: string }[]
    return rows.map((r) => r.c).filter(Boolean).sort()
  }

  remove(id: string): void {
    this.db.delete(templates).where(eq(templates.id, id)).run()
  }
}
