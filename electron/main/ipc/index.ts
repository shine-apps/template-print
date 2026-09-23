import type { BrowserWindow } from 'electron'
import { registerTemplateHandlers } from '../services/template-service'
import { registerAssetHandlers } from '../services/asset-service'
import type { AssetService } from '../services/asset-service'

export interface Services {
  // Task 8 起 assets 可用；templates 在 Task 9 填充；其余服务在后续任务补齐
  assets?: AssetService
}

export function registerIpc(_mainWindow: BrowserWindow, deps: Services): void {
  registerTemplateHandlers(deps)
  registerAssetHandlers(deps)
  // printers/print/history 通道在后续任务注册
}
