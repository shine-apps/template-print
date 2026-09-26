import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Slider, Space, Spin, Switch, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { clearDraft, paramValuesCache, sessionDraft } from '../session-draft'
import { renderPrintDocument } from '../../../print-core/render-print-document'
import { evaluateParams, type EvaluatedValues } from '../../../print-core/param-evaluator'
import { mmToPxAt96 } from '../../../shared/units'
import { isStandardDriverPaper, paperHintKey } from '../../../shared/paper-presets'
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
  const [textOnly, setTextOnly] = useState(true)
  const [copies, setCopies] = useState(1)
  const [values, setValues] = useState<Record<string, string>>({})
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [lastResult, setLastResult] = useState<{ working: TemplateDocument } | null>(null)
  const [paperHintOpen, setPaperHintOpen] = useState(false)
  const [paperHintCtx, setPaperHintCtx] = useState<{ key: string; w: number; h: number } | null>(null)
  const [confirmedPaperHints, setConfirmedPaperHints] = useState<string[]>([])

  // 原始模板基线（用于 dirty 判定）；从调整版式返回时从草稿恢复
  const baselineRef = useRef<string>('')
  // 已完成首次载入的路由 id。dev StrictMode 会把挂载 effect 重放一次，
  // 第一次执行已 clearDraft()，重放会误判“模板不存在”并跳回模板页，故同 id 仅执行一次
  const handledRef = useRef<{ id: string | undefined } | null>(null)
  const paperHintResolve = useRef<((v: boolean) => void) | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => { void api.settings.get().then((s) => setConfirmedPaperHints(s.paperHintsConfirmed)) }, [])

  useEffect(() => {
    void (async () => {
      if (handledRef.current && handledRef.current.id === id) return
      handledRef.current = { id }
      let loaded: TemplateDocument | null = null
      let restoredValues: Record<string, string> | null = null
      let historyFlag = false
      let baseline: string | null = null

      if (sessionDraft.doc) {
        // 从历史“重打”进入：用历史快照
        loaded = sessionDraft.doc
        restoredValues = sessionDraft.paramValues
        historyFlag = sessionDraft.fromHistory
        baseline = sessionDraft.baselineJson
        clearDraft()
      } else if (id) {
        loaded = await api.templates.get(id)
        // 从设计器“调整版式”返回时，恢复用户已填的参数值（doc 走数据库）
        restoredValues = paramValuesCache.get(id) ?? null
        // 一次性消费：取出后即删除，避免下次进入时残留旧值
        paramValuesCache.delete(id)
      } else {
        // 从左侧菜单直接进入：未指定模板，引导回模板列表选择
        message.info('请先从模板列表选择要打印的模板')
        nav('/templates')
        return
      }
      if (!loaded) { message.error('模板不存在'); nav('/templates'); return }

      setDoc(loaded)
      setFromHistory(historyFlag)
      baselineRef.current = baseline ?? JSON.stringify(loaded)

      const [prts, defPrinter] = await Promise.all([api.printers.list(), api.printers.getDefault()])
      setPrinters(prts)
      setPrinterName(loaded.printerName ?? defPrinter ?? prts.find((p) => p.isDefault)?.name ?? prts[0]?.name ?? '')
      setMode(loaded.printMode)
      setTextOnly(loaded.textOnly)

      const init: Record<string, string> = {}
      for (const p of loaded.params) {
        init[p.name] = p.defaultValue === 'today' && p.type === 'date'
          ? dayjs().format('YYYY-MM-DD')
          : p.defaultValue
      }
      setValues(restoredValues ?? init)
      setAssetUrls(loaded.id.startsWith('__') ? {} : await api.assets.listUrls(loaded.id).catch(() => ({})))
    })()
  }, [id, nav])

  const evaluated = useMemo<EvaluatedValues>(
    () => (doc ? evaluateParams(doc.params, values) : {}),
    [doc, values]
  )
  // 预览始终显示全部元素（图片/图形），便于查看完整版式；
  // 实际打印由 print-service 根据 textOnly 过滤非文本元素
  const previewHtml = useMemo(
    () => (doc ? renderPrintDocument({ ...doc, textOnly: false }, evaluated, assetUrls) : ''),
    [doc, evaluated, assetUrls]
  )

  if (!doc) return <Spin style={{ display: 'block', marginTop: 80 }} />
  const errors = evaluated.__errors ?? []

  // 预览 iframe：按 96dpi 得到物理像素，再按用户调节的缩放比缩放
  const naturalW = mmToPxAt96(doc.paper.widthMm)
  const naturalH = mmToPxAt96(doc.paper.heightMm)

  function setValue(key: string, v: unknown): void {
    setValues((prev) => ({ ...prev, [key]: v === null || v === undefined ? '' : String(v) }))
  }

  function field(p: ParamDef): JSX.Element {
    const v = values[p.name] ?? ''
    if (p.type === 'textarea') {
      return <Input.TextArea rows={2} value={v} onChange={(e) => setValue(p.name, e.target.value)} />
    }
    if (p.type === 'date') {
      return (
        <DatePicker
          style={{ width: '100%' }}
          format={p.dateFormat.replace(/yyyy|dd|d/g, (t) =>
            t === 'yyyy' ? 'YYYY' : t === 'dd' ? 'DD' : 'D')}
          value={v ? dayjs(v) : null}
          onChange={(d: Dayjs | null) => setValue(p.name, d ? d.format('YYYY-MM-DD') : '')}
        />
      )
    }
    if (p.type === 'number') {
      return (
        <InputNumber
          style={{ width: '100%' }}
          value={v === '' ? null : Number(v)}
          onChange={(n) => setValue(p.name, n === null ? '' : String(n))}
        />
      )
    }
    return <Input value={v} maxLength={p.maxLength ?? undefined} onChange={(e) => setValue(p.name, e.target.value)} />
  }

  function editLayout(): void {
    if (!doc) return
    // 缓存当前参数值，设计器返回时恢复（doc 始终从数据库重新加载）
    paramValuesCache.set(doc.id, values)
    nav(`/designer/${doc.id}`)
  }

  async function doPrint(): Promise<void> {
    if (!doc) return
    if (errors.length > 0) { message.warning(`请填写必填项：${errors.join(', ')}`); return }
    if (!printerName) { message.warning('请选择打印机'); return }

    // 打印前检查打印机运行时状态：异常态需用户确认强制打印；ready/unknown 直接继续
    const statusMap = await api.printers.status([printerName])
    const st = statusMap[printerName]
    if (st === 'offline' || st === 'error' || st === 'paper-out') {
      const labelMap: Record<string, string> = { offline: '离线', error: '异常', 'paper-out': '缺纸/耗材' }
      const force = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `打印机状态：${labelMap[st]}`,
          content: '打印机当前状态可能无法完成打印。仍要继续发送任务吗？',
          okText: '强制打印',
          cancelText: '返回',
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        })
      })
      if (!force) return
    }

    // 自定义纸张静默直打引导（弹框模式由用户在系统对话框自选纸张，不提示）
    if (mode === 'silent' && doc && !isStandardDriverPaper(doc.paper.widthMm, doc.paper.heightMm)) {
      const key = paperHintKey(printerName, doc.paper.widthMm, doc.paper.heightMm)
      if (!confirmedPaperHints.includes(key)) {
        const proceed = await new Promise<boolean>((resolve) => {
          setPaperHintCtx({ key, w: doc.paper.widthMm, h: doc.paper.heightMm })
          setPaperHintOpen(true)
          paperHintResolve.current = resolve
        })
        if (!proceed) return
      }
    }
    await submitNow()
  }

  async function submitNow(): Promise<void> {
    const working: TemplateDocument = { ...doc!, printMode: mode, printerName, textOnly }
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

  async function confirmPaperHint(dontAsk: boolean): Promise<void> {
    if (!paperHintCtx) return
    if (dontAsk) {
      const next = [...confirmedPaperHints, paperHintCtx.key]
      setConfirmedPaperHints(next)
      await api.settings.set({ paperHintsConfirmed: next })
    }
    setPaperHintOpen(false)
    paperHintResolve.current?.(true)
    paperHintResolve.current = null
  }

  function cancelPaperHint(): void {
    setPaperHintOpen(false)
    paperHintResolve.current?.(false)
    paperHintResolve.current = null
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
      name: `${w.name}副本`,
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
              key={p.name}
              label={p.name + (p.required ? ' *' : '')}
              validateStatus={errors.includes(p.name) ? 'error' : ''}
              help={errors.includes(p.name) ? '必填' : undefined}
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
            <span>仅打印文本</span>
            <Switch checked={textOnly} onChange={setTextOnly} />
          </Space>
          <div style={{ color: '#d46b08', fontSize: '0.8rem', background: '#fff7e6',  padding: '4px' }}>
            选中后仅输出文字，不打印图片/图形/边框，适合已预印底图的纸张
          </div>
          <Space>
            <Button type="primary" onClick={doPrint}>打印</Button>
            <Button onClick={editLayout}>调整版式</Button>
          </Space>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: '#e9ecef', padding: 16 }}>
        <div style={{ color: '#666', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <span>实时预览（{doc.paper.widthMm}×{doc.paper.heightMm}mm）</span>
          <span style={{ marginLeft: 8, color: '#666', whiteSpace: 'nowrap' }}>缩放</span>
          <button onClick={() => setScale((s) => Math.max(0.2, +(s - 0.01).toFixed(2)))}>－</button>
          <Slider
            style={{ width: 200, margin: 0 }}
            min={0.2} max={3} step={0.01} value={scale} onChange={setScale}
            tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }} />
          <button onClick={() => setScale((s) => Math.min(3, +(s + 0.01).toFixed(2)))}>＋</button>
          <span style={{ color: '#666', minWidth: 42 }}>{Math.round(scale * 100)}%</span>
        </div>
        <div style={{ width: naturalW * scale, height: naturalH * scale, margin: '0 auto' }}>
          <iframe
            title="preview"
            srcDoc={previewHtml}
            scrolling="no"
            style={{
              border: 'none',
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,.2)',
              width: naturalW,
              height: naturalH,
              transform: `scale(${scale})`,
              transformOrigin: 'top left'
            }}
          />
        </div>
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

      <Modal open={paperHintOpen} title="自定义纸张输出提示" okText="仍要打印" cancelText="取消"
        onOk={() => void confirmPaperHint(false)} onCancel={cancelPaperHint}>
        <p>当前模板纸张为 <b>{paperHintCtx?.w}×{paperHintCtx?.h} mm</b>，将静默发送到打印机“{printerName}”。</p>
        <p>若实际输出尺寸或位置不对：</p>
        <ol style={{ paddingLeft: 20 }}>
          <li>在 Windows「设置 → 蓝牙和设备 → 打印机和扫描仪」选中该打印机，进入「打印服务器属性」，按上面的毫米尺寸新建表单；</li>
          <li>在打印机首选项中选用该表单；或改用“弹框打印”，在系统对话框中确认纸张。</li>
        </ol>
        <Checkbox checked={false} onChange={(e) => e.target.checked && void confirmPaperHint(true)}>
          本次仍要打印，且以后对此打印机+尺寸不再提示
        </Checkbox>
      </Modal>
    </div>
  )
}
