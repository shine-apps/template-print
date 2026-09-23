import { Button, Space } from 'antd'
import { createElement } from '../../../print-core/template-model'
import { useDesignerStore } from '../store/designer-store'

export function ElementLibrary(): JSX.Element {
  const addElement = useDesignerStore((s) => s.addElement)
  const commit = useDesignerStore((s) => s.commit)

  function add(type: 'text' | 'shape', props?: Record<string, unknown>): void {
    const el = createElement(
      type,
      props ?? (type === 'text' ? { text: '双击编辑文本' } : { shape: 'rect' }),
      { x: 20, y: 20, w: type === 'shape' ? 50 : 60, h: type === 'shape' ? 30 : 8 }
    )
    addElement(el)
    commit()
  }

  return (
    <div>
      <div style={{ opacity: 0.7, fontSize: 12, margin: '4px 0' }}>添加元素</div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button block onClick={() => add('text')}>文本</Button>
        <Button block disabled title="在右侧“参数”区新建后自动插入占位">参数占位</Button>
        <Button block disabled>图片（Task 16）</Button>
        <Button block onClick={() => add('shape', { shape: 'line' })}>直线</Button>
        <Button block onClick={() => add('shape', { shape: 'rect' })}>矩形</Button>
        <Button block onClick={() => add('shape', { shape: 'ellipse' })}>椭圆</Button>
      </Space>
    </div>
  )
}
