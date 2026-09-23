import { describe, it, expect } from 'vitest'
import {
  TemplateDocumentSchema,
  createTemplate,
  createElement,
  createParamDef
} from '../../print-core/template-model'

describe('模板模型校验', () => {
  it('合法模板通过校验', () => {
    const tpl = createTemplate('t1', '测试', { widthMm: 210, heightMm: 297 })
    tpl.params.push(createParamDef({ key: 'name', label: '姓名', type: 'text' }))
    tpl.content.elements.push(
      createElement('text', { text: '标题' }, { x: 10, y: 10, w: 80, h: 10 }),
      createElement('param', { paramId: 'name' }, { x: 10, y: 30, w: 60, h: 8 })
    )
    expect(() => TemplateDocumentSchema.parse(tpl)).not.toThrow()
  })

  it('未知元素类型被拒绝', () => {
    const tpl = createTemplate('t2', '坏模板', { widthMm: 40, heightMm: 30 })
    const bad = JSON.parse(JSON.stringify(tpl))
    bad.content.elements.push({ id: 'x', type: 'video', x: 0, y: 0, w: 1, h: 1 })
    expect(() => TemplateDocumentSchema.parse(bad)).toThrow()
  })

  it('参数 key 重复被拒绝', () => {
    const tpl = createTemplate('t3', '参数重复', { widthMm: 40, heightMm: 30 })
    tpl.params.push(createParamDef({ key: 'date', label: '日期', type: 'date' }))
    tpl.params.push(createParamDef({ key: 'date', label: '日期2', type: 'date' }))
    expect(() => TemplateDocumentSchema.parse(tpl)).toThrow(/重复|unique/i)
  })
})
