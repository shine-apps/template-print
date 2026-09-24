import { useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useDesignerStore } from '../store/designer-store'
import { createParamDef, type ParamDef, type ParamType } from '../../../print-core/template-model'

const TYPE_LABEL: Record<ParamType, string> = {
  text: '单行文本', textarea: '多行文本', date: '日期', number: '数字/金额'
}

function uniqueName(docParams: ParamDef[], base: string, exclude?: string): string {
  const used = new Set(docParams.filter((p) => p.name !== exclude).map((p) => p.name))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}${n}`)) n += 1
  return `${base}${n}`
}

export function ParamManager({ onCommitted }: { onCommitted: () => void }): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const addOrUpdateParam = useDesignerStore((s) => s.addOrUpdateParam)
  const renameParam = useDesignerStore((s) => s.renameParam)
  const removeParam = useDesignerStore((s) => s.removeParam)
  const [editing, setEditing] = useState<{ def: ParamDef; isNew: boolean } | null>(null)

  function openNew(): void {
    const name = uniqueName(doc.params, `参数${doc.params.length + 1}`)
    setEditing({ def: createParamDef({ name, type: 'text' }), isNew: true })
  }

  function commit(def: ParamDef, oldName: string, isNew: boolean): void {
    const name = def.name.trim()
    if (!name || /[{}]/.test(name) || /[\r\n]/.test(name)) return
    const finalDef = createParamDef({ ...def, name })
    if (doc.params.some((p) => p.name === name && p.name !== oldName)) return
    if (isNew) addOrUpdateParam(finalDef)
    else renameParam(oldName, finalDef)
    onCommitted()
    setEditing(null)
  }

  return (
    <div>
      <Button size="small" type="dashed" icon={<PlusOutlined />} block onClick={openNew}>添加参数</Button>
      <div style={{ opacity: 0.55, fontSize: 12, margin: '6px 0' }}>
        参数不直接上画布；在文本中用 {'{{参数名称}}'} 引用。
      </div>
      <Table size="small" rowKey="name" pagination={false} style={{ marginTop: 8 }}
        dataSource={[...doc.params].sort((a, b) => a.order - b.order)}
        columns={[
          { title: '参数名称', dataIndex: 'name' },
          { title: '类型', render: (_, r: ParamDef) => TYPE_LABEL[r.type] },
          {
            title: '操作', width: 90,
            render: (_, r: ParamDef) => (
              <Space size="small">
                <a onClick={() => setEditing({ def: r, isNew: false })}>编辑</a>
                <Popconfirm title={`删除参数“${r.name}”？文本中未替换的 {{${r.name}}} 打印时将留空`}
                  onConfirm={() => { removeParam(r.name); onCommitted() }}
                  okText="删除" cancelText="取消">
                  <a style={{ color: '#cf1322' }}>删</a>
                </Popconfirm>
              </Space>
            )
          }
        ]} />
      {editing && (
        <ParamEditModal def={editing.def} isNew={editing.isNew}
          otherNames={doc.params.filter((p) => p.name !== editing.def.name).map((p) => p.name)}
          onCancel={() => setEditing(null)}
          onOk={(def) => commit(def, editing.def.name, editing.isNew)} />
      )}
    </div>
  )
}

function ParamEditModal({ def, isNew, otherNames, onOk, onCancel }: {
  def: ParamDef
  isNew: boolean
  otherNames: string[]
  onOk: (v: ParamDef) => void
  onCancel: () => void
}): JSX.Element {
  const [f, setF] = useState<ParamDef>(def)
  const nameDup = otherNames.includes(f.name.trim())
  const nameBad = !f.name.trim() || /[{}]/.test(f.name) || /[\r\n]/.test(f.name)
  return (
    <Modal open title={isNew ? '添加参数' : '编辑参数'} onCancel={onCancel}
      okButtonProps={{ disabled: nameDup || nameBad }}
      onOk={() => onOk(f)} okText="确定" cancelText="取消">
      <Form layout="vertical" size="small">
        <Form.Item label="参数名称（模板内唯一，可中文；文本中以 {{名称}} 引用）" required
          validateStatus={nameDup || nameBad ? 'error' : ''}
          help={nameDup ? '该名称已存在' : nameBad ? '名称不能为空且不能包含 { }' : undefined}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
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
          <Form.Item label="数字格式">
            <Space>
              <span>小数位</span>
              <InputNumber min={0} max={6} value={f.decimals} onChange={(v) => setF({ ...f, decimals: v ?? 0 })} />
              <span>千分位</span>
              <Switch checked={f.thousandsSeparator} onChange={(v) => setF({ ...f, thousandsSeparator: v })} />
            </Space>
          </Form.Item>
        )}
        <Form.Item label="值为空时">
          <Select value={f.printOnEmpty} onChange={(v) => setF({ ...f, printOnEmpty: v })}
            options={[{ value: 'blank', label: '留空白' }, { value: 'line', label: '打印占位横线' }]} />
        </Form.Item>
        {!isNew && <div style={{ color: '#999', fontSize: 12 }}>改名会同步替换文本中已引用的 {'{名称}'}。</div>}
      </Form>
    </Modal>
  )
}
