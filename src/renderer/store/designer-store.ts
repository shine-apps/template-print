import { create } from 'zustand'
import {
  TemplateDocumentSchema,
  type TemplateDocument,
  type TemplateElement,
  type Geometry,
  type ParamDef
} from '../../../print-core/template-model'

// new-template=无 id 进入时载入的未持久化空白模板，首次保存时才在库中创建
type Mode = 'template' | 'new-template'

interface DesignerState {
  doc: TemplateDocument
  mode: Mode
  selectedId: string | null
  dirty: boolean
  past: TemplateDocument[]
  future: TemplateDocument[]
  load(doc: TemplateDocument, mode: Mode): void
  select(id: string | null): void
  mutate(fn: (d: TemplateDocument) => void): void
  commit(): void
  undo(): void
  redo(): void
  addElement(el: TemplateElement): void
  removeElement(id: string): void
  updateGeometry(id: string, patch: Partial<Pick<Geometry, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'locked' | 'zIndex'>>): void
  updateProps(id: string, patch: Record<string, unknown>): void
  reorderLayer(id: string, beforeId: string | null): void
  addOrUpdateParam(p: ParamDef): void
  removeParam(name: string): void
  renameParam(oldName: string, def: ParamDef): void
  markSaved(): void
}

function clone(doc: TemplateDocument): TemplateDocument {
  return TemplateDocumentSchema.parse(structuredClone(doc))
}

// store 创建时需要一个初始文档；用一个惰性占位，load 前不允许操作
// （name 需满足 min(1) 校验）
const placeholder = TemplateDocumentSchema.parse({
  id: '__init__', name: '__init__', paper: { widthMm: 1, heightMm: 1 },
  content: { elements: [] }, params: [], createdAt: 0, updatedAt: 0
})

export const useDesignerStore = create<DesignerState>((set, get) => ({
  doc: placeholder,
  mode: 'template',
  selectedId: null,
  dirty: false,
  past: [],
  future: [],

  load(doc, mode) {
    set({ doc: clone(doc), mode, selectedId: null, dirty: false, past: [], future: [] })
  },
  select(id) {
    set({ selectedId: id })
  },
  mutate(fn) {
    const cur = get().doc
    const next = clone(cur)
    fn(next)
    // 校验失败时保留旧文档（如参数名称在模板内重复）。
    if (!TemplateDocumentSchema.safeParse(next).success) return
    // 每次成功变更前把旧文档压入撤销栈（标准 pre-state 快照），
    // 新分支动作清空 redo 栈；栈深上限 50。
    set({
      doc: next,
      dirty: true,
      past: [...get().past.slice(-49), clone(cur)],
      future: []
    })
  },
  commit() {
    // 历史快照已在每次 mutate 前记录；commit 作为一次复合操作的结束边界保留，
    // 供未来合并连续历史使用，M1 无需额外处理。
  },
  undo() {
    const { past, future, doc } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    set({ past: past.slice(0, -1), future: [clone(doc), ...future], doc: prev, selectedId: null, dirty: true })
  },
  redo() {
    const { future, past, doc } = get()
    if (future.length === 0) return
    const [next, ...rest] = future
    set({ future: rest, past: [...past, clone(doc)], doc: next, selectedId: null, dirty: true })
  },
  addElement(el) {
    get().mutate((d) => {
      el.zIndex = d.content.elements.length
      d.content.elements.push(el)
    })
    set({ selectedId: el.id })
  },
  removeElement(id) {
    get().mutate((d) => {
      d.content.elements = d.content.elements.filter((e) => e.id !== id)
    })
    if (get().selectedId === id) set({ selectedId: null })
  },
  updateGeometry(id, patch) {
    get().mutate((d) => {
      const el = d.content.elements.find((e) => e.id === id)
      if (el) Object.assign(el, patch)
    })
  },
  updateProps(id, patch) {
    get().mutate((d) => {
      const el = d.content.elements.find((e) => e.id === id)
      if (el) Object.assign(el.props, patch)
    })
  },
  reorderLayer(id, beforeId) {
    get().mutate((d) => {
      const sorted = [...d.content.elements].sort((a, b) => a.zIndex - b.zIndex)
      const from = sorted.findIndex((e) => e.id === id)
      if (from < 0) return
      const [item] = sorted.splice(from, 1)
      const to = beforeId === null ? sorted.length : sorted.findIndex((e) => e.id === beforeId)
      sorted.splice(to < 0 ? sorted.length : to, 0, item)
      sorted.forEach((e, i) => { e.zIndex = i })
    })
  },
  addOrUpdateParam(p) {
    get().mutate((d) => {
      const i = d.params.findIndex((x) => x.name === p.name)
      if (i >= 0) d.params[i] = p
      else d.params.push({ ...p, order: d.params.length })
    })
  },
  removeParam(name) {
    get().mutate((d) => {
      d.params = d.params.filter((p) => p.name !== name)
    })
  },
  renameParam(oldName, def) {
    get().mutate((d) => {
      // 同步替换全部文本元素中的 {{oldName}}（容忍括号内空白），统一规范为 {{新名}}
      const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, 'g')
      for (const el of d.content.elements) {
        if (el.type === 'text' && el.props.text.includes('{{')) {
          el.props.text = el.props.text.replace(re, `{{${def.name}}}`)
        }
      }
      const i = d.params.findIndex((p) => p.name === oldName)
      if (i >= 0) d.params[i] = def
      else d.params.push({ ...def, order: d.params.length })
    })
  },
  markSaved() {
    set({ dirty: false })
  }
}))
