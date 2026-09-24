import { BrowserWindow, ipcMain } from 'electron'
import type { WebContentsPrintOptions } from 'electron'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type SubmitPrintInput, type SubmitPrintResult } from '../../../shared/ipc-contract'
import { renderPrintDocument } from '../../../print-core/render-print-document'
import { evaluateParams } from '../../../print-core/param-evaluator'
import { mmToMicron, mmToPxAt96 } from '../../../shared/units'
import { TemplateDocumentSchema, localId, type TemplateDocument } from '../../../print-core/template-model'
import type { AssetService } from './asset-service'
import type { HistoryService } from './history-service'
import type { Services } from '../ipc'

function waitImagesReady(win: BrowserWindow, timeoutMs = 5000): Promise<void> {
  return Promise.race([
    win.webContents.executeJavaScript(
      `Promise.all([...document.images].map(img => img.complete ? Promise.resolve() :
        new Promise(res => { img.onload = res; img.onerror = res; }))).then(() => 'ready')`
    ) as Promise<string>,
    new Promise<void>((res) => setTimeout(res, timeoutMs))
  ]).then(() => undefined)
}

/** 给离屏隐藏窗口留出首次绘制时间，降低 capturePage 抓到空白缩略图的概率 */
function waitFirstPaint(ms = 300): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

function callPrint(
  win: BrowserWindow,
  opts: { silent: boolean; deviceName?: string; copies: number; widthMm: number; heightMm: number }
): Promise<{ success: boolean; reason: string | null }> {
  // 按 Electron 44 官方 WebContentsPrintOptions 构造；pageSize 的
  // { width, height } 即官方 Size 结构（单位微米），无需任何 as 断言。
  const printOptions: WebContentsPrintOptions = {
    silent: opts.silent,
    deviceName: opts.deviceName,
    copies: opts.copies,
    printBackground: true,
    margins: { marginType: 'none' },
    pageSize: { width: mmToMicron(opts.widthMm), height: mmToMicron(opts.heightMm) }
  }
  return new Promise((resolve) => {
    win.webContents.print(printOptions, (success, reason) =>
      resolve({ success, reason: reason ?? null })
    )
  })
}

export class PrintService {
  constructor(
    private dataDir: string,
    private assets: AssetService,
    private history: HistoryService
  ) {}

  private assetFileUrls(doc: TemplateDocument): Record<string, string> {
    const out: Record<string, string> = {}
    for (const el of doc.content.elements) {
      if (el.type === 'image') {
        try {
          out[el.props.assetId] = this.assets.fileUrl(el.props.assetId)
        } catch {
          /* 资产缺失：渲染为空并在打印前校验时拦截 */
        }
      }
    }
    return out
  }

  async submit(input: SubmitPrintInput): Promise<SubmitPrintResult> {
    // IPC 入参不可信，先经模型校验（非法结构直接 reject，由渲染端提示）
    const doc = TemplateDocumentSchema.parse(input.template)
    const paramValues = input.paramValues
    // 打印前校验：图片资产必须存在
    for (const el of doc.content.elements) {
      if (el.type === 'image' && !this.assets.repo.get(el.props.assetId)) {
        throw new Error(`模板引用的图片不存在（元素 ${el.id}），请重新上传后再打印`)
      }
    }
    const values = evaluateParams(doc.params, paramValues)
    if (values.__errors?.length) throw new Error(`必填项未填：${values.__errors.join(', ')}`)

    const html = renderPrintDocument(doc, values, this.assetFileUrls(doc))
    const jobId = localId('job')
    const htmlPath = join(this.dataDir, 'print-tmp', `${jobId}.html`)
    writeFileSync(htmlPath, html, 'utf-8')

    // 离屏窗口内容区按纸张 96dpi 物理像素设置，保证抓帧得到完整纸张
    // （Windows 窗口最小客户区约 136px，给一个下限）。
    const pageW = Math.max(160, Math.round(mmToPxAt96(doc.paper.widthMm)))
    const pageH = Math.max(160, Math.round(mmToPxAt96(doc.paper.heightMm)))

    const win = new BrowserWindow({
      show: false,
      width: pageW,
      height: pageH,
      useContentSize: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: false }
    })

    let status: 'success' | 'failed' | 'cancelled' = 'failed'
    let errorMessage: string | null = null
    let thumbPath: string | null = null

    try {
      await win.loadFile(htmlPath)
      await waitImagesReady(win)
      // 补强 A：图片就绪后再等一个绘制节拍，避免隐藏窗口首帧未完成就抓缩略图
      await waitFirstPaint(300)

      // 缩略图（打印前抓帧）：只截纸张区域，宽度统一缩到 240px
      try {
        const image = await win.webContents.capturePage({ x: 0, y: 0, width: pageW, height: pageH })
        thumbPath = join('thumbs', `${jobId}.png`)
        writeFileSync(join(this.dataDir, thumbPath), image.resize({ width: 240 }).toPNG())
      } catch {
        thumbPath = null
      }

      const { success, reason } = await callPrint(win, {
        silent: input.mode === 'silent',
        deviceName: input.printerName || undefined,
        copies: input.copies,
        widthMm: doc.paper.widthMm,
        heightMm: doc.paper.heightMm
      })
      // Electron：用户在系统对话框取消时 failureReason 为 'cancelled'
      if (reason === 'cancelled') status = 'cancelled'
      else if (success) status = 'success'
      else {
        status = 'failed'
        errorMessage = reason
      }
    } catch (e) {
      status = 'failed'
      errorMessage = e instanceof Error ? e.message : String(e)
    } finally {
      win.destroy()
      rmSync(htmlPath, { force: true })
    }

    this.history.insert({
      id: jobId,
      // 以 __ 开头的是临时合成模板（测试页），不关联真实模板
      templateId: doc.id && !doc.id.startsWith('__') ? doc.id : null,
      templateNameSnapshot: doc.name,
      templateSnapshot: doc,
      paramValues,
      thumbPath,
      printerName: input.printerName,
      copies: input.copies,
      printMode: input.mode,
      status,
      errorMessage,
      createdAt: Date.now()
    })

    return { jobId, status, errorMessage, thumbPath }
  }
}

export function registerPrintHandlers(deps: Services, _win: BrowserWindow): void {
  if (!deps.print) return
  const svc = deps.print
  ipcMain.handle(IPC.printSubmit, (_e, input: SubmitPrintInput) => svc.submit(input))
}
