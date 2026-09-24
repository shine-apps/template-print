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
import { createElement } from '../../print-core/template-model'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

let dataDir: string
let client: DbClient
let svc: TemplateService

beforeEach(() => {
  dataDir = join(tmpdir(), `tp-tplx-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  client = createDb(join(tmpdir(), `tp-tplx-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`))
  runMigrations(client)
  svc = new TemplateService(
    new TemplateRepository(client.db),
    new AssetService(dataDir, new AssetRepository(client.db))
  )
})
afterEach(() => {
  client.sqlite.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('.tplx 往返', () => {
  it('导出再导入：新 id/名称含导入/参数齐全/图片可读', async () => {
    const tpl = await svc.create({ name: '价签', widthMm: 40, heightMm: 30, category: '标签' })
    tpl.content.elements.push(createElement('text', { text: 'X' }, { x: 1, y: 1, w: 10, h: 5 }))
    await svc.save(tpl)

    const srcImg = join(dataDir, 'a.png')
    writeFileSync(srcImg, PNG_1X1)
    const { assetId } = await (svc as unknown as { assets: AssetService }).assets
      .importImage({ templateId: tpl.id, sourcePath: srcImg })
    const withImg = await svc.get(tpl.id)
    withImg!.content.elements.push(
      createElement('image', { assetId, fit: 'contain', opacity: 1 }, { x: 1, y: 10, w: 10, h: 10 })
    )
    await svc.save(withImg!)

    const tplxPath = join(dataDir, 'out.tplx')
    await svc.exportToFile(tpl.id, tplxPath)

    const imported = await svc.importFromFile(tplxPath)
    expect(imported.id).not.toBe(tpl.id)
    expect(imported.name).toBe('价签 导入')
    expect(imported.params).toHaveLength(tpl.params.length)
    const imgEl = imported.content.elements.find((e) => e.type === 'image')!
    expect(imgEl).toBeTruthy()
    const dataUrl = await (svc as unknown as { assets: AssetService }).assets.toDataUrl(imgEl.props.assetId)
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)

    // textOnly 随 .tplx 导出导入保留
    const flag = await svc.get(tpl.id)
    flag!.textOnly = false
    await svc.save(flag!)
    const tplx2 = join(dataDir, 'out2.tplx')
    await svc.exportToFile(tpl.id, tplx2)
    const imported2 = await svc.importFromFile(tplx2)
    expect(imported2.textOnly).toBe(false)
  })
})
