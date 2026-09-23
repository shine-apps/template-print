import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb, type DbClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { AssetRepository } from '../../db/repositories/asset-repo'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { AssetService } from '../../electron/main/services/asset-service'
import { createTemplate } from '../../print-core/template-model'

// 1x1 PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

let dataDir: string
let client: DbClient
let svc: AssetService

beforeEach(() => {
  dataDir = join(tmpdir(), `tp-asset-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dataDir, 'assets'), { recursive: true })
  client = createDb(join(tmpdir(), `tp-asset-db-${Date.now()}.db`))
  runMigrations(client)
  // assets.template_id 外键约束：先建被引用的模板 t1
  new TemplateRepository(client.db).upsert(createTemplate('t1', '测试模板', { widthMm: 40, heightMm: 30 }))
  svc = new AssetService(dataDir, new AssetRepository(client.db))
  mkdirSync(join(tmpdir(), 'srcimg'), { recursive: true })
})
afterEach(() => {
  client.sqlite.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('AssetService', () => {
  it('导入图片：复制文件、入库、返回 assetId 与尺寸', async () => {
    const src = join(tmpdir(), 'srcimg', `a-${Date.now()}.png`)
    writeFileSync(src, PNG_1X1)
    const { assetId } = await svc.importImage({ templateId: 't1', sourcePath: src })
    const rec = svc.repo.get(assetId)!
    expect(rec.widthPx).toBe(1)
    expect(rec.heightPx).toBe(1)
    expect(existsSync(join(dataDir, rec.filePath))).toBe(true)
    expect(await svc.toDataUrl(assetId)).toMatch(/^data:image\/png;base64,/)
  })

  it('删除模板资产：删库记录并删文件', async () => {
    const src = join(tmpdir(), 'srcimg', `b-${Date.now()}.png`)
    writeFileSync(src, PNG_1X1)
    const { assetId } = await svc.importImage({ templateId: 't1', sourcePath: src })
    const rec = svc.repo.get(assetId)!
    svc.purgeForTemplate('t1')
    expect(svc.repo.get(assetId)).toBeNull()
    expect(existsSync(join(dataDir, rec.filePath))).toBe(false)
  })
})
