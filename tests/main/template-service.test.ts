import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb, type DbClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { AssetRepository } from '../../db/repositories/asset-repo'
import { TemplateService } from '../../electron/main/services/template-service'
import { AssetService } from '../../electron/main/services/asset-service'

let dataDir: string
let client: DbClient
let svc: TemplateService

beforeEach(() => {
  dataDir = join(tmpdir(), `tp-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  client = createDb(join(tmpdir(), `tp-tpl-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`))
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

describe('TemplateService', () => {
  it('create 落库并返回完整文档', async () => {
    const tpl = await svc.create({ name: '价签', widthMm: 40, heightMm: 30, category: '标签' })
    expect(tpl.paper.widthMm).toBe(40)
    expect((await svc.list({})).length).toBe(1)
  })
  it('delete 删除模板（资产清理由 AssetService 承担，服务被调用不抛错）', async () => {
    const a = await svc.create({ name: 'x', widthMm: 40, heightMm: 30 })
    await svc.remove(a.id)
    expect(await svc.get(a.id)).toBeNull()
  })
})
