import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export interface AppSettings {
  defaultPrinterName: string | null
}

const DEFAULTS: AppSettings = { defaultPrinterName: null }

export function loadSettings(dataDir: string): AppSettings {
  try {
    const raw = readFileSync(join(dataDir, 'settings.json'), 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(dataDir: string, s: AppSettings): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(s, null, 2), 'utf-8')
}
