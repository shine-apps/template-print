export interface AppSettingsDto {
  defaultPrinterName: string | null
  seededTemplatesVersion: string | null
  historyRetentionDays: number | null
  lastBackupAt: number | null
  paperHintsConfirmed: string[]
}

export type SettingsPatch = Partial<Pick<AppSettingsDto, 'historyRetentionDays' | 'paperHintsConfirmed'>>
