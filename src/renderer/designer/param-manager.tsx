import { useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useDesignerStore } from '../store/designer-store'
import { createElement, createParamDef, type ParamDef, type ParamType } from '../../../print-core/template-model'

const TYPE_LABEL: Record<ParamType, string> = {
  text: '单行文本', textarea: '多行文本', date: '日期', number: '数字/金额'
}

export function ParamManager({ onCommitted }: { onCommitted: () => void }): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const addOrUpdateParam = useDesignerStore((s) => s.addOrUpdateParam)
  const removeParam = useDesignerStore((s) => s.removeParam)
  const addElement = useDesignerStore((s) => s.addElement)
  const [editing, setEditing] = useState<ParamDef | null>(null)

  function upsert(values: Partial<ParamDef> & { key: string; label: string; type: ParamType }): void {
    const def = editing
      ? { ...editing, ...values }
      : createParamDef({ key: values.key, label: values.label, type: values.type })
    addOrUpdateParam(def)
    // 新建定义时，若无元素引用它则自动插入一个 param 占位（先建定义再建元素，两次 mutate 均通过校验）
    const referenced = doc.content.elements.some(
      (e) => e.type === 'param' && e.props.paramId === def.id
    )
    if (!referenced) {
      const el = createElement('param', { paramId: def.id }, { x: 20, y: 40 + doc.content.elements.length * 12, w: 70, h: 8 })
      addElement(el)
    }
    onCommitted()
    setEditing(null)
  }

  return (
    <div>
      <Button size="small" type="dashed" icon={<PlusOutlined />} block
        onClick={() => setEditing(createParamDef({ key: `f${doc.params.length + 1}`, label: '新参数', type: 'text' }))}>
        添加参数
      </Button>
      <Table size="small" rowKey="id" pagination={false} style={{ marginTop: 8 }}
        dataSource={[...doc.params].sort((a, b) => a.order - b.order)}
        columns={[
          { title: '名称', dataIndex: 'label' },
          { title: '类型', render: (_, r: ParamDef) => TYPE_LABEL[r.type] },
          {
            title: '操作', width: 90,
            render: (_, r: ParamDef) => (
              <Space size="small">
                <a onClick={() => setEditing(r)}>编辑</a>
                <Popconfirm title="删除参数会同时删除画布上的占位元素" onConfirm={() => { removeParam(r.id); onCommitted() }}
                  okText="删除" cancelText="取消">
                  <a style={{ color: '#cf1322' }}>删</a>
                </Popconfirm>
              </Space>
            )
          }
        ]} />

      {editing && (
        <ParamEditModal def={editing} isNew={!doc.params.some((p) => p.id === editing.id)}
          onCancel={() => setEditing(null)} onOk={upsert} />
      )}
    </div>
  )
}

function ParamEditModal({ def, isNew, onOk, onCancel }: {
  def: ParamDef
  isNew: boolean
  onOk: (v: Partial<ParamDef> & { key: string; label: string; type: ParamType }) => void
  onCancel: () => void
}): JSX.Element {
  const [f, setF] = useState<ParamDef>(def)
  return (
    <Modal open title={isNew ? '添加参数' : '编辑参数'} onCancel={onCancel}
      onOk={() => onOk(f)} okText="确定" cancelText="取消">
      <Form layout="vertical" size="small">
        <Form.Item label="字段标识（英文 key，保存后不可改）" required>
          <Input value={f.key} disabled={!isNew}
            onChange={(e) => setF({ ...f, key: e.target.value })} />
        </Form.Item>
        <Form.Item label="显示名称" required>
          <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Form.Item>
        <Form.Item label="类型">
          <Select value={f.type} onChange={(v) => setF({ ...f, type: v })}
            options={(Object.keys(TYPE_LABEL) as ParamType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        </Form.Item>
        <Form.Item label="必填">
          <Switch checked={f.required} onChange={(v) => setF({ ...f, required: v })} />
        </Form.Item>
        <Form.Item label="默认值（日期类型填 today 表示默认当天）">
          <Input value={f.defaultValue} onChange={(e) => setF({ ...f, defaultValue: e.target.value })} />
        </Form.Item>
        {f.type === 'date' && (
          <Form.Item label="日期格式">
            <Select value={f.dateFormat} onChange={(v) => setF({ ...f, dateFormat: v })}
              options={['yyyy-MM-dd', 'yyyy/MM/dd', 'yyyy年M月d日'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
        )}
        {f.type === 'number' && (
          <Space>
            <span>小数位</span>
            <InputNumber min={0} max={6} value={f.decimals} onChange={(v) => setF({ ...f, decimals: v ?? 0 })} />
            <span>千分位</span>
            <Switch checked={f.thousandsSeparator} onChange={(v) => setF({ ...f, thousandsSeparator: v })} />
          </Space>
        )}
        <Form.Item label="值为空时">
          <Select value={f.printOnEmpty} onChange={(v) => setF({ ...f, printOnEmpty: v })}
            options={[{ value: 'blank', label: '留空白' }, { value: 'line', label: '打印占位横线' }]} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
