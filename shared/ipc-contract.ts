import type { TemplateDocument } from '../print-core/template-model'
import type { JobListItem } from '../db/repositories/job-repo'
import type { AppSettingsDto, SettingsPatch } from './settings-dto'

export interface PrinterInfoDto {
  name: string
  isDefault: boolean
}

/** 打印机运行时状态（PowerShell Get-Printer 查询结果的归一化五态） */
export type PrinterRuntimeStatus = 'ready' | 'offline' | 'paper-out' | 'error' | 'unknown'

export interface NewTemplateInput {
  name: string
  category?: string
  widthMm: number
  heightMm: number
}

export interface SubmitPrintInput {
  /** 工作副本：可能是已存模板（含 id）或历史快照（id 可空） */
  template: TemplateDocument
  paramValues: Record<string, string>
  printerName: string
  copies: number
  mode: 'silent' | 'dialog'
}

export interface SubmitPrintResult {
  jobId: string
  status: 'success' | 'failed' | 'cancelled'
  errorMessage: string | null
  thumbPath: string | null
}

export interface JobListFilter {
  templateId?: string
  from?: number
  to?: number
  keyword?: string
  statuses?: ('success' | 'failed' | 'cancelled')[]
  printerName?: string
}

export const IPC = {
  templatesList: 'templates:list',
  templatesGet: 'templates:get',
  templatesCreate: 'templates:create',
  templatesSave: 'templates:save',
  templatesDuplicate: 'templates:duplicate',
  templatesDelete: 'templates:delete',
  templatesExport: 'templates:export',
  templatesImport: 'templates:import',
  assetsImport: 'assets:import',
  assetsDataUrl: 'assets:data-url',
  assetsListUrls: 'assets:list-urls',
  printersList: 'printers:list',
  printersGetDefault: 'printers:get-default',
  printersSetDefault: 'printers:set-default',
  printersTestPage: 'printers:test-page',
  printersStatus: 'printers:status',
  printSubmit: 'print:submit',
  jobsList: 'jobs:list',
  jobsGet: 'jobs:get',
  thumbFileUrl: 'thumb:file-url',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const

export interface Api {
  templates: {
    list(filter?: { category?: string; keyword?: string }): Promise<TemplateDocument[]>
    get(id: string): Promise<TemplateDocument | null>
    create(input: NewTemplateInput): Promise<TemplateDocument>
    save(doc: TemplateDocument): Promise<void>
    duplicate(id: string): Promise<TemplateDocument>
    delete(id: string): Promise<void>
    export(id: string): Promise<{ canceled: boolean; path?: string }>
    importTplx(): Promise<{ canceled: boolean; id?: string }>
  }
  assets: {
    import(input: { templateId: string; sourcePath: string }): Promise<{ assetId: string }>
    dataUrl(assetId: string): Promise<string>
    listUrls(templateId: string): Promise<Record<string, string>>
  }
  printers: {
    list(): Promise<PrinterInfoDto[]>
    getDefault(): Promise<string | null>
    setDefault(name: string): Promise<void>
    testPage(name: string): Promise<void>
    status(names: string[]): Promise<Record<string, PrinterRuntimeStatus>>
  }
  print: {
    submit(input: SubmitPrintInput): Promise<SubmitPrintResult>
  }
  jobs: {
    list(filter?: JobListFilter): Promise<JobListItem[]>
    get(id: string): Promise<JobListItem | null>
  }
  settings: {
    get(): Promise<AppSettingsDto>
    set(patch: SettingsPatch): Promise<AppSettingsDto>
  }
  thumbUrl(path: string): Promise<string>
}

declare global {
  interface Window {
    api: Api
  }
}
