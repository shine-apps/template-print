import { ipcMain, BrowserWindow } from 'electron'
import { IPC, type PrinterInfoDto } from '../../../shared/ipc-contract'
import { loadSettings, saveSettings, type AppSettings } from '../settings'
import type { Services } from '../ipc'

export class PrinterService {
  constructor(private dataDir: string) {}

  async list(win: BrowserWindow): Promise<PrinterInfoDto[]> {
    const all = await win.webContents.getPrintersAsync()
    return all.map((p) => ({ name: p.name, isDefault: p.isDefault }))
  }
  getDefault(): string | null {
    return loadSettings(this.dataDir).defaultPrinterName
  }
  setDefault(name: string): void {
    const s: AppSettings = { defaultPrinterName: name }
    saveSettings(this.dataDir, s)
  }
}

export function registerPrinterHandlers(deps: Services, win: BrowserWindow): void {
  if (!deps.printers) return
  const svc = deps.printers
  ipcMain.handle(IPC.printersList, () => svc.list(win))
  ipcMain.handle(IPC.printersGetDefault, () => svc.getDefault())
  ipcMain.handle(IPC.printersSetDefault, (_e, name: string) => svc.setDefault(name))
  ipcMain.handle(IPC.printersTestPage, () => {
    throw new Error('Task 21')
  })
}
