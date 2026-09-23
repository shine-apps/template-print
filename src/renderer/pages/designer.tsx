import { useEffect, useState } from 'react'
import { Button, Space, Spin, Input, Select, message } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useDesignerStore } from '../store/designer-store'
import { sessionDraft } from '../session-draft'
import { DesignerCanvas } from '../designer/canvas'
import { ElementLibrary } from '../designer/element-library'
import { LayersPanel } from '../designer/layers-panel'
import { PropertyPanel } from '../designer/property-panel'
import { TemplateDocumentSchema } from '../../../print-core/template-model'

export function DesignerPage(): JSX.Element {
  const { id } = useParams()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([])
  const doc = useDesignerStore((s) => s.doc)
  const mode = useDesignerStore((s) => s.mode)
  const dirty = useDesignerStore((s) => s.dirty)
  const load = useDesignerStore((s) => s.load)
  const commit = useDesignerStore((s) => s.commit)
  const markSaved = useDesignerStore((s) => s.markSaved)

  useEffect(() => {
    void (async () => {
      if (sessionDraft.doc && sessionDraft.returnToPrint) {
        load(sessionDraft.doc, 'print-session')
        sessionDraft.returnToPrint = false
      } else if (id) {
        const got = await api.templates.get(id)
        if (!got) { message.error('模板不存在'); nav('/templates'); return }
        load(got, 'template')
      } else {
        nav('/templates')
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

  async function save(): Promise<void> {
    try {
      const parsed = TemplateDocumentSchema.parse(doc)
      await api.templates.save(parsed)
      markSaved()
      message.success('已保存')
    } catch (e) {
      message.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }
  function backToPrint(): void {
    // 放入改过的工作副本；paramValues / baselineJson 保持 print 页进入时的内容
    sessionDraft.doc = doc
    sessionDraft.returnToPrint = true
    nav('/print')
  }

  if (loading) return <Spin style={{ display: 'block', marginTop: 80 }} />

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
          <Input variant="borderless" style={{ width: 140 }} value={doc.name}
            onChange={(e) => useDesignerStore.getState().mutate((d) => { d.name = e.target.value })} />
          <span style={{ color: '#888' }}>{doc.paper.widthMm}×{doc.paper.heightMm}mm</span>
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
            : <Button type="primary" onClick={save}>保存模板</Button>}
        </Space>
        <div style={{ flex: 1 }}><DesignerCanvas /></div>
      </div>
      <div style={{ width: 240, background: '#fff', borderLeft: '1px solid #eee', overflow: 'auto' }}>
        <PropertyPanel onCommitted={commit} />
      </div>
    </div>
  )
}
