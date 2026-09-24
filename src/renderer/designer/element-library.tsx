import { useRef, type ChangeEvent } from 'react'
import { Button, Space } from 'antd'
import { createElement } from '../../../print-core/template-model'
import { useDesignerStore } from '../store/designer-store'

export function ElementLibrary(): JSX.Element {
  const addElement = useDesignerStore((s) => s.addElement)
  const commit = useDesignerStore((s) => s.commit)
  const doc = useDesignerStore((s) => s.doc)
  const fileRef = useRef<HTMLInputElement>(null)

  function add(type: 'text' | 'shape', props?: Record<string, unknown>): void {
    const el = createElement(
      type,
      props ?? (type === 'text' ? { text: '双击编辑文本' } : { shape: 'rect' }),
      { x: 20, y: 20, w: type === 'shape' ? 50 : 60, h: type === 'shape' ? 30 : 8 }
    )
    addElement(el)
    commit()
  }

  async function pickImage(): Promise<void> {
    fileRef.current?.click()
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // 新模板可能尚未保存过：先确保模板在库（create 时已入库，故 id 可用）
    const { assetId } = await window.api.assets.import({
      templateId: doc.id,
      sourcePath: window.api.system.pathForFile(file)
    })
    const el = createElement(
      'image',
      { assetId, fit: 'contain', opacity: 1 },
      { x: 20, y: 60, w: 40, h: 40 }
    )
    addElement(el)
    commit()
  }

  return (
    <div>
      <div style={{ opacity: 0.7, fontSize: 12, margin: '4px 0' }}>添加元素</div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button block onClick={() => add('text')}>文本</Button>
        <div style={{ opacity: 0.5, fontSize: 12, margin: '6px 0' }}>
          参数占位请在右栏“添加参数”，会自动放到画布上
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/bmp"
          style={{ display: 'none' }} onChange={onFile} />
        <Button block onClick={pickImage}>图片</Button>
        <Button block onClick={() => add('shape', { shape: 'line' })}>直线</Button>
        <Button block onClick={() => add('shape', { shape: 'rect' })}>矩形</Button>
        <Button block onClick={() => add('shape', { shape: 'ellipse' })}>椭圆</Button>
      </Space>
    </div>
  )
}
