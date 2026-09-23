import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { paths } from './app-paths'
import { createDb } from '../../db/client'
import { runMigrations } from '../../db/migrate'

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
  // Task 9 起把装配好的服务传入 registerIpc
  // registerIpc(createWindow(), {})
  const win = createWindow()
  void win
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
