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
import { SeedService, SEED_VERSION, seedSpecs, SEED_PREFIX } from '../../electron/main/services/seed-service'

describe('seedSpecs / SeedService', () => {
  let dataDir: string
  let client: DbClient
  let svc: TemplateService
  beforeEach(() => {
    dataDir = join(tmpdir(), `tp-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dataDir, { recursive: true })
    client = createDb(join(tmpdir(), `tp-seed-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`))
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

  it('三个规格均通过 zod 校验且含预期 id/参数/尺寸', () => {
    const specs = seedSpecs()
    expect(specs.map((s) => s.id).sort()).toEqual(
      [SEED_PREFIX + 'cert', SEED_PREFIX + 'label', SEED_PREFIX + 'receipt'].sort()
    )
    expect(specs.find((s) => s.id === SEED_PREFIX + 'receipt')?.paper.widthMm).toBe(80)
    expect(specs.find((s) => s.id === SEED_PREFIX + 'cert')?.params.map((p) => p.key)).toEqual([
      'name',
      'date'
    ])
  })

  it('首次播种插入 3 个；第二次幂等不重复', async () => {
    const seed = new SeedService(dataDir, svc)
    const r1 = await seed.seedIfNeeded()
    expect(r1.inserted).toHaveLength(3)
    const r2 = await seed.seedIfNeeded()
    expect(r2.inserted).toHaveLength(0)
    const list = await svc.list({})
    expect(list.filter((t) => t.category === '示例')).toHaveLength(3)
    expect(SEED_VERSION).toBeTruthy()
  })
})
