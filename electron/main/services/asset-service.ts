import { ipcMain } from 'electron'
import { join, extname } from 'node:path'
import { mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { IPC } from '../../../shared/ipc-contract'
import { AssetRepository } from '../../../db/repositories/asset-repo'
import type { Services } from '../ipc'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

/** 从 PNG/JPEG/GIF/BMP 缓冲头读取像素尺寸，无第三方依赖。 */
export function readImageSizeFromBuffer(buf: Buffer): { widthPx: number; heightPx: number } {
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { widthPx: buf.readUInt32BE(16), heightPx: buf.readUInt32BE(20) }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2
    while (o < buf.length) {
      if (buf[o] !== 0xff) break
      const marker = buf[o + 1]
      const len = buf.readUInt16BE(o + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { heightPx: buf.readUInt16BE(o + 5), widthPx: buf.readUInt16BE(o + 7) }
      }
      o += 2 + len
    }
  }
  const ascii6 = buf.subarray(0, 6).toString('ascii')
  if (ascii6 === 'GIF87a' || ascii6 === 'GIF89a') {
    return { widthPx: buf.readUInt16LE(6), heightPx: buf.readUInt16LE(8) }
  }
  if (ascii6.slice(0, 2) === 'BM') {
    return { widthPx: buf.readInt32LE(18), heightPx: Math.abs(buf.readInt32LE(22)) }
  }
  throw new Error('不支持的图片格式（仅 png/jpg/gif/bmp）')
}

/** 从 PNG/JPEG/GIF/BMP 文件头读取像素尺寸，无第三方依赖。 */
function readImageSize(path: string): { widthPx: number; heightPx: number } {
  return readImageSizeFromBuffer(readFileSync(path))
}

export class AssetService {
  constructor(
    private dataDir: string,
    readonly repo: AssetRepository
  ) {}

  async importImage(input: { templateId: string; sourcePath: string }): Promise<{ assetId: string }> {
    const ext = extname(input.sourcePath).toLowerCase()
    const mime = MIME[ext]
    if (!mime) throw new Error(`不支持的扩展名: ${ext}`)
    const { widthPx, heightPx } = readImageSize(input.sourcePath)
    const assetId = `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const relPath = join('assets', input.templateId, `${assetId}${ext}`)
    mkdirSync(join(this.dataDir, 'assets', input.templateId), { recursive: true })
    copyFileSync(input.sourcePath, join(this.dataDir, relPath))
    this.repo.insert({
      id: assetId,
      templateId: input.templateId,
      filePath: relPath,
      originalName: input.sourcePath.split(/[\\/]/).pop() ?? 'image',
      mime,
      sizeBytes: 0,
      widthPx,
      heightPx
    })
    return { assetId }
  }

  absolutePath(assetId: string): string {
    const rec = this.repo.get(assetId)
    if (!rec) throw new Error(`资产不存在: ${assetId}`)
    return join(this.dataDir, rec.filePath)
  }

  /** 相对数据目录路径 → 绝对路径（供导出读取原始文件） */
  absPathOf(rel: string): string {
    return join(this.dataDir, rel)
  }

  /** 从缓冲导入资产（.tplx 导入用），assetId 保留包内原值；调用方须先确认 id 不存在 */
  async importBuffer(input: {
    templateId: string
    assetId: string
    buffer: Buffer
    ext: string
    originalName: string
  }): Promise<void> {
    const mime = MIME[input.ext] ?? 'application/octet-stream'
    const relPath = join('assets', input.templateId, `${input.assetId}${input.ext}`)
    mkdirSync(join(this.dataDir, 'assets', input.templateId), { recursive: true })
    writeFileSync(join(this.dataDir, relPath), input.buffer)
    const { widthPx, heightPx } = readImageSizeFromBuffer(input.buffer)
    this.repo.insert({
      id: input.assetId,
      templateId: input.templateId,
      filePath: relPath,
      originalName: input.originalName,
      mime,
      sizeBytes: input.buffer.length,
      widthPx,
      heightPx
    })
  }

  fileUrl(assetId: string): string {
    return pathToFileURL(this.absolutePath(assetId)).href
  }

  async toDataUrl(assetId: string): Promise<string> {
    const rec = this.repo.get(assetId)
    if (!rec) throw new Error(`资产不存在: ${assetId}`)
    const b64 = readFileSync(join(this.dataDir, rec.filePath)).toString('base64')
    return `data:${rec.mime};base64,${b64}`
  }

  async listDataUrls(templateId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const rec of this.repo.listByTemplate(templateId)) {
      out[rec.id] = await this.toDataUrl(rec.id)
    }
    return out
  }

  /** 按资产 id 列表取 dataUrl（供未保存草稿引用其他模板资产时显示图片用） */
  async listDataUrlsByIds(ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const id of ids) {
      const rec = this.repo.get(id)
      if (rec) out[id] = await this.toDataUrl(id)
    }
    return out
  }

  purgeForTemplate(templateId: string): void {
    for (const rec of this.repo.removeByTemplate(templateId)) {
      rmSync(join(this.dataDir, rec.filePath), { force: true })
    }
  }

  /**
   * 复制资产到目标模板：生成新 assetId，复制文件，插入新记录。
   * 用于模板复制时保留图片元素。
   */
  copyAsset(sourceAssetId: string, newTemplateId: string): string {
    const src = this.repo.get(sourceAssetId)
    if (!src) throw new Error(`资产不存在: ${sourceAssetId}`)
    const newAssetId = `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const ext = extname(src.filePath)
    const relPath = join('assets', newTemplateId, `${newAssetId}${ext}`)
    mkdirSync(join(this.dataDir, 'assets', newTemplateId), { recursive: true })
    copyFileSync(join(this.dataDir, src.filePath), join(this.dataDir, relPath))
    this.repo.insert({
      id: newAssetId,
      templateId: newTemplateId,
      filePath: relPath,
      originalName: src.originalName,
      mime: src.mime,
      sizeBytes: src.sizeBytes,
      widthPx: src.widthPx,
      heightPx: src.heightPx
    })
    return newAssetId
  }
}

export function registerAssetHandlers(deps: Services): void {
  const svc = deps.assets
  ipcMain.removeHandler(IPC.assetsImport)
  ipcMain.handle(IPC.assetsImport, (_e, input: { templateId: string; sourcePath: string }) =>
    svc.importImage(input)
  )
  ipcMain.removeHandler(IPC.assetsDataUrl)
  ipcMain.handle(IPC.assetsDataUrl, (_e, id: string) => svc.toDataUrl(id))
  ipcMain.removeHandler(IPC.assetsListUrls)
  ipcMain.handle(IPC.assetsListUrls, (_e, templateId: string) => svc.listDataUrls(templateId))
  ipcMain.removeHandler(IPC.assetsListUrlsByIds)
  ipcMain.handle(IPC.assetsListUrlsByIds, (_e, ids: string[]) => svc.listDataUrlsByIds(ids))
}
