import { Button, ColorPicker, InputNumber, Input, Select, Space, Switch, Divider } from 'antd'
import { useDesignerStore } from '../store/designer-store'
import { mmToPt, ptToMm } from '../../../shared/units'
import { ParamManager } from './param-manager'

export function PropertyPanel({ onCommitted }: { onCommitted: () => void }): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const selectedId = useDesignerStore((s) => s.selectedId)
  const updateGeometry = useDesignerStore((s) => s.updateGeometry)
  const updateProps = useDesignerStore((s) => s.updateProps)
  const el = doc.content.elements.find((e) => e.id === selectedId)

  function geo(patch: Partial<{ x: number; y: number; w: number; h: number; locked: boolean; rotation: number }>): void {
    if (el) { updateGeometry(el.id, patch); onCommitted() }
  }
  function props(patch: Record<string, unknown>): void {
    if (el) { updateProps(el.id, patch); onCommitted() }
  }

  return (
    <div style={{ padding: 12 }}>
      <Divider orientation="left" plain style={{ fontSize: 12 }}>参数定义</Divider>
      <ParamManager onCommitted={onCommitted} />

      <Divider orientation="left" plain style={{ fontSize: 12 }}>元素属性</Divider>
      {!el && <div style={{ color: '#999' }}>未选中元素</div>}
      {el && (
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Space wrap>
            X <InputNumber size="small" style={{ width: 80 }} value={Number(el.x.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ x: v ?? 0 })} />
            Y <InputNumber size="small" style={{ width: 80 }} value={Number(el.y.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ y: v ?? 0 })} />
            宽 <InputNumber size="small" style={{ width: 80 }} value={Number(el.w.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ w: Math.max(1, v ?? 1) })} />
            高 <InputNumber size="small" style={{ width: 80 }} value={Number(el.h.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ h: Math.max(1, v ?? 1) })} />
            旋转 <InputNumber size="small" style={{ width: 80 }} min={-180} max={180} step={15}
              value={Number(el.rotation.toFixed(1))} addonAfter="°"
              onChange={(v) => geo({ rotation: v ?? 0 })} />
          </Space>
          <Space>
            锁定 <Switch size="small" checked={el.locked} onChange={(v) => geo({ locked: v })} />
          </Space>

          {el.type === 'text' && (
            <>
              <Input.TextArea rows={2} value={el.props.text} onChange={(e) => props({ text: e.target.value })} />
              {doc.params.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>插入参数到文本末尾</div>
                  <Select size="small" style={{ width: '100%' }} placeholder="选择参数"
                    options={doc.params.map((p) => ({ value: p.name, label: `{{${p.name}}}` }))}
                    onChange={(name) => {
                      if (!name) return
                      const cur = el.type === 'text' ? el.props.text : ''
                      updateProps(el.id, { text: `${cur}${cur && !/\s$/.test(cur) ? ' ' : ''}{{${name}}}` })
                    }} />
                </div>
              )}
              <Space wrap>
                字号
                <InputNumber size="small" style={{ width: 90 }} min={1}
                  value={Number(mmToPt(el.props.fontSizeMm).toFixed(1))} addonAfter="pt"
                  onChange={(v) => props({ fontSizeMm: ptToMm(Math.max(1, v ?? 1)) })} />
                <Button size="small" type={el.props.bold ? 'primary' : 'default'}
                  onClick={() => props({ bold: !el.props.bold })}>B</Button>
                <Button size="small" type={el.props.italic ? 'primary' : 'default'}
                  onClick={() => props({ italic: !el.props.italic })}>I</Button>
                <Select size="small" style={{ width: 80 }} value={el.props.align}
                  onChange={(v) => props({ align: v })}
                  options={[{ value: 'left', label: '左' }, { value: 'center', label: '中' }, { value: 'right', label: '右' }]} />
              </Space>
              颜色 <ColorPicker size="small" value={el.props.color}
                onChange={(c) => props({ color: c.toHexString() })} />
            </>
          )}

          {el.type === 'shape' && (
            <>
              <Select size="small" style={{ width: 120 }} value={el.props.shape}
                onChange={(v) => props({ shape: v })}
                options={[{ value: 'line', label: '直线' }, { value: 'rect', label: '矩形' }, { value: 'ellipse', label: '椭圆' }]} />
              线宽 <InputNumber size="small" style={{ width: 100 }} min={0} step={0.1}
                value={el.props.strokeWidthMm} addonAfter="mm"
                onChange={(v) => props({ strokeWidthMm: Math.max(0, v ?? 0) })} />
              描边 <ColorPicker size="small" value={el.props.strokeColor}
                onChange={(c) => props({ strokeColor: c.toHexString() })} />
              填充 <ColorPicker size="small" allowClear value={el.props.fillColor ?? undefined}
                onChange={(c) => props({ fillColor: c ? c.toHexString() : null })} />
            </>
          )}
        </Space>
      )}
    </div>
  )
}
