import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

let dataDir = ''

export function paths() {
  if (!dataDir) {
    // app.getPath('userData') 在 app ready 前也可用于 setPath；此处直接取默认目录
    dataDir = app.getPath('userData')
    mkdirSync(join(dataDir, 'assets'), { recursive: true })
    mkdirSync(join(dataDir, 'thumbs'), { recursive: true })
    mkdirSync(join(dataDir, 'print-tmp'), { recursive: true })
  }
  return {
    dataDir,
    dbFile: join(dataDir, 'app.db'),
    settingsFile: join(dataDir, 'settings.json'),
    assetsDir: join(dataDir, 'assets'),
    thumbsDir: join(dataDir, 'thumbs'),
    printTmpDir: join(dataDir, 'print-tmp')
  }
}

/** 仅供测试注入目录 */
export function _setDataDirForTest(p: string): void {
  dataDir = p
}
