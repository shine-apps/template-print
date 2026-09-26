import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../../shared/app-info'
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
import { FontService } from './services/font-service'
import { SettingsService } from './services/settings-service'
import { BackupService } from './services/backup-service'
import { SeedService } from './services/seed-service'
import { UpdateService } from './services/update-service'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    // 标题栏显示应用名+版本，如 "模板打印 v0.2.0"
    title: `${APP_NAME} V${app.getVersion()}`,
    // 窗口左上角与任务栏图标；app.getAppPath() 在 dev 指向项目根、打包后指向 app.asar，
    // 两者下 resources/icon.png 都存在（electron-builder.yml 的 files 已将 resources/** 打入包）
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
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
  win.on('closed', () => {
    mainWindow = null
  })
  mainWindow = win
  return win
}

/**
 * 单实例：第二个实例启动时 requestSingleInstanceLock() 失败、立即退出；
 * 已运行的实例收到 second-instance 事件，把主窗口恢复并提到前台。
 */
function activateMainWindow(): void {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
  if (!win) return

  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.moveTop()
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // 已有实例运行：第二实例立即退出，不创建任何窗口
  app.quit()
} else {
  app.on('second-instance', () => {
    activateMainWindow()
  })

  app.whenReady().then(async () => {
    // 不显示 Electron 默认菜单栏（文件/编辑/视图…）
    Menu.setApplicationMenu(null)
    const p = paths()
    const client = createDb(p.dbFile)
    runMigrations(client)
    const settings = new SettingsService(p.dataDir)
    const assets = new AssetService(p.dataDir, new AssetRepository(client.db))
    const templates = new TemplateService(new TemplateRepository(client.db), assets)
    const history = new HistoryService(p.dataDir, new JobRepository(client.db), settings)
    const print = new PrintService(p.dataDir, assets, history)
    const printers = new PrinterService(p.dataDir, print)
    const fonts = new FontService()
    const backups = new BackupService(p.dataDir, p.backupsDir, client)
    const seeds = new SeedService(p.dataDir, templates)
    const update = UpdateService.createDefault(p.dataDir)
    const services: Services = { assets, templates, history, print, printers, fonts, settings, backups, update }
    createWindow()
    registerIpc(mainWindow!, services)
    await seeds.seedIfNeeded()
    history.runScheduledCleanup()
    void backups.runDaily()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else activateMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
