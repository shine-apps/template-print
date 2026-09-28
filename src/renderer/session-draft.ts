import type { TemplateDocument } from '../../print-core/template-model'

interface DraftSlot {
  /** 工作副本模板（调整版式返回 / 历史快照重打时使用） */
  doc: TemplateDocument | null
  /** 带回打印页的参数值（调整版式时保留已填内容；重打时回填历史值） */
  paramValues: Record<string, string> | null
  /** true=设计器“完成，返回打印”；false=普通模板编辑入口 */
  returnToPrint: boolean
}

export const sessionDraft: DraftSlot = {
  doc: null,
  paramValues: null,
  returnToPrint: false
}

export function clearDraft(): void {
  sessionDraft.doc = null
  sessionDraft.paramValues = null
  sessionDraft.returnToPrint = false
}

/**
 * 打印页参数值缓存（按模板 id）。
 * 从打印页“调整版式”跳设计器前存入，返回打印页时取出，避免用户已填参数丢失。
 * doc 始终从数据库重新加载，仅参数值走此缓存。
 */
export const paramValuesCache = new Map<string, Record<string, string>>()
