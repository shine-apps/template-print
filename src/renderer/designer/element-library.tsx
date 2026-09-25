import { useRef, type ChangeEvent } from 'react'
import { Button, Dropdown, Space, message } from 'antd'
import { createElement } from '../../../print-core/template-model'
import { useDesignerStore } from '../store/designer-store'

export function ElementLibrary(): JSX.Element {
  const addElement = useDesignerStore((s) => s.addElement)
  const commit = useDesignerStore((s) => s.commit)
  const doc = useDesignerStore((s) => s.doc)
  const mode = useDesignerStore((s) => s.mode)
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

  function addText(direction: 'horizontal' | 'vertical'): void {
    const el = createElement(
      'text',
      { text: '右侧文本框编辑文本', fontFamily: '', direction },
      { x: 20, y: 20, w: direction === 'vertical' ? 14 : 60, h: direction === 'vertical' ? 60 : 8 }
    )
    addElement(el)
    commit()
  }

  async function pickImage(): Promise<void> {
    // 新模板首次保存前只有内存临时 id（tpl_new_*），此时上传会把资产挂到被丢弃的 id 下，
    // 保存换真实 id 后图片失效；要求先保存模板再添加图片。
    if (mode === 'new-template') {
      message.warning('请先点击「保存模板」完成新建，再添加图片')
      return
    }
    fileRef.current?.click()
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // 模板此前已保存，id 为库中真实 id，资产可正常挂载
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
        <Dropdown
          menu={{
            items: [
              { key: 'h', label: '横排文本框' },
              { key: 'v', label: '竖排文本框' }
            ],
            onClick: ({ key }) => addText(key === 'v' ? 'vertical' : 'horizontal')
          }}
          trigger={['click']}>
          <Button block>文本 ▾</Button>
        </Dropdown>
        <div style={{ opacity: 0.55, fontSize: 12, margin: '6px 0' }}>
          文本中用 {'{{参数名称}}'} 引用参数
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
