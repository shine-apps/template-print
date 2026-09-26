import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb, type DbClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { AssetRepository } from '../../db/repositories/asset-repo'
import { TemplateService } from '../../electron/main/services/template-service'
import { AssetService } from '../../electron/main/services/asset-service'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

let dataDir: string
let client: DbClient
let svc: TemplateService
let assetSvc: AssetService

beforeEach(() => {
  dataDir = join(tmpdir(), `tp-saveasset-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  client = createDb(join(tmpdir(), `tp-saveasset-db-${Date.now()}.db`))
  runMigrations(client)
  assetSvc = new AssetService(dataDir, new AssetRepository(client.db))
  svc = new TemplateService(new TemplateRepository(client.db), assetSvc)
})
afterEach(() => {
  client.sqlite.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('save 复制外来源资产', () => {
  it('保存时图片元素引用其他模板的资产，应复制并重新分配 assetId', async () => {
    // 模板 A 带一张图片
    const a = await svc.create({ name: 'A', widthMm: 100, heightMm: 80 })
    const src = join(tmpdir(), `sa-${Date.now()}.png`)
    writeFileSync(src, PNG_1X1)
    const { assetId: aidA } = await assetSvc.importImage({ templateId: a.id, sourcePath: src })
    const docA = (await svc.get(a.id))!
    docA.content.elements.push({ id: 'e1', type: 'image', x: 0, y: 0, w: 10, h: 10, props: { assetId: aidA } } as any)
    await svc.save(docA)

    // 模板 B（新建）引用 A 的资产
    const b = await svc.create({ name: 'B', widthMm: 100, heightMm: 80 })
    const docB = (await svc.get(b.id))!
    docB.content.elements.push({ id: 'e2', type: 'image', x: 0, y: 0, w: 10, h: 10, props: { assetId: aidA } } as any)
    const saved = await svc.save(docB)

    // B 的图片元素 assetId 应已变更（不再是 A 的）
    const imgEl = saved.content.elements.find((e: any) => e.type === 'image') as any
    expect(imgEl.props.assetId).not.toBe(aidA)
    // 新资产应属于模板 B
    const rec = assetSvc.repo.get(imgEl.props.assetId)!
    expect(rec.templateId).toBe(b.id)
    // A 的资产仍在
    expect(assetSvc.repo.get(aidA)).not.toBeNull()
  })
})
