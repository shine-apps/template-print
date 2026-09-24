import { ipcMain } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import type { AppSettingsDto, SettingsPatch } from '../../../shared/settings-dto'
import { loadSettings, saveSettings, patchSettings, type AppSettings } from '../settings'
import type { Services } from '../ipc'

export class SettingsService {
  constructor(private dataDir: string) {}

  get(): AppSettings {
    return loadSettings(this.dataDir)
  }

  set(patch: SettingsPatch): AppSettings {
    const next = patchSettings(loadSettings(this.dataDir), patch as Record<string, unknown>)
    saveSettings(this.dataDir, next)
    return next
  }
}

export function registerSettingsHandlers(deps: Services): void {
  const svc = deps.settings
  ipcMain.removeHandler(IPC.settingsGet)
  ipcMain.handle(IPC.settingsGet, (): AppSettingsDto => svc.get())
  ipcMain.removeHandler(IPC.settingsSet)
  ipcMain.handle(IPC.settingsSet, (_e, patch: SettingsPatch): AppSettingsDto => svc.set(patch))
}
