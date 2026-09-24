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
    tpl.params.push(createParamDef({ name: '姓名', type: 'text' }))
    tpl.content.elements.push(
      createElement('text', { text: '姓名：{{姓名}}' }, { x: 10, y: 10, w: 80, h: 10 })
    )
    expect(() => TemplateDocumentSchema.parse(tpl)).not.toThrow()
  })

  it('未知元素类型被拒绝', () => {
    const tpl = createTemplate('t2', '坏模板', { widthMm: 40, heightMm: 30 })
    const bad = JSON.parse(JSON.stringify(tpl))
    bad.content.elements.push({ id: 'x', type: 'video', x: 0, y: 0, w: 1, h: 1 })
    expect(() => TemplateDocumentSchema.parse(bad)).toThrow()
  })

  it('参数名称模板内唯一；含大括号非法', () => {
    const d = createTemplate('t', 'x', { widthMm: 40, heightMm: 30 })
    d.params.push(createParamDef({ name: '姓名', type: 'text' }))
    d.params.push(createParamDef({ name: '姓名', type: 'text', order: 1 }))
    expect(TemplateDocumentSchema.safeParse(d).success).toBe(false)
    expect(() => createParamDef({ name: '坏{名称', type: 'text' })).toThrow()
  })
})
