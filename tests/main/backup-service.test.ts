import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync, existsSync } from 'node:fs'
import { pickPruned, BackupService } from '../../electron/main/services/backup-service'
import { createDb } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { loadSettings, saveSettings } from '../../electron/main/settings'

describe('pickPruned', () => {
  it('非备份文件忽略；超出保留份数的旧文件被选中', () => {
    const names = [
      'notabackup.db',
      'backup-20260918-090000.db',
      'backup-20260920-090000.db',
      'backup-20260922-090000.db',
      'backup-20260923-090000.db',
      'backup-20260924-090000.db',
      'backup-20260921-090000.db',
      'backup-20260919-090000.db'
    ]
    // 7 个备份文件保留最新 5 份 → 裁剪最旧 2 个
    expect(pickPruned(names, 5).sort()).toEqual(
      ['backup-20260918-090000.db', 'backup-20260919-090000.db'].sort()
    )
    expect(pickPruned(names, 5)).not.toContain('notabackup.db')
  })

  it('未超出保留份数时不裁剪；默认保留 7 份', () => {
    const names = Array.from({ length: 7 }, (_v, i) => `backup-2026090${i + 1}-090000.db`)
    expect(pickPruned(names)).toEqual([])
    const eight = [...names, 'backup-20260910-090000.db']
    expect(pickPruned(eight)).toEqual(['backup-20260901-090000.db'])
  })
})

describe('BackupService', () => {
  it('backupNow 生成可打开的 db 文件，runDaily 同一天只执行一次', async () => {
    const dataDir = join(tmpdir(), `tp-bak-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const backupsDir = join(dataDir, 'backups')
    mkdirSync(backupsDir, { recursive: true })
    const client = createDb(join(dataDir, 'app.db'))
    runMigrations(client)
    const svc = new BackupService(dataDir, backupsDir, client)
    const f1 = await svc.backupNow()
    expect(existsSync(f1)).toBe(true)
    saveSettings(dataDir, { ...loadSettings(dataDir), lastBackupAt: Date.now() })
    expect(await svc.runDaily()).toBe(false)
    saveSettings(dataDir, { ...loadSettings(dataDir), lastBackupAt: Date.now() - 2 * 86_400_000 })
    expect(await svc.runDaily()).toBe(true)
    client.sqlite.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
})
