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
import { loadSettings, saveSettings } from '../../electron/main/settings'

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
    expect(specs.find((s) => s.id === SEED_PREFIX + 'cert')?.params.map((p) => p.name)).toEqual([
      '姓名',
      '日期'
    ])
    expect(specs.find((s) => s.id === SEED_PREFIX + 'receipt')?.params.map((p) => p.name)).toEqual([
      '商品/客户',
      '金额'
    ])
    expect(specs.find((s) => s.id === SEED_PREFIX + 'label')?.params.map((p) => p.name)).toEqual([
      '品名',
      '价格'
    ])

    // v2：不存在 param 画布元素；每个参数名都有至少一个 text 元素以 {{名称}} 引用
    for (const s of specs) {
      expect(s.content.elements.some((e) => (e.type as string) === 'param')).toBe(false)
      for (const p of s.params) {
        expect(
          s.content.elements.some(
            (e) => e.type === 'text' && typeof e.props.text === 'string' && e.props.text.includes(`{{${p.name}}}`)
          )
        ).toBe(true)
      }
    }
  })

  it('SEED_VERSION 为 m3-v2-params', () => {
    expect(SEED_VERSION).toBe('m3-v2-params')
  })

  it('首次播种插入 3 个；第二次幂等不重复', async () => {
    const seed = new SeedService(dataDir, svc)
    const r1 = await seed.seedIfNeeded()
    expect(r1.inserted).toHaveLength(3)
    const r2 = await seed.seedIfNeeded()
    expect(r2.inserted).toHaveLength(0)
    const list = await svc.list({})
    expect(list.filter((t) => t.category === '示例')).toHaveLength(3)
  })

  it('播种版本不匹配时按固定 id 强制 upsert，覆盖旧版内置模板', async () => {
    const seed = new SeedService(dataDir, svc)
    await seed.seedIfNeeded()
    const certId = SEED_PREFIX + 'cert'
    const old = (await svc.get(certId))!
    // 模拟旧版本内置模板被用户环境保留：改名并把版本标记拨旧
    await svc.save({ ...old, name: '旧内置证书' })
    saveSettings(dataDir, { ...loadSettings(dataDir), seededTemplatesVersion: 'm3-v1' })

    const r = await seed.seedIfNeeded()
    // 已存在固定 id 也会被覆盖写入（3 个全部 upsert），id 不变、不产生重复
    expect(r.inserted).toHaveLength(3)
    const list = await svc.list({})
    expect(list.filter((t) => t.category === '示例')).toHaveLength(3)
    const updated = await svc.get(certId)
    expect(updated?.name).toBe('示例 · A4 荣誉证书')
    expect(
      updated?.content.elements.some(
        (e) => e.type === 'text' && e.props.text === '兹证明 {{姓名}} 同志：'
      )
    ).toBe(true)
  })
})
