import { ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import type { Services } from '../ipc'

export function registerUpdateHandlers(deps: Services, win: BrowserWindow): void {
  const svc = deps.update
  const forward = (channel: string) => (payload: unknown) => win.webContents.send(channel, payload)
  svc.on('update:checkResult', forward('update:checkResult'))
  svc.on('update:progress', forward('update:progress'))
  svc.on('update:installFailed', forward('update:installFailed'))
  svc.on('update:installed', forward('update:installed'))

  ipcMain.removeHandler(IPC.updateCheck)
  ipcMain.handle(IPC.updateCheck, (_e, manual: boolean) => svc.check(manual))
  ipcMain.removeHandler(IPC.updateDownload)
  ipcMain.handle(IPC.updateDownload, () => svc.download())
  ipcMain.removeHandler(IPC.updateCancel)
  ipcMain.handle(IPC.updateCancel, () => svc.cancelDownload())
  ipcMain.removeHandler(IPC.updateInstall)
  ipcMain.handle(IPC.updateInstall, () => svc.install())
  ipcMain.removeHandler(IPC.updateSkipVersion)
  ipcMain.handle(IPC.updateSkipVersion, (_e, version: string | null) => svc.skipVersion(version))
  ipcMain.removeHandler(IPC.updateOpenLogDir)
  ipcMain.handle(IPC.updateOpenLogDir, () => shell.openPath(svc.logDir))

  // 启动安装结果处理（done/failed 通知）与每日自动检查
  void svc.handleInstallState()
  svc.startAutoCheck()
}
