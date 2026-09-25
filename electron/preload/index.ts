import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../../shared/ipc-contract'

const api = {
  templates: {
    list: (filter?: unknown) => ipcRenderer.invoke(IPC.templatesList, filter),
    get: (id: string) => ipcRenderer.invoke(IPC.templatesGet, id),
    create: (input: unknown) => ipcRenderer.invoke(IPC.templatesCreate, input),
    save: (doc: unknown) => ipcRenderer.invoke(IPC.templatesSave, doc),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.templatesDuplicate, id),
    delete: (id: string) => ipcRenderer.invoke(IPC.templatesDelete, id),
    export: (id: string) => ipcRenderer.invoke(IPC.templatesExport, id),
    importTplx: () => ipcRenderer.invoke(IPC.templatesImport)
  },
  assets: {
    import: (input: unknown) => ipcRenderer.invoke(IPC.assetsImport, input),
    dataUrl: (id: string) => ipcRenderer.invoke(IPC.assetsDataUrl, id),
    listUrls: (templateId: string) => ipcRenderer.invoke(IPC.assetsListUrls, templateId)
  },
  printers: {
    list: () => ipcRenderer.invoke(IPC.printersList),
    getDefault: () => ipcRenderer.invoke(IPC.printersGetDefault),
    setDefault: (name: string) => ipcRenderer.invoke(IPC.printersSetDefault, name),
    testPage: (name: string) => ipcRenderer.invoke(IPC.printersTestPage, name),
    status: (names: string[]) => ipcRenderer.invoke(IPC.printersStatus, names)
  },
  fonts: {
    list: () => ipcRenderer.invoke(IPC.fontsList)
  },
  print: {
    submit: (input: unknown) => ipcRenderer.invoke(IPC.printSubmit, input)
  },
  jobs: {
    list: (filter?: unknown) => ipcRenderer.invoke(IPC.jobsList, filter),
    get: (id: string) => ipcRenderer.invoke(IPC.jobsGet, id),
    cleanup: (input: unknown) => ipcRenderer.invoke(IPC.jobsCleanup, input),
    count: () => ipcRenderer.invoke(IPC.jobsCount)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: unknown) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  backups: {
    run: () => ipcRenderer.invoke(IPC.backupRun),
    openDir: () => ipcRenderer.invoke(IPC.backupOpen)
  },
  update: {
    check: (manual: boolean) => ipcRenderer.invoke(IPC.updateCheck, manual),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    cancel: () => ipcRenderer.invoke(IPC.updateCancel),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    skipVersion: (version: string | null) => ipcRenderer.invoke(IPC.updateSkipVersion, version),
    openLogDir: () => ipcRenderer.invoke(IPC.updateOpenLogDir),
    on: (channel: string, cb: (payload: unknown) => void): (() => void) => {
      const allowed = ['update:checkResult', 'update:progress', 'update:installFailed', 'update:installed']
      if (!allowed.includes(channel)) return () => {}
      const handler = (_e: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
  system: {
    // File.path 自 Electron 32 起移除，渲染进程必须经此桥接（webUtils 只在主/preload 可用）
    pathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  thumbUrl: (path: string) => ipcRenderer.invoke(IPC.thumbFileUrl, path)
}

contextBridge.exposeInMainWorld('api', api)
export type {}
