import { describe, it, expect } from 'vitest'
import { buildGuardianScript, type GuardianParams } from '../../electron/main/update/guardian-script'

describe('buildGuardianScript', () => {
  const script = buildGuardianScript()

  it('输出为纯 ASCII（PS5.1 无 BOM UTF-8 兼容性）', () => {
    expect(/^[\x00-\x7F]*$/.test(script)).toBe(true)
  })

  it('包含全部关键步骤标记', () => {
    for (const marker of [
      "Get-Content (Join-Path $scriptDir 'guardian-params.json') -Encoding UTF8 -Raw",
      'robocopy',
      // NSIS 分支
      "-ArgumentList \"/S /D=$installDir\" -Wait -PassThru",
      // MSI 分支
      "msiexec.exe",
      'INSTALLDIR="',
      '3010',
      "Write-GuardianState 'done'",
      "Write-GuardianState 'failed'",
      '-Verb RunAs',
      'ShellExecute',
      'backup-',
      '$params.logPath',
      'wait-process-timeout',
      'backup-failed',
      'installer-failed',
      'verify-failed'
    ]) {
      expect(script).toContain(marker)
    }
  })
})

describe('GuardianParams 形状（文档化，供服务端生成 params 文件）', () => {
  it('字段齐全', () => {
    const p: GuardianParams = {
      setupPath: 'C:/x/setup.exe',
      exePath: 'C:/Program Files/TemplatePrint/TemplatePrint.exe',
      statePath: 'C:/u/updates/install-state.json',
      backupDir: 'C:/u/updates/backup-0.1.0',
      logPath: 'C:/u/updates/guardian.log',
      fromVersion: '0.1.0',
      toVersion: '0.2.0'
    }
    expect(p.toVersion).toBe('0.2.0')
  })
})
