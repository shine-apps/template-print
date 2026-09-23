import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import type { AssetService } from '../services/asset-service'
import type { TemplateService } from '../services/template-service'
import type { PrintService } from '../services/print-service'
import type { PrinterService } from '../services/printer-service'
import type { HistoryService } from '../services/history-service'
import { registerTemplateHandlers } from '../services/template-service'
import { registerAssetHandlers } from '../services/asset-service'
import { registerPrinterHandlers } from '../services/printer-service'
import { registerPrintHandlers } from '../services/print-service'
import { registerHistoryHandlers } from '../services/history-service'

export interface Services {
  assets: AssetService
  templates: TemplateService
  print: PrintService
  printers: PrinterService
  history: HistoryService
}

export function registerIpc(mainWindow: BrowserWindow, deps: Services): void {
  registerTemplateHandlers(deps)
  registerAssetHandlers(deps)
  registerPrinterHandlers(deps, mainWindow)
  registerPrintHandlers(deps, mainWindow)
  registerHistoryHandlers(deps)
  // thumb 通道先移除再注册（registerHistoryHandlers 已注册一次，此处保证幂等）
  ipcMain.removeHandler(IPC.thumbFileUrl)
  ipcMain.handle(IPC.thumbFileUrl, (_e, p: string) => deps.history.thumbDataUrl(p))
}
