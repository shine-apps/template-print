import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import AdmZip from 'adm-zip'
import Database from 'better-sqlite3'
import { pickPruned, pickStaleTempFiles, BackupService } from '../../electron/main/services/backup-service'
import { createDb } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { loadSettings, saveSettings } from '../../electron/main/settings'

describe('pickPruned', () => {
  it('非备份文件忽略；超出保留份数的旧文件被选中（兼容 .zip 与旧版 .db）', () => {
    const names = [
      'notabackup.db',
      'backup-20260918-090000.zip',
      'backup-20260920-090000.zip',
      'backup-20260922-090000.db',
      'backup-20260923-090000.zip',
      'backup-20260924-090000.zip',
      'backup-20260921-090000.zip',
      'backup-20260919-090000.db'
    ]
    // 7 个备份文件保留最新 5 份 → 裁剪最旧 2 个
    expect(pickPruned(names, 5).sort()).toEqual(
      ['backup-20260918-090000.zip', 'backup-20260919-090000.db'].sort()
    )
    expect(pickPruned(names, 5)).not.toContain('notabackup.db')
  })

  it('未超出保留份数时不裁剪；默认保留 7 份', () => {
    const names = Array.from({ length: 7 }, (_v, i) => `backup-2026090${i + 1}-090000.zip`)
    expect(pickPruned(names)).toEqual([])
    const eight = [...names, 'backup-20260910-090000.zip']
    expect(pickPruned(eight)).toEqual(['backup-20260901-090000.zip'])
  })

  it('半成品 .part 与临时 .tmp db 由 pickStaleTempFiles 识别，不与正式备份混淆', () => {
    expect(pickStaleTempFiles([
      'backup-20260924-090000.zip.part',
      '.tmp-backup-20260924-090000.db',
      'backup-20260924-090000.zip',
      'random.txt'
    ]).sort()).toEqual(
      ['.tmp-backup-20260924-090000.db', 'backup-20260924-090000.zip.part'].sort()
    )
  })
})

describe('BackupService', () => {
  it('backupNow 生成 zip（app.db 快照 + assets + settings.json），runDaily 同一天只执行一次', async () => {
    const dataDir = join(tmpdir(), `tp-bak-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const backupsDir = join(dataDir, 'backups')
    mkdirSync(join(dataDir, 'assets', 'tpl_x'), { recursive: true })
    mkdirSync(backupsDir, { recursive: true })
    const client = createDb(join(dataDir, 'app.db'))
    runMigrations(client)
    // 造一张图片资产源文件与应用设置
    writeFileSync(join(dataDir, 'assets', 'tpl_x', 'ast_1.png'), Buffer.from([1, 2, 3, 4, 5]))
    saveSettings(dataDir, { ...loadSettings(dataDir), autoCheckUpdates: false })

    const svc = new BackupService(dataDir, backupsDir, client)
    const f1 = await svc.backupNow()
    expect(f1.endsWith('.zip')).toBe(true)
    expect(existsSync(f1)).toBe(true)

    const zip = new AdmZip(f1)
    const readEntry = (name: string): Buffer => {
      const buf = zip.readFile(name)
      if (!buf) throw new Error(`备份中缺少 ${name}`)
      return buf
    }
    const entryNames = zip.getEntries().map((e) => e.entryName).sort()
    expect(entryNames).toContain('app.db')
    expect(entryNames).toContain('assets/tpl_x/ast_1.png')
    expect(entryNames).toContain('settings.json')
    expect(readEntry('assets/tpl_x/ast_1.png')).toEqual(Buffer.from([1, 2, 3, 4, 5]))
    expect(JSON.parse(readEntry('settings.json').toString('utf-8')).autoCheckUpdates).toBe(false)

    // app.db 必须是可打开的有效 SQLite 快照
    const snap = join(dataDir, 'snapshot-check.db')
    writeFileSync(snap, readEntry('app.db'))
    const ro = new Database(snap, { readonly: true })
    expect(ro.prepare('select count(*) as c from templates').get()).toEqual({ c: 0 })
    ro.close()
    rmSync(snap, { force: true })

    // 临时文件已清理
    expect(readdirSync(backupsDir).filter((n) => n.includes('.part') || n.startsWith('.tmp'))).toEqual([])

    saveSettings(dataDir, { ...loadSettings(dataDir), lastBackupAt: Date.now() })
    expect(await svc.runDaily()).toBe(false)
    saveSettings(dataDir, { ...loadSettings(dataDir), lastBackupAt: Date.now() - 2 * 86_400_000 })
    expect(await svc.runDaily()).toBe(true)
    client.sqlite.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('备份保留份数生效：连同历史旧包超出 7 份时最旧的被删除', async () => {
    const dataDir = join(tmpdir(), `tp-bak-keep-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const backupsDir = join(dataDir, 'backups')
    mkdirSync(backupsDir, { recursive: true })
    // 预置 8 个历史备份（01 最旧）
    for (let i = 1; i <= 8; i++) {
      writeFileSync(join(backupsDir, `backup-2026090${i}-090000.zip`), 'old')
    }
    const client = createDb(join(dataDir, 'app.db'))
    runMigrations(client)
    const svc = new BackupService(dataDir, backupsDir, client)
    const newest = await svc.backupNow()
    const zips = readdirSync(backupsDir).filter((n) => n.endsWith('.zip'))
    expect(zips.length).toBe(7)
    // 最旧的 01 被裁，新生成的保留
    expect(zips).not.toContain('backup-20260901-090000.zip')
    expect(zips).toContain(newest.split(/[\\/]/).pop())
    client.sqlite.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
})
