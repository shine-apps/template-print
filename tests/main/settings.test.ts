import { describe, it, expect, beforeEach } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSettings, saveSettings, type AppSettings } from '../../electron/main/settings'

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
    const s: AppSettings = { defaultPrinterName: 'HP LaserJet' }
    saveSettings(dir, s)
    expect(loadSettings(dir).defaultPrinterName).toBe('HP LaserJet')
  })
  it('坏 JSON 回退默认值且不抛异常', () => {
    rmSync(dir, { recursive: true, force: true })
    const { mkdirSync, writeFileSync } = require('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), '{bad json')
    expect(loadSettings(dir).defaultPrinterName).toBeNull()
  })
})
