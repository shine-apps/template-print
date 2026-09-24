import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { paths } from './app-paths'
import { createDb } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { registerIpc, type Services } from './ipc'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { AssetRepository } from '../../db/repositories/asset-repo'
import { JobRepository } from '../../db/repositories/job-repo'
import { AssetService } from './services/asset-service'
import { TemplateService } from './services/template-service'
import { HistoryService } from './services/history-service'
import { PrintService } from './services/print-service'
import { PrinterService } from './services/printer-service'
import { SettingsService } from './services/settings-service'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  // electron-vite dev 下由其注入 dev server URL；打包后加载文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  const p = paths()
  const client = createDb(p.dbFile)
  runMigrations(client)
  const settings = new SettingsService(p.dataDir)
  const assets = new AssetService(p.dataDir, new AssetRepository(client.db))
  const templates = new TemplateService(new TemplateRepository(client.db), assets)
  const history = new HistoryService(p.dataDir, new JobRepository(client.db), settings)
  const print = new PrintService(p.dataDir, assets, history)
  const printers = new PrinterService(p.dataDir, print)
  const services: Services = { assets, templates, history, print, printers, settings }
  const win = createWindow()
  registerIpc(win, services)
  history.runScheduledCleanup()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
