import { execFile } from 'node:child_process'
import { ipcMain } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import type { FontListDto as SharedFontListDto } from '../../../shared/ipc-contract'
import type { Services } from '../ipc'

/** DTO 定义在 shared（避免 shared 反向依赖 electron），此处仅类型重导出供测试/主进程使用 */
export type FontListDto = SharedFontListDto

/** 常用字体：英文名即注册表中的实际家族名（宋体=SimSun、黑体=SimHei、楷体=KaiTi、仿宋=FangSong） */
export const COMMON_FONTS = [
  'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong',
  'Arial', 'Times New Roman', 'Calibri', 'Courier New', 'Segoe UI'
]

/** 注册表查询失败/无结果时的兜底字体，保证下拉始终有基础项 */
export const FALLBACK_FONTS = [
  'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong',
  'Arial', 'Times New Roman', 'Calibri', 'Courier New', 'Segoe UI'
]

/** 注册表属性名 → 家族名：去 (TrueType)/(OpenType) 后缀，按 & 拆复合名；跳过 PS* 元属性 */
export function parseFontRegistryEntries(names: string[]): string[] {
  const set = new Set<string>()
  for (const raw of names) {
    if (typeof raw !== 'string' || raw.startsWith('PS')) continue
    const stripped = raw.replace(/\s*\((?:TrueType|OpenType)\)\s*$/i, '').trim()
    for (const part of stripped.split('&')) {
      const n = part.trim()
      if (n) set.add(n)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** 兜底字体与注册表枚举合并去重排序；common 仅保留实际存在于 all 的常用字体 */
export function buildFontList(detected: string[]): FontListDto {
  const all = [...new Set([...FALLBACK_FONTS, ...detected])].sort((a, b) => a.localeCompare(b))
  return {
    all,
    common: COMMON_FONTS.filter((c) => all.includes(c)),
    defaultFont: ''
  }
}

const PS_COMMAND = [
  "$paths = @('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',",
  "'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts');",
  "$paths | ForEach-Object { if (Test-Path $_) {",
  "(Get-ItemProperty $_).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } |",
  "ForEach-Object { $_.Name } } }"
].join(' ')

export class FontService {
  private cache: FontListDto | null = null

  async list(): Promise<FontListDto> {
    if (this.cache) return this.cache
    // 查询失败（非 Windows / 超时 / 退出码非 0）一律回落空数组 → 仅兜底字体
    const detected = await this.queryRegistry().catch(() => [])
    this.cache = buildFontList(detected)
    return this.cache
  }

  private queryRegistry(timeoutMs = 3000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PS_COMMAND],
        { timeout: timeoutMs, windowsHide: true }
      )
      let out = ''
      child.stdout?.on('data', (d: string) => { out += d })
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0
          ? resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
          : reject(new Error(`ps exit ${code ?? 'null'}`))
      )
    })
  }
}

export function registerFontHandlers(deps: Services): void {
  ipcMain.removeHandler(IPC.fontsList)
  ipcMain.handle(IPC.fontsList, () => deps.fonts.list())
}
