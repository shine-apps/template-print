import { ipcMain } from 'electron'
import { IPC, type NewTemplateInput } from '../../../shared/ipc-contract'
import {
  TemplateDocumentSchema,
  createTemplate,
  localId,
  type TemplateDocument
} from '../../../print-core/template-model'
import { TemplateRepository } from '../../../db/repositories/template-repo'
import type { AssetService } from './asset-service'
import type { Services } from '../ipc'

export class TemplateService {
  constructor(
    private repo: TemplateRepository,
    private assets: AssetService
  ) {}

  async list(filter?: { category?: string; keyword?: string }): Promise<TemplateDocument[]> {
    return this.repo.list(filter ?? {})
  }
  async get(id: string): Promise<TemplateDocument | null> {
    return this.repo.getById(id)
  }
  async create(input: NewTemplateInput): Promise<TemplateDocument> {
    const now = Date.now()
    const doc = createTemplate(localId('tpl'), input.name, { widthMm: input.widthMm, heightMm: input.heightMm }, now)
    doc.category = input.category ?? ''
    this.repo.upsert(doc)
    return doc
  }
  async save(doc: TemplateDocument): Promise<void> {
    const parsed = TemplateDocumentSchema.parse({ ...doc, updatedAt: Date.now() })
    this.repo.upsert(parsed)
  }
  async duplicate(id: string): Promise<TemplateDocument> {
    const src = this.repo.getById(id)
    if (!src) throw new Error('模板不存在')
    // 深拷贝并重新分配模板/元素/参数 id，参数元素重新指向新参数 id
    const paramIdMap = new Map<string, string>()
    const now = Date.now()
    const copy: TemplateDocument = TemplateDocumentSchema.parse({
      ...structuredClone(src),
      id: localId('tpl'),
      name: `${src.name} 副本`,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now
    })
    copy.params = copy.params.map((p) => {
      const nid = localId('param')
      paramIdMap.set(p.id, nid)
      return { ...p, id: nid }
    })
    copy.content.elements = copy.content.elements.map((el) =>
      el.type === 'param'
        ? { ...el, id: localId('el'), props: { ...el.props, paramId: paramIdMap.get(el.props.paramId)! } }
        : { ...el, id: localId('el') }
    )
    // 图片资产在 M1 不复制文件（副本暂时不带图，用户可重新上传）
    copy.content.elements = copy.content.elements.filter((el) => el.type !== 'image')
    this.repo.upsert(copy)
    return copy
  }
  async remove(id: string): Promise<void> {
    this.assets.purgeForTemplate(id)
    this.repo.remove(id)
  }
}

export function registerTemplateHandlers(deps: Services): void {
  const svc = deps.templates
  ipcMain.removeHandler(IPC.templatesList)
  ipcMain.handle(IPC.templatesList, (_e, filter) => svc.list(filter))
  ipcMain.removeHandler(IPC.templatesGet)
  ipcMain.handle(IPC.templatesGet, (_e, id: string) => svc.get(id))
  ipcMain.removeHandler(IPC.templatesCreate)
  ipcMain.handle(IPC.templatesCreate, (_e, input: NewTemplateInput) => svc.create(input))
  ipcMain.removeHandler(IPC.templatesSave)
  ipcMain.handle(IPC.templatesSave, (_e, doc: TemplateDocument) => svc.save(doc))
  ipcMain.removeHandler(IPC.templatesDuplicate)
  ipcMain.handle(IPC.templatesDuplicate, (_e, id: string) => svc.duplicate(id))
  ipcMain.removeHandler(IPC.templatesDelete)
  ipcMain.handle(IPC.templatesDelete, (_e, id: string) => svc.remove(id))
}
