import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Space, Spin, Input, InputNumber, Select, Tooltip, Popover, message } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useDesignerStore } from '../store/designer-store'
import { sessionDraft } from '../session-draft'
import { PAPER_PRESETS } from '../../../shared/paper-presets'
import { DesignerCanvas } from '../designer/canvas'
import { ElementLibrary } from '../designer/element-library'
import { LayersPanel } from '../designer/layers-panel'
import { PropertyPanel } from '../designer/property-panel'
import { NewTemplateModal } from '../components/new-template-modal'
import { TemplateDocumentSchema } from '../../../print-core/template-model'

export function DesignerPage(): JSX.Element {
  const { id } = useParams()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  // 无 sessionDraft 且无模板 id（直接点「模板设计」菜单进入）时立即弹新建模板窗
  const [createOpen, setCreateOpen] = useState(false)
  // 「保存并去打印」进行中
  const [savingToPrint, setSavingToPrint] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([])
  const doc = useDesignerStore((s) => s.doc)
  const mode = useDesignerStore((s) => s.mode)
  const dirty = useDesignerStore((s) => s.dirty)
  const load = useDesignerStore((s) => s.load)
  const commit = useDesignerStore((s) => s.commit)
  const markSaved = useDesignerStore((s) => s.markSaved)

  // 已完成首次载入的路由 id。dev StrictMode 会把挂载 effect 重放一次（ref 保留），
  // 同 id 的重放直接跳过，避免 returnToPrint 在第一次执行时被复位后，
  // 第二次重放落入“新建模板”分支；真正的 id 变化（新建后 replace 进入）不受影响
  const handledRef = useRef<{ id: string | undefined } | null>(null)

  useEffect(() => {
    void (async () => {
      if (handledRef.current && handledRef.current.id === id) return
      handledRef.current = { id }
      // console.debug('DesignerPage', id, sessionDraft)
      if (sessionDraft.doc && sessionDraft.returnToPrint) {
        load(sessionDraft.doc, 'print-session')
        sessionDraft.returnToPrint = false
      } else if (id) {
        const got = await api.templates.get(id)
        if (!got) { message.error('模板不存在'); nav('/templates'); return }
        load(got, 'template')
      } else {
        // 既无打印会话草稿也无模板 id：弹出新建模板窗（不跳走，由弹窗决定去向）
        setCreateOpen(true)
        return
      }
      setLoading(false)
    })()
    // 不做卸载清理：工作副本由 print 页消费或由 clearDraft() 显式清理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    void api.templates.list({}).then((ts) => {
      setCategoryOptions(
        [...new Set(ts.map((t) => t.category).filter(Boolean))].map((c) => ({ value: c, label: c }))
      )
    })
  }, [])

  // 实时校验：未修改或校验未通过时「保存并去打印」禁用（safeParse 同步，doc 变更才重渲染）
  const saveIssue = useMemo(() => {
    const r = TemplateDocumentSchema.safeParse(doc)
    return r.success ? null : (r.error.issues[0]?.message ?? '模板校验未通过')
  }, [doc])
  const canSaveAndPrint = dirty && !saveIssue

  /** 保存当前模板；成功返回 true，失败弹错误提示并返回 false（调用方不得继续跳转） */
  async function save(): Promise<boolean> {
    const parsed = TemplateDocumentSchema.safeParse(doc)
    if (!parsed.success) {
      message.error('保存失败：' + (parsed.error.issues[0]?.message ?? '模板校验未通过'))
      return false
    }
    try {
      await api.templates.save(parsed.data)
      markSaved()
      message.success('已保存')
      return true
    } catch (e) {
      message.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
      return false
    }
  }

  async function saveAndPrint(): Promise<void> {
    setSavingToPrint(true)
    try {
      const ok = await save()
      // 保存失败已提示，且不跳转打印页
      if (ok) nav(`/print/${doc.id}`)
    } finally {
      setSavingToPrint(false)
    }
  }
  /** 无未保存修改时直接去打印（不执行保存） */
  function goToPrint(): void {
    nav(`/print/${doc.id}`)
  }

  /**
   * 修改纸张尺寸（mm）。元素不随纸张缩放：超界元素保留原位，打印时按各自元素框裁剪。
   * 经 mutate 落库：自动标脏、进撤销栈、走 zod 校验（宽高须为正数）。
   */
  function changePaper(widthMm: number | null, heightMm: number | null): void {
    const w = widthMm ?? 0
    const h = heightMm ?? 0
    if (w <= 0 || h <= 0) return
    useDesignerStore.getState().mutate((d) => {
      d.paper.widthMm = w
      d.paper.heightMm = h
    })
  }
  /** 当前尺寸命中预设则返回其 id，否则 '__custom__' */
  const paperPresetId = PAPER_PRESETS.find(
    (p) => p.widthMm === doc.paper.widthMm && p.heightMm === doc.paper.heightMm
  )?.id ?? '__custom__'

  const paperEditor = (
    <Space direction="vertical" size={8} style={{ width: 230 }}>
      <Select
        size="small"
        style={{ width: '100%' }}
        value={paperPresetId}
        onChange={(v) => {
          if (v === '__custom__') return
          const p = PAPER_PRESETS.find((x) => x.id === v)
          if (p) changePaper(p.widthMm, p.heightMm)
        }}
        options={[
          ...PAPER_PRESETS.map((p) => ({ value: p.id, label: `${p.name}（${p.widthMm}×${p.heightMm}mm）` })),
          { value: '__custom__', label: '自定义尺寸（毫米）' }
        ]}
      />
      <Space>
        宽
        <InputNumber size="small" min={5} max={2000} step={1} addonAfter="mm"
          style={{ width: 100 }} value={doc.paper.widthMm}
          onChange={(v) => changePaper(v, doc.paper.heightMm)} />
      </Space>
      <Space>
        高
        <InputNumber size="small" min={5} max={2000} step={1} addonAfter="mm"
          style={{ width: 100 }} value={doc.paper.heightMm}
          onChange={(v) => changePaper(doc.paper.widthMm, v)} />
      </Space>
      <span style={{ color: '#999', fontSize: 12, lineHeight: 1.4 }}>
        元素不随纸张缩放；超出新边界的内容将在打印时被裁剪。
      </span>
    </Space>
  )
  function backToPrint(): void {
    // 放入改过的工作副本；paramValues / baselineJson 保持 print 页进入时的内容
    sessionDraft.doc = doc
    sessionDraft.returnToPrint = true
    nav('/print')
  }

  const createModal = (
    <NewTemplateModal
      open={createOpen}
      onClose={() => nav('/templates')}
      onCreated={(newId) => {
        // 创建成功：关弹窗并进入该模板的设计器（replace，避免后退又回到无 id 状态再次弹窗）
        setCreateOpen(false)
        nav(`/designer/${newId}`, { replace: true })
      }}
    />
  )

  if (loading) return (
    <>
      {createModal}
      <Spin style={{ display: 'block', marginTop: 80 }} />
    </>
  )

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 200, background: '#1f2937', color: '#fff', padding: 8, overflow: 'auto' }}>
        <ElementLibrary />
        <LayersPanel />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Space style={{ background: '#fff', padding: 8, borderBottom: '1px solid #eee' }}>
          <Button onClick={() => { useDesignerStore.getState().undo() }}>撤销</Button>
          <Button onClick={() => { useDesignerStore.getState().redo() }}>重做</Button>
          <Input variant="outlined" style={{ width: 140 }} value={doc.name}
            onChange={(e) => useDesignerStore.getState().mutate((d) => { d.name = e.target.value })} />
          <Popover trigger="click" placement="bottomLeft" title="纸张尺寸" content={paperEditor}>
            <Button size="small" title="点击修改纸张尺寸">
              {doc.paper.widthMm}×{doc.paper.heightMm}mm
            </Button>
          </Popover>
          <Select style={{ width: 130 }} placeholder="分类" allowClear showSearch
            value={doc.category || undefined}
            onChange={(v) => useDesignerStore.getState().mutate((d) => { d.category = v ?? '' })}
            options={categoryOptions}
            dropdownRender={(menu) => (<>
              {menu}
              <div style={{ padding: 4, borderTop: '1px solid #eee' }}>
                <Input size="small" placeholder="输入新分类后回车"
                  onPressEnter={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim()
                    if (v && !categoryOptions.some((c) => c.value === v)) {
                      setCategoryOptions((o) => [...o, { value: v, label: v }])
                    }
                    useDesignerStore.getState().mutate((d) => { d.category = v })
                  }} />
              </div>
            </>)} />
          {dirty && <span style={{ color: '#fa8c16' }}>未保存</span>}
          {mode === 'print-session'
            ? <Button type="primary" onClick={backToPrint}>完成，返回打印</Button>
            : dirty
              ? (
                <>
                  <Button type="primary" onClick={save}>保存模板</Button>
                  <Tooltip title={canSaveAndPrint ? '' : (saveIssue ?? '模板校验未通过')}>
                    <span style={{ display: 'inline-block' }}>
                      <Button onClick={saveAndPrint} loading={savingToPrint} disabled={!canSaveAndPrint}>
                        保存并去打印
                      </Button>
                    </span>
                  </Tooltip>
                </>
              )
              : (
                <>
                  <Button type="primary" onClick={save}>保存模板</Button>
                  <Button onClick={goToPrint}>去打印</Button>
                </>
              )}
        </Space>
        <div style={{ flex: 1 }}><DesignerCanvas /></div>
      </div>
      <div style={{ width: 300, background: '#fff', borderLeft: '1px solid #eee', overflow: 'auto' }}>
        <PropertyPanel onCommitted={commit} />
      </div>
      {createModal}
    </div>
  )
}
