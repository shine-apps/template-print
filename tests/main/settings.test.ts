import { describe, it, expect, beforeEach } from 'vitest'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { patchSettings, loadSettings, saveSettings, type AppSettings } from '../../electron/main/settings'

let dir: string
beforeEach(() => {
  dir = join(tmpdir(), `tp-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
})

describe('settings.json', () => {
  it('文件不存在时返回默认值', () => {
    const s = loadSettings(dir)
    expect(s.defaultPrinterName).toBeNull()
  })
  it('保存后可重新读取', () => {
    const s: AppSettings = {
      defaultPrinterName: 'HP LaserJet',
      seededTemplatesVersion: null,
      historyRetentionDays: null,
      lastBackupAt: null,
      paperHintsConfirmed: []
    }
    saveSettings(dir, s)
    expect(loadSettings(dir).defaultPrinterName).toBe('HP LaserJet')
  })
  it('坏 JSON 回退默认值且不抛异常', () => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), '{bad json')
    expect(loadSettings(dir).defaultPrinterName).toBeNull()
  })
})

const base: AppSettings = {
  defaultPrinterName: 'p1',
  seededTemplatesVersion: null,
  historyRetentionDays: null,
  lastBackupAt: null,
  paperHintsConfirmed: []
}

describe('patchSettings', () => {
  it('允许修改保留天数（0 归一为 null）', () => {
    expect(patchSettings(base, { historyRetentionDays: 90 }).historyRetentionDays).toBe(90)
    expect(patchSettings(base, { historyRetentionDays: 0 }).historyRetentionDays).toBeNull()
    expect(patchSettings(base, { historyRetentionDays: -3 }).historyRetentionDays).toBeNull()
  })
  it('允许替换已确认提示列表', () => {
    const s = patchSettings(base, { paperHintsConfirmed: ['a|40x30'] })
    expect(s.paperHintsConfirmed).toEqual(['a|40x30'])
  })
  it('忽略白名单外键与非法类型', () => {
    const s = patchSettings(base, { defaultPrinterName: 'x', paperHintsConfirmed: [1, 2] } as never)
    expect(s.defaultPrinterName).toBe('p1')
    expect(s.paperHintsConfirmed).toEqual([])
  })
  it('旧 settings.json 缺字段时 loadSettings 补默认值', () => {
    const legacyDir = join(tmpdir(), `tp-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'settings.json'), JSON.stringify({ defaultPrinterName: 'old' }))
    const s = loadSettings(legacyDir)
    expect(s.defaultPrinterName).toBe('old')
    expect(s.paperHintsConfirmed).toEqual([])
    expect(s.historyRetentionDays).toBeNull()
  })
})
