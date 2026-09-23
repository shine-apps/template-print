import { ipcMain, BrowserWindow } from 'electron'
import { IPC, type PrinterInfoDto, type SubmitPrintInput } from '../../../shared/ipc-contract'
import { loadSettings, saveSettings, type AppSettings } from '../settings'
import { createTemplate, createElement } from '../../../print-core/template-model'
import type { PrintService } from './print-service'
import type { Services } from '../ipc'

export class PrinterService {
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
}
