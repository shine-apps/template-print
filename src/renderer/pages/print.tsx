import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { clearDraft, sessionDraft } from '../session-draft'
import { renderPrintDocument } from '../../../print-core/render-print-document'
import { evaluateParams, type EvaluatedValues } from '../../../print-core/param-evaluator'
import { mmToPxAt96 } from '../../../shared/units'
import type { ParamDef, TemplateDocument } from '../../../print-core/template-model'
import type { PrinterInfoDto } from '../../../shared/ipc-contract'

export function PrintPage(): JSX.Element {
  const { id } = useParams()
  const nav = useNavigate()

  const [doc, setDoc] = useState<TemplateDocument | null>(null)
  const [fromHistory, setFromHistory] = useState(false)
  const [printers, setPrinters] = useState<PrinterInfoDto[]>([])
  const [printerName, setPrinterName] = useState('')
  const [mode, setMode] = useState<'silent' | 'dialog'>('silent')
  const [copies, setCopies] = useState(1)
  const [values, setValues] = useState<Record<string, string>>({})
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [lastResult, setLastResult] = useState<{ working: TemplateDocument } | null>(null)

  // 原始模板基线（用于 dirty 判定）；从调整版式返回时从草稿恢复
  const baselineRef = useRef<string>('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    void (async () => {
      let loaded: TemplateDocument | null = null
      let restoredValues: Record<string, string> | null = null
      let historyFlag = false
      let baseline: string | null = null

      if (sessionDraft.doc) {
        // 从设计器“完成返回”或历史“重打”进入
        loaded = sessionDraft.doc
        restoredValues = sessionDraft.paramValues
        historyFlag = sessionDraft.fromHistory
        baseline = sessionDraft.baselineJson
        clearDraft()
      } else if (id) {
        loaded = await api.templates.get(id)
      }
      if (!loaded) { message.error('模板不存在'); nav('/templates'); return }

      setDoc(loaded)
      setFromHistory(historyFlag)
      baselineRef.current = baseline ?? JSON.stringify(loaded)

      const [prts, defPrinter] = await Promise.all([api.printers.list(), api.printers.getDefault()])
      setPrinters(prts)
      setPrinterName(loaded.printerName ?? defPrinter ?? prts.find((p) => p.isDefault)?.name ?? prts[0]?.name ?? '')
      setMode(loaded.printMode)

      const init: Record<string, string> = {}
      for (const p of loaded.params) {
        init[p.key] = p.defaultValue === 'today' && p.type === 'date'
          ? dayjs().format('YYYY-MM-DD')
          : p.defaultValue
      }
      setValues(restoredValues ?? init)
      setAssetUrls(loaded.id.startsWith('__') ? {} : await api.assets.listUrls(loaded.id).catch(() => ({})))
    })()
  }, [id, nav])

  // 预览区域尺寸
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 32, h: el.clientHeight - 60 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  const evaluated = useMemo<EvaluatedValues>(
    () => (doc ? evaluateParams(doc.params, values) : {}),
    [doc, values]
  )
  const previewHtml = useMemo(
    () => (doc ? renderPrintDocument(doc, evaluated, assetUrls) : ''),
    [doc, evaluated, assetUrls]
  )

  // 预览 iframe：按 96dpi 得到物理像素，再缩放到可用区域
  const preview = useMemo(() => {
    if (!doc || box.w < 10 || box.h < 10) return null
    const naturalW = mmToPxAt96(doc.paper.widthMm)
    const naturalH = mmToPxAt96(doc.paper.heightMm)
    const scale = Math.min(box.w / naturalW, box.h / naturalH, 1.5)
    return { w: naturalW * scale, h: naturalH * scale, scale }
  }, [doc, box])

  if (!doc) return <Spin style={{ display: 'block', marginTop: 80 }} />
  const errors = evaluated.__errors ?? []

  function setValue(key: string, v: unknown): void {
    setValues((prev) => ({ ...prev, [key]: v === null || v === undefined ? '' : String(v) }))
  }

  function field(p: ParamDef): JSX.Element {
    const v = values[p.key] ?? ''
    if (p.type === 'textarea') {
      return <Input.TextArea rows={2} value={v} onChange={(e) => setValue(p.key, e.target.value)} />
    }
    if (p.type === 'date') {
      return (
        <DatePicker
          style={{ width: '100%' }}
          format={p.dateFormat.replace(/yyyy/g, 'YYYY').replace(/dd/g, 'DD')}
          value={v ? dayjs(v) : null}
          onChange={(d: Dayjs | null) => setValue(p.key, d ? d.format('YYYY-MM-DD') : '')}
        />
      )
    }
    if (p.type === 'number') {
      return (
        <InputNumber
          style={{ width: '100%' }}
          value={v === '' ? null : Number(v)}
          onChange={(n) => setValue(p.key, n === null ? '' : String(n))}
        />
      )
    }
    return <Input value={v} maxLength={p.maxLength ?? undefined} onChange={(e) => setValue(p.key, e.target.value)} />
  }

  function editLayout(): void {
    if (!doc) return
    sessionDraft.doc = doc
    sessionDraft.paramValues = values
    sessionDraft.returnToPrint = true
    sessionDraft.fromHistory = false
    sessionDraft.baselineJson = baselineRef.current
    nav('/designer')
  }

  async function doPrint(): Promise<void> {
    if (!doc) return
    if (errors.length > 0) { message.warning(`请填写必填项：${errors.join(', ')}`); return }
    if (!printerName) { message.warning('请选择打印机'); return }
    const working: TemplateDocument = { ...doc, printMode: mode, printerName }
    let res
    try {
      res = await api.print.submit({ template: working, paramValues: values, printerName, copies, mode })
    } catch (e) {
      message.error(`打印失败：${e instanceof Error ? e.message : String(e)}`)
      return
    }
    if (res.status === 'success') message.success('打印任务已发送')
    else if (res.status === 'cancelled') message.info('已取消打印')
    else message.error(`打印失败：${res.errorMessage ?? '未知错误'}`)

    // 来自真实模板（非历史重打）且版式相对基线有改动 → 弹保存决策
    const changed = JSON.stringify(working) !== baselineRef.current
    if (res.status === 'success' && !working.id.startsWith('__') && !fromHistory && changed) {
      setLastResult({ working })
      setSaveOpen(true)
    } else {
      nav('/history')
    }
  }

  async function saveOverwrite(): Promise<void> {
    if (!lastResult) return
    await api.templates.save(lastResult.working)
    message.success('改动已保存到原模板')
    setSaveOpen(false)
    nav('/history')
  }

  async function saveAsNew(): Promise<void> {
    if (!lastResult) return
    const w = lastResult.working
    const created = await api.templates.create({
      name: `${w.name} 副本`,
      widthMm: w.paper.widthMm,
      heightMm: w.paper.heightMm
    })
    await api.templates.save({ ...w, id: created.id, createdAt: created.createdAt, isBuiltin: false })
    message.success('已另存为新模板（图片需重新上传）')
    setSaveOpen(false)
    nav('/history')
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 280, background: '#fff', borderRight: '1px solid #eee', padding: 16, overflow: 'auto' }}>
        <h3>{doc.name}</h3>
        <Form layout="vertical" size="small">
          {[...doc.params].sort((a, b) => a.order - b.order).map((p) => (
            <Form.Item
              key={p.id}
              label={p.label + (p.required ? ' *' : '')}
              validateStatus={errors.includes(p.key) ? 'error' : ''}
              help={errors.includes(p.key) ? '必填' : undefined}
            >
              {field(p)}
            </Form.Item>
          ))}
        </Form>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            打印机
            <Select
              style={{ width: '100%' }}
              value={printerName}
              onChange={setPrinterName}
              options={printers.map((p) => ({
                value: p.name,
                label: `${p.name}${p.isDefault ? '（系统默认）' : ''}`
              }))}
            />
          </div>
          <Space>
            <span>静默直打</span>
            <Switch checked={mode === 'silent'} onChange={(v) => setMode(v ? 'silent' : 'dialog')} />
            <span>份数</span>
            <InputNumber min={1} max={99} value={copies} onChange={(v) => setCopies(v ?? 1)} style={{ width: 70 }} />
          </Space>
          <Space>
            <Button type="primary" onClick={doPrint}>打印</Button>
            <Button onClick={editLayout}>调整版式</Button>
          </Space>
        </Space>
      </div>

      <div ref={wrapRef} style={{ flex: 1, overflow: 'hidden', background: '#e9ecef', padding: 16, textAlign: 'center' }}>
        <div style={{ color: '#666', marginBottom: 8 }}>实时预览（{doc.paper.widthMm}×{doc.paper.heightMm}mm）</div>
        {preview && (
          <iframe
            title="preview"
            srcDoc={previewHtml}
            scrolling="no"
            style={{
              border: 'none',
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,.2)',
              width: mmToPxAt96(doc.paper.widthMm),
              height: mmToPxAt96(doc.paper.heightMm),
              transform: `scale(${preview.scale})`,
              transformOrigin: 'top center'
            }}
          />
        )}
      </div>

      <Modal
        title="版式有改动，是否保存？"
        open={saveOpen}
        onCancel={() => { setSaveOpen(false); nav('/history') }}
        cancelText="不保存"
        footer={[
          <Button key="no" onClick={() => { setSaveOpen(false); nav('/history') }}>不保存</Button>,
          <Button key="new" onClick={saveAsNew}>另存为新模板</Button>,
          <Button key="yes" type="primary" onClick={saveOverwrite}>保存到原模板</Button>
        ]}
      >
        <p>本次打印前对版式做了修改。可保存到原模板、另存为新模板，或仅本次生效不保存。</p>
      </Modal>
    </div>
  )
}
