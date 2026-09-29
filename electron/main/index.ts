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
  // 注意：此处只创建窗口，不加载页面。由调用方在 registerIpc 之后再 load，
  // 保证渲染端发出的首个 IPC（templates:get/list 等）一定已有处理器。
  win.on('closed', () => {
    mainWindow = null
  })
  mainWindow = win
  return win
}

function loadWindow(win: BrowserWindow): void {
  // electron-vite dev 下由其注入 dev server URL；打包后加载文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
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
    // 仅打包后移除 Electron 默认菜单栏；dev 保留菜单方便开发调试（刷新/开发者工具等）
    if (app.isPackaged) Menu.setApplicationMenu(null)
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
    // 先建窗口、注册全部 IPC，最后才加载页面：渲染进程脚本一就绪即可成功调用 IPC，
    // 不会出现"页面已显示但首个 templates:get 无处理器/排队"的窗口期
    const win = createWindow()
    registerIpc(win, services)
    loadWindow(win)
    // seed 事务与历史清理都是 better-sqlite3 同步操作，冷启动时会短暂占满主进程事件循环
    // （叠加杀软扫描 app.db 更慢）。推迟到首屏加载完成后执行，并再让出 300ms 给渲染端
    // 首批 IPC（模板列表/详情）优先处理，避免设计器数据加载被播种任务拖慢。
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (win.isDestroyed()) return
        void seeds.seedIfNeeded()
          .then(() => {
            history.runScheduledCleanup()
            void backups.runDaily()
          })
          .catch((e) => console.error('startup seed/maintenance failed:', e))
      }, 300)
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) loadWindow(createWindow())
      else activateMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
