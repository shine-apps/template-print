export interface AppSettingsDto {
  defaultPrinterName: string | null
  seededTemplatesVersion: string | null
  historyRetentionDays: number | null
  lastBackupAt: number | null
  paperHintsConfirmed: string[]
  autoCheckUpdates: boolean
  skippedUpdateVersion: string | null
  lastUpdateCheckAt: number | null
}

export type SettingsPatch = Partial<
  Pick<AppSettingsDto, 'historyRetentionDays' | 'paperHintsConfirmed' | 'autoCheckUpdates'>
>
