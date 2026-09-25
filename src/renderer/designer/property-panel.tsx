import { Button, ColorPicker, InputNumber, Input, Select, Segmented, Space, Switch, Divider } from 'antd'
import { useEffect, useState, type CSSProperties } from 'react'
import { useDesignerStore } from '../store/designer-store'
import { mmToPt, ptToMm } from '../../../shared/units'
import { ParamManager } from './param-manager'
import { getFonts } from '../fonts'
import type { FontListDto } from '../../../shared/ipc-contract'

export function PropertyPanel({ onCommitted }: { onCommitted: () => void }): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const selectedId = useDesignerStore((s) => s.selectedId)
  const updateGeometry = useDesignerStore((s) => s.updateGeometry)
  const updateProps = useDesignerStore((s) => s.updateProps)
  const el = doc.content.elements.find((e) => e.id === selectedId)

  const [fonts, setFonts] = useState<FontListDto | null>(null)
  useEffect(() => { void getFonts().then(setFonts) }, [])

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
            <div style={{ display: 'inline-flex', alignItems: 'center' }}><span>X: </span> <InputNumber size="small" style={{ width: 100 }} value={Number(el.x.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ x: v ?? 0 })} /></div>
            <div style={{ display: 'inline-flex', alignItems: 'center' }}><span>Y: </span> <InputNumber size="small" style={{ width: 100 }} value={Number(el.y.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ y: v ?? 0 })} /></div>
            <div style={{ display: 'inline-flex', alignItems: 'center' }}><span>宽: </span> <InputNumber size="small" style={{ width: 100 }} value={Number(el.w.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ w: Math.max(1, v ?? 1) })} /></div>
            <div style={{ display: 'inline-flex', alignItems: 'center' }}><span>高: </span> <InputNumber size="small" style={{ width: 100 }} value={Number(el.h.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ h: Math.max(1, v ?? 1) })} /></div>
            <div style={{ display: 'inline-flex', alignItems: 'center' }}><span>旋转: </span> <InputNumber size="small" style={{ width: 100 }} min={-180} max={180} step={15}
              value={Number(el.rotation.toFixed(1))} addonAfter="°"
              onChange={(v) => geo({ rotation: v ?? 0 })} /></div>
          </Space>
          <Space>
            锁定 <Switch size="small" checked={el.locked} onChange={(v) => geo({ locked: v })} />
          </Space>

          {el.type === 'text' && (() => {
            const tp = el.props
            const fontOptions = [
              { label: '系统默认', options: [{ value: '', label: '系统默认（推荐）' }] },
              { label: '常用字体', options: (fonts?.common ?? []).map((f) => ({ value: f, label: f })) },
              {
                label: '全部字体',
                options: (fonts?.all ?? []).filter((f) => !(fonts?.common ?? []).includes(f)).map((f) => ({ value: f, label: f }))
              }
            ]
            const fontStyleOf = (family: string): CSSProperties =>
              family === '' ? {} : { fontFamily: `"${family}"` }
            return (
              <>
                <Segmented size="small" block value={tp.direction}
                  options={[{ value: 'horizontal', label: '横排' }, { value: 'vertical', label: '竖排' }]}
                  onChange={(v) => props({ direction: v as 'horizontal' | 'vertical' })} />
                <Input.TextArea rows={2} value={tp.text} onChange={(e) => props({ text: e.target.value })} />
                {doc.params.length > 0 && (
                  <Select size="small" style={{ width: '100%' }} placeholder="插入参数到文本末尾"
                    options={doc.params.map((p) => ({ value: p.name, label: `{{${p.name}}}` }))}
                    onChange={(name) => {
                      if (!name) return
                      props({ text: `${tp.text}${tp.text && !/\s$/.test(tp.text) ? ' ' : ''}{{${name}}}` })
                    }} />
                )}
                <Select size="small" showSearch style={{ width: '100%' }} value={tp.fontFamily}
                  optionFilterProp="label" options={fontOptions}
                  optionRender={(o) => (
                    <span style={fontStyleOf(o.value === undefined ? '' : String(o.value))}>{o.label}</span>
                  )}
                  onChange={(v) => props({ fontFamily: v })} />
                <Space wrap>
                  字号
                  <InputNumber size="small" style={{ width: 90 }} min={1}
                    value={Number(mmToPt(tp.fontSizeMm).toFixed(1))} addonAfter="pt"
                    onChange={(v) => props({ fontSizeMm: ptToMm(Math.max(1, v ?? 1)) })} />
                  <Button size="small" type={tp.bold ? 'primary' : 'default'}
                    onClick={() => props({ bold: !tp.bold })}><b>B</b></Button>
                  <Button size="small" type={tp.italic ? 'primary' : 'default'}
                    onClick={() => props({ italic: !tp.italic })}><i>I</i></Button>
                  <Button size="small" type={tp.underline ? 'primary' : 'default'}
                    onClick={() => props({ underline: !tp.underline })} style={{ textDecoration: 'underline' }}>U</Button>
                  <Select size="small" style={{ width: 96 }} value={tp.align}
                    onChange={(v) => props({ align: v })}
                    options={tp.direction === 'vertical'
                      ? [{ value: 'left', label: '右对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '左对齐' }]
                      : [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]} />
                </Space>
                <Space wrap>
                  行高
                  <InputNumber size="small" style={{ width: 90 }} min={0.5} step={0.1}
                    value={tp.lineHeight} onChange={(v) => props({ lineHeight: v ?? 1.2 })} />
                  颜色 <ColorPicker size="small" value={tp.color}
                    onChange={(c) => props({ color: c.toHexString() })} />
                </Space>
              </>
            )
          })()}

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
