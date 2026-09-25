import { useEffect, useMemo, useState } from 'react'
import {
  Button, Card, Empty, Input, Modal, Select, Space, message, Dropdown
} from 'antd'
import { MoreOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { NewTemplateModal } from '../components/new-template-modal'
import type { TemplateDocument } from '../../../print-core/template-model'

export function TemplatesPage(): JSX.Element {
  const nav = useNavigate()
  const [docs, setDocs] = useState<TemplateDocument[]>([])
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<string | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)
  const [renaming, setRenaming] = useState<TemplateDocument | null>(null)
  const [renameVal, setRenameVal] = useState('')

  async function refresh(): Promise<void> {
    setDocs(await api.templates.list({ category, keyword: keyword || undefined }))
  }
  useEffect(() => { void refresh() }, [category, keyword])

  const categories = useMemo(() => [...new Set(docs.map((d) => d.category).filter(Boolean))], [docs])

  async function onDelete(d: TemplateDocument): Promise<void> {
    await api.templates.delete(d.id)
    message.success('已删除')
    void refresh()
  }
  async function onDuplicate(d: TemplateDocument): Promise<void> {
    const copy = await api.templates.duplicate(d.id)
    message.success('已复制')
    nav(`/designer/${copy.id}`)
  }
  async function saveRename(): Promise<void> {
    if (!renaming || !renameVal.trim()) return
    await api.templates.save({ ...renaming, name: renameVal.trim() })
    setRenaming(null)
    void refresh()
  }

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="全部分类" style={{ width: 140 }} value={category} onChange={setCategory}
          options={categories.map((c) => ({ value: c, label: c }))} />
        <Input.Search placeholder="搜索模板名称" allowClear style={{ width: 220 }} value={keyword}
          onChange={(e) => setKeyword(e.target.value)} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建模板</Button>
        <Button onClick={async () => {
          const r = await api.templates.importTplx()
          if (!r.canceled) { message.success('模板已导入'); void refresh() }
        }}>导入</Button>
      </Space>

      {docs.length === 0
        ? <Empty description="还没有模板，点“新建模板”开始" />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
            {docs.map((d) => {
              const ratio = d.paper.widthMm / d.paper.heightMm
              return (
                <Card key={d.id} size="small"
                  cover={
                    <div style={{ height: 140, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{
                        width: ratio >= 1 ? 90 : 90 * ratio,
                        height: ratio >= 1 ? 90 / ratio : 90,
                        background: '#fff', border: '1px solid #bbb', boxShadow: '0 1px 4px rgba(0,0,0,.15)',
                        position: 'relative'
                      }} />
                    </div>
                  }
                  actions={[
                    <Button type="link"  key="use" onClick={() => nav(`/print/${d.id}`)}>去打印</Button>,
                    <Button type="link"  key="edit" onClick={() => nav(`/designer/${d.id}`)}>编辑</Button>,
                    <Dropdown key="more" menu={{ items: [
                      { key: 'dup', label: '复制', onClick: () => onDuplicate(d) },
                      { key: 'export', label: '导出', onClick: () => api.templates.export(d.id) },
                      { key: 'ren', label: '重命名', onClick: () => { setRenaming(d); setRenameVal(d.name) } },
                      { type: 'divider' },
                      {
                        key: 'del',
                        label: '删除',
                        danger: true,
                        onClick: () => Modal.confirm({
                          title: `删除模板“${d.name}”？`,
                          content: '图片资源将一并删除，已产生的打印历史保留。',
                          okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
                          onOk: () => onDelete(d)
                        })
                      }
                    ] }}><MoreOutlined /></Dropdown>
                  ]}>
                  <Card.Meta title={d.name}
                    description={`${d.category || '未分类'} · ${d.paper.widthMm}×${d.paper.heightMm}mm · ${d.printMode === 'silent' ? '直打' : '弹框'}`} />
                </Card>
              )
            })}
          </div>
        )}

      <NewTemplateModal open={modalOpen} onClose={() => setModalOpen(false)}
        onCreated={(id) => { setModalOpen(false); nav(`/designer/${id}`) }} />

      <Modal title="重命名" open={!!renaming} onOk={saveRename} onCancel={() => setRenaming(null)}>
        <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onPressEnter={saveRename} />
      </Modal>
    </div>
  )
}
