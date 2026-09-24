import { describe, it, expect, beforeEach } from 'vitest'
import { useDesignerStore } from '../../src/renderer/store/designer-store'
import { createTemplate, createElement, createParamDef } from '../../print-core/template-model'

function reset(): void {
  const tpl = createTemplate('t1', '测试', { widthMm: 210, heightMm: 297 })
  useDesignerStore.getState().load(tpl, 'template')
}

describe('designer store', () => {
  beforeEach(reset)

  it('addElement 后元素进入文档并被选中', () => {
    const el = createElement('text', { text: 'A' }, { x: 1, y: 1, w: 20, h: 8 })
    useDesignerStore.getState().addElement(el)
    const { doc, selectedId } = useDesignerStore.getState()
    expect(doc.content.elements.length).toBe(1)
    expect(selectedId).toBe(el.id)
  })

  it('updateGeometry 提交后可撤销/重做', () => {
    const el = createElement('text', {}, { x: 0, y: 0, w: 10, h: 5 })
    useDesignerStore.getState().addElement(el)
    useDesignerStore.getState().commit()
    useDesignerStore.getState().updateGeometry(el.id, { x: 50 })
    useDesignerStore.getState().commit()
    expect(useDesignerStore.getState().doc.content.elements[0].x).toBe(50)
    useDesignerStore.getState().undo()
    expect(useDesignerStore.getState().doc.content.elements[0].x).toBe(0)
    useDesignerStore.getState().redo()
    expect(useDesignerStore.getState().doc.content.elements[0].x).toBe(50)
  })

  it('removeElement 只删文本元素，不动参数定义（参数不再是画布元素）', () => {
    const p = createParamDef({ name: '姓名', type: 'text' })
    const { doc } = useDesignerStore.getState()
    doc.params.push(p)
    const el = createElement('text', { text: '你好{{姓名}}' }, { x: 0, y: 0, w: 20, h: 6 })
    useDesignerStore.getState().addElement(el)
    useDesignerStore.getState().commit()
    useDesignerStore.getState().removeElement(el.id)
    useDesignerStore.getState().commit()
    expect(useDesignerStore.getState().doc.content.elements.length).toBe(0)
    expect(useDesignerStore.getState().doc.params).toHaveLength(1)
  })

  it('addOrUpdateParam 新增参数定义', () => {
    const p = createParamDef({ name: '日期', type: 'date' })
    useDesignerStore.getState().addOrUpdateParam(p)
    expect(useDesignerStore.getState().doc.params[0].name).toBe('日期')
  })

  it('renameParam 改名并同步文本 token（容忍括号内空白，替换后统一规范）', () => {
    useDesignerStore.getState().addOrUpdateParam(createParamDef({ name: '姓名', type: 'text' }))
    const el = createElement(
      'text',
      { text: '你好{{ 姓名 }}，敬礼：{{姓名}}' },
      { x: 0, y: 0, w: 60, h: 8 }
    )
    useDesignerStore.getState().addElement(el)
    useDesignerStore.getState().renameParam('姓名', createParamDef({ name: '收件人', type: 'text' }))
    const doc = useDesignerStore.getState().doc
    expect(doc.params.map((p) => p.name)).toEqual(['收件人'])
    expect(doc.content.elements[0].type === 'text' && doc.content.elements[0].props.text).toBe(
      '你好{{收件人}}，敬礼：{{收件人}}'
    )
  })

  it('removeParam 仅删除定义，不动文本元素（token 打印时留空）', () => {
    useDesignerStore.getState().addOrUpdateParam(createParamDef({ name: '姓名', type: 'text' }))
    const el = createElement('text', { text: '你好{{姓名}}' }, { x: 0, y: 0, w: 60, h: 8 })
    useDesignerStore.getState().addElement(el)
    useDesignerStore.getState().removeParam('姓名')
    const doc = useDesignerStore.getState().doc
    expect(doc.params).toHaveLength(0)
    expect(doc.content.elements).toHaveLength(1)
    expect(doc.content.elements[0].type === 'text' && doc.content.elements[0].props.text).toBe('你好{{姓名}}')
  })
})
