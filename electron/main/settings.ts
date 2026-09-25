import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export interface AppSettings {
  defaultPrinterName: string | null
  /** 内置模板播种版本；null 表示尚未播种 */
  seededTemplatesVersion: string | null
  /** 历史自动清理保留天数；null/0 = 永不自动清理 */
  historyRetentionDays: number | null
  /** 最近一次自动备份时间戳 */
  lastBackupAt: number | null
  /** 已确认不再提示的“打印机|宽x高”自定义纸张组合 */
  paperHintsConfirmed: string[]
  /** 是否启动后自动检查更新（每日一次） */
  autoCheckUpdates: boolean
  /** 用户跳过的更新版本；null=未跳过 */
  skippedUpdateVersion: string | null
  /** 最近一次检查更新时间戳（节流用） */
  lastUpdateCheckAt: number | null
}

const DEFAULTS: AppSettings = {
  defaultPrinterName: null,
  seededTemplatesVersion: null,
  historyRetentionDays: null,
  lastBackupAt: null,
  paperHintsConfirmed: [],
  autoCheckUpdates: true,
  skippedUpdateVersion: null,
  lastUpdateCheckAt: null
}

/** 渲染端允许通过 settings:set 修改的业务键（defaultPrinterName 走专用通道） */
export const SETTABLE_KEYS = [
  'historyRetentionDays',
  'paperHintsConfirmed',
  'autoCheckUpdates'
] as const
export type SettableKey = (typeof SETTABLE_KEYS)[number]

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

/**
 * 合并渲染端提交的部分字段；仅允许白名单键，且做基本类型校验。
 * 返回合并后的完整设置（调用方负责落盘）。
 */
export function patchSettings(current: AppSettings, patch: Record<string, unknown>): AppSettings {
  const next: AppSettings = { ...current }
  for (const key of SETTABLE_KEYS) {
    if (!(key in patch)) continue
    const v = patch[key]
    if (key === 'historyRetentionDays') {
      if (v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        next.historyRetentionDays = v === 0 ? null : (v as number)
      }
    } else if (key === 'paperHintsConfirmed') {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        next.paperHintsConfirmed = v as string[]
      }
    } else if (key === 'autoCheckUpdates') {
      if (typeof v === 'boolean') next.autoCheckUpdates = v
    }
  }
  return next
}
