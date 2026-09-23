import type { TemplateDocument } from '../../../print-core/template-model'

interface DraftSlot {
  /** 工作副本模板（调整版式返回 / 历史快照重打时使用） */
  doc: TemplateDocument | null
  /** 带回打印页的参数值（调整版式时保留已填内容；重打时回填历史值） */
  paramValues: Record<string, string> | null
  /** true=设计器“完成，返回打印”；false=普通模板编辑入口 */
  returnToPrint: boolean
  /** true=来源是历史重打，打印后不弹保存决策 */
  fromHistory: boolean
  /** 进入打印页时原始模板的 JSON 基线，用于 dirty 判定 */
  baselineJson: string | null
}

export const sessionDraft: DraftSlot = {
  doc: null,
  paramValues: null,
  returnToPrint: false,
  fromHistory: false,
  baselineJson: null
}

export function clearDraft(): void {
  sessionDraft.doc = null
  sessionDraft.paramValues = null
  sessionDraft.returnToPrint = false
  sessionDraft.fromHistory = false
  sessionDraft.baselineJson = null
}
