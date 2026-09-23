import { ipcMain } from 'electron'
import { join, extname } from 'node:path'
import { mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs'
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

/** 从 PNG/JPEG/GIF/BMP 文件头读取像素尺寸，无第三方依赖。 */
function readImageSize(path: string): { widthPx: number; heightPx: number } {
  const buf = readFileSync(path)
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
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { widthPx: buf.readUInt16LE(6), heightPx: buf.readUInt16LE(8) }
  }
  if (buf.subarray(0, 2).toString('ascii') === 'BM') {
    return { widthPx: buf.readInt32LE(18), heightPx: Math.abs(buf.readInt32LE(22)) }
  }
  throw new Error('不支持的图片格式（仅 png/jpg/gif/bmp）')
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

  purgeForTemplate(templateId: string): void {
    for (const rec of this.repo.removeByTemplate(templateId)) {
      rmSync(join(this.dataDir, rec.filePath), { force: true })
    }
  }
}

export function registerAssetHandlers(deps: Services): void {
  if (!deps.assets) return
  const svc = deps.assets
  ipcMain.removeHandler(IPC.assetsImport)
  ipcMain.handle(IPC.assetsImport, (_e, input: { templateId: string; sourcePath: string }) =>
    svc.importImage(input)
  )
  ipcMain.removeHandler(IPC.assetsDataUrl)
  ipcMain.handle(IPC.assetsDataUrl, (_e, id: string) => svc.toDataUrl(id))
  ipcMain.removeHandler(IPC.assetsListUrls)
  ipcMain.handle(IPC.assetsListUrls, (_e, templateId: string) => svc.listDataUrls(templateId))
}
