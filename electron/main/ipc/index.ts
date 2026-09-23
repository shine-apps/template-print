import type { BrowserWindow } from 'electron'
import { registerTemplateHandlers } from '../services/template-service'
import { registerAssetHandlers } from '../services/asset-service'
import type { AssetService } from '../services/asset-service'
import type { TemplateService } from '../services/template-service'

export interface Services {
  assets: AssetService
  templates: TemplateService
  // printers/print/history 在后续任务补齐（Task 18+）
}

export function registerIpc(_mainWindow: BrowserWindow, deps: Services): void {
  registerTemplateHandlers(deps)
  registerAssetHandlers(deps)
  // printers/print/history 通道在后续任务注册
}
