import type { BrowserWindow } from 'electron'
import { registerTemplateHandlers } from '../services/template-service'
import { registerAssetHandlers } from '../services/asset-service'

export interface Services {
  // Task 8/9 起填充 assets/templates；printers/print/history 在后续任务补齐
}

export function registerIpc(_mainWindow: BrowserWindow, deps: Services): void {
  registerTemplateHandlers(deps)
  registerAssetHandlers(deps)
  // printers/print/history 通道在后续任务注册
}
