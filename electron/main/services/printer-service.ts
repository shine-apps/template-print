import { ipcMain, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { IPC, type PrinterInfoDto, type PrinterRuntimeStatus, type SubmitPrintInput } from '../../../shared/ipc-contract'
import { loadSettings, saveSettings, type AppSettings } from '../settings'
import { createTemplate, createElement } from '../../../print-core/template-model'
import type { PrintService } from './print-service'
import type { Services } from '../ipc'

const VALID: readonly PrinterRuntimeStatus[] = ['ready', 'offline', 'paper-out', 'error', 'unknown']

/**
 * 通过 PowerShell Get-Printer 查询单台打印机运行时状态。
 * 映射在 PowerShell 内完成（ConvertTo-Json 会把枚举序列化为数字，无法在 node 侧匹配），
 * 标准输出只允许是五态字符串之一；任何异常一律回落 unknown，绝不抛出。
 */
function queryPrinterStatus(name: string, timeoutMs = 3000): Promise<PrinterRuntimeStatus> {
  return new Promise((resolve) => {
    // 单引号转义防注入；参数数组执行，不经 shell 拼接
    const safe = name.replace(/'/g, "''")
    // 单行 switch（case 间靠 } 分隔，不得在 case 之间插分号）
    const command =
      `$p = Get-Printer -Name '${safe}' -ErrorAction SilentlyContinue; ` +
      `if ($null -eq $p) { 'unknown' } else { switch -Regex ($p.PrinterStatus.ToString()) { ` +
      `'^(Normal|Processing|Waiting|Busy|IOActive|Initialization|WarmingUp)$' { 'ready'; break } ` +
      `'^Offline$' { 'offline'; break } ` +
      `'^(PaperOut|PaperJam|NoToner|TonerLow|ManualFeed)$' { 'paper-out'; break } ` +
      `'^(Error|PaperProblem|NotAvailable|UserIntervention|OutOfMemory|ServerUnknown|Paused|PendingDeletion|PagePunt)$' { 'error'; break } ` +
      `default { 'unknown' } } }`
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: timeoutMs, windowsHide: true }
    )
    let out = ''
    child.stdout?.on('data', (d: string) => { out += d })
    child.on('error', () => resolve('unknown'))
    child.on('close', () => {
      const s = out.trim()
      resolve((VALID as readonly string[]).includes(s) ? (s as PrinterRuntimeStatus) : 'unknown')
    })
  })
}

export class PrinterService {
  /** 缓存进行中/已完成的查询 Promise，60 秒内的并发与重复调用共享同一次 PowerShell 查询 */
  private statusCache = new Map<string, { at: number; p: Promise<PrinterRuntimeStatus> }>()

  constructor(
    private dataDir: string,
    private print: PrintService
  ) {}

  async list(win: BrowserWindow): Promise<PrinterInfoDto[]> {
    const all = await win.webContents.getPrintersAsync()
    return all.map((p) => ({ name: p.name, isDefault: p.isDefault }))
  }
  getDefault(): string | null {
    return loadSettings(this.dataDir).defaultPrinterName
  }
  setDefault(name: string): void {
    saveSettings(this.dataDir, { defaultPrinterName: name } satisfies AppSettings)
  }
  testPage(name: string) {
    return this.print.submit(buildTestPageJob(name))
  }

  getStatus(name: string): Promise<PrinterRuntimeStatus> {
    const hit = this.statusCache.get(name)
    if (hit && Date.now() - hit.at < 60_000) return hit.p
    const p = queryPrinterStatus(name)
    this.statusCache.set(name, { at: Date.now(), p })
    return p
  }

  async getStatusMap(names: string[]): Promise<Record<string, PrinterRuntimeStatus>> {
    const out: Record<string, PrinterRuntimeStatus> = {}
    await Promise.all(names.map(async (n) => { out[n] = await this.getStatus(n) }))
    return out
  }
}

function buildTestPageJob(printerName: string): SubmitPrintInput {
  // 100×100mm：外框距纸边 5mm，用于判断可打印区域偏差；黑/灰色块检验色彩
  const tpl = createTemplate('__test_page__', '测试页', { widthMm: 100, heightMm: 100 })
  tpl.content.elements.push(
    createElement('shape', { shape: 'rect', strokeColor: '#000000', strokeWidthMm: 0.3, fillColor: null },
      { x: 5, y: 5, w: 90, h: 90 }),
    createElement('text', { text: 'Template Print 测试页', bold: true, fontSizeMm: 5 },
      { x: 10, y: 10, w: 80, h: 8 }),
    createElement('text', { text: `Printer: ${printerName}`, fontSizeMm: 3.5 },
      { x: 10, y: 22, w: 80, h: 6 }),
    createElement('text', { text: 'Paper: 100 x 100 mm', fontSizeMm: 3.5 },
      { x: 10, y: 30, w: 80, h: 6 }),
    createElement('shape', { shape: 'rect', strokeColor: '#000000', strokeWidthMm: 0, fillColor: '#000000' },
      { x: 10, y: 45, w: 20, h: 10 }),
    createElement('shape', { shape: 'rect', strokeColor: '#000000', strokeWidthMm: 0, fillColor: '#cccccc' },
      { x: 40, y: 45, w: 20, h: 10 })
  )
  // 固定走系统对话框，便于在对话框里核对纸张
  return { template: tpl, paramValues: {}, printerName, copies: 1, mode: 'dialog' }
}

export function registerPrinterHandlers(deps: Services, win: BrowserWindow): void {
  const svc = deps.printers
  ipcMain.handle(IPC.printersList, () => svc.list(win))
  ipcMain.handle(IPC.printersGetDefault, () => svc.getDefault())
  ipcMain.handle(IPC.printersSetDefault, (_e, name: string) => svc.setDefault(name))
  ipcMain.handle(IPC.printersTestPage, (_e, name: string) => svc.testPage(name))
  ipcMain.removeHandler(IPC.printersStatus)
  ipcMain.handle(IPC.printersStatus, (_e, names: string[]) => svc.getStatusMap(names))
}
