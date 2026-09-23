import { contextBridge, ipcRenderer } from 'electron'
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
  print: {
    submit: (input: unknown) => ipcRenderer.invoke(IPC.printSubmit, input)
  },
  jobs: {
    list: (filter?: unknown) => ipcRenderer.invoke(IPC.jobsList, filter),
    get: (id: string) => ipcRenderer.invoke(IPC.jobsGet, id)
  },
  thumbUrl: (path: string) => ipcRenderer.invoke(IPC.thumbFileUrl, path)
}

contextBridge.exposeInMainWorld('api', api)
export type {}
