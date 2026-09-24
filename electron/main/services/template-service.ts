import { dialog, ipcMain } from 'electron'
import { writeFileSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { homedir } from 'node:os'
import AdmZip from 'adm-zip'
import { IPC, type NewTemplateInput } from '../../../shared/ipc-contract'
import {
  TemplateDocumentSchema,
  createTemplate,
  localId,
  type TemplateDocument,
  type TemplateElement
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

  /** 导出 .tplx（zip）：根 template.json + assets/<assetId><.ext> */
  async exportToFile(id: string, targetPath: string): Promise<void> {
    const doc = this.repo.getById(id)
    if (!doc) throw new Error('模板不存在')
    const zip = new AdmZip()
    zip.addFile('template.json', Buffer.from(JSON.stringify(doc, null, 2), 'utf-8'))
    for (const a of this.assets.repo.listByTemplate(id)) {
      zip.addFile(`assets/${basename(a.filePath)}`, readFileSync(this.assets.absPathOf(a.filePath)))
    }
    writeFileSync(targetPath, zip.toBuffer())
  }

  /** 导入 .tplx：zod 校验 → 新 id/名称追加"导入" → 解压图片资产（保留原 assetId） */
  async importFromFile(sourcePath: string): Promise<TemplateDocument> {
    const zip = new AdmZip(sourcePath)
    const entry = zip.getEntry('template.json')
    if (!entry) throw new Error('不是有效的 .tplx 文件（缺少 template.json）')
    const parsed = TemplateDocumentSchema.parse(JSON.parse(entry.getData().toString('utf-8')))

    const now = Date.now()
    const newDoc: TemplateDocument = TemplateDocumentSchema.parse({
      ...structuredClone(parsed),
      id: localId('tpl'),
      name: `${parsed.name} 导入`,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now
    })
    this.repo.upsert(newDoc)

    const imageEls = newDoc.content.elements.filter(
      (e): e is Extract<TemplateElement, { type: 'image' }> => e.type === 'image'
    )
    for (const el of imageEls) {
      // 已存在同 assetId 的资产则跳过（repo.insert 主键冲突会抛错）
      if (this.assets.repo.get(el.props.assetId)) continue
      const fileEntry = zip.getEntries().find(
        (e) => e.entryName.startsWith('assets/') && e.entryName.includes(el.props.assetId)
      )
      if (!fileEntry) continue
      await this.assets.importBuffer({
        templateId: newDoc.id,
        assetId: el.props.assetId,
        buffer: fileEntry.getData(),
        ext: extname(fileEntry.entryName) || '.png',
        originalName: fileEntry.name
      })
    }
    return newDoc
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

  ipcMain.removeHandler(IPC.templatesExport)
  ipcMain.handle(IPC.templatesExport, async (_e, id: string) => {
    const doc = await svc.get(id)
    if (!doc) throw new Error('模板不存在')
    const r = await dialog.showSaveDialog({
      title: '导出模板',
      defaultPath: `${doc.name}.tplx`,
      filters: [{ name: '模板包', extensions: ['tplx'] }]
    })
    if (r.canceled || !r.filePath) return { canceled: true }
    await svc.exportToFile(id, r.filePath)
    return { canceled: false, path: r.filePath }
  })

  ipcMain.removeHandler(IPC.templatesImport)
  ipcMain.handle(IPC.templatesImport, async () => {
    const r = await dialog.showOpenDialog({
      title: '导入模板',
      // Electron 43 起未给 defaultPath 会固定落在“下载”目录，显式给用户主目录
      defaultPath: homedir(),
      filters: [{ name: '模板包', extensions: ['tplx'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return { canceled: true }
    const created = await svc.importFromFile(r.filePaths[0])
    return { canceled: false, id: created.id }
  })
}
