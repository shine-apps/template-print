import { useEffect, useState } from 'react'
import { Input, InputNumber, Modal, Select, Space, message } from 'antd'
import { PAPER_PRESETS } from '../../../shared/paper-presets'
import { api } from '../api'

/**
 * 新建模板弹窗（模板列表页 / 模板设计页无 id 入口共用）。
 * 确定 → api.templates.create 后回调新模板 id；取消/关闭 → onClose。
 */
export function NewTemplateModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [presetId, setPresetId] = useState('a4')
  const [customW, setCustomW] = useState(100)
  const [customH, setCustomH] = useState(60)
  const [custom, setCustom] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(''); setPresetId('a4'); setCustom(false); setCustomW(100); setCustomH(60); setSubmitting(false)
    }
  }, [open])

  async function submit(): Promise<void> {
    if (!name.trim()) { message.warning('请填写模板名称'); return }
    const preset = PAPER_PRESETS.find((p) => p.id === presetId)!
    const w = custom ? customW : preset.widthMm
    const h = custom ? customH : preset.heightMm
    if (w <= 0 || h <= 0) { message.warning('纸张尺寸无效'); return }
    setSubmitting(true)
    try {
      const doc = await api.templates.create({ name: name.trim(), widthMm: w, heightMm: h })
      onCreated(doc.id)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="新建模板"
      open={open}
      onOk={submit}
      confirmLoading={submitting}
      onCancel={onClose}
      okText="创建并设计"
      cancelText="取消"
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div><div>模板名称</div><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：荣誉证书" onPressEnter={submit} /></div>
        <div>
          <div>纸张</div>
          <Select style={{ width: 200 }} value={custom ? '__custom__' : presetId}
            onChange={(v) => setCustom(v === '__custom__')}
            options={[...PAPER_PRESETS.map((p) => ({ value: p.id, label: `${p.name}（${p.widthMm}×${p.heightMm}mm）` })),
              { value: '__custom__', label: '自定义尺寸（毫米）' }]} />
        </div>
        {custom && (
          <Space>
            宽 <InputNumber min={5} max={2000} value={customW} onChange={(v) => setCustomW(v ?? 0)} addonAfter="mm" />
            高 <InputNumber min={5} max={2000} value={customH} onChange={(v) => setCustomH(v ?? 0)} addonAfter="mm" />
          </Space>
        )}
      </Space>
    </Modal>
  )
}
