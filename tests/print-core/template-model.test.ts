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

  it('v3：text props 支持 underline/direction，旧形态补默认值', () => {
    const d = createTemplate('t', 'x', { widthMm: 40, heightMm: 30 })
    d.content.elements.push(createElement('text', { text: 'a' }, { x: 1, y: 1, w: 10, h: 5 }))
    const parsed = TemplateDocumentSchema.parse(d)
    expect(parsed.version).toBe(3)
    const t = parsed.content.elements.find((e) => e.type === 'text')!
    expect(t.props.underline).toBe(false)
    expect(t.props.direction).toBe('horizontal')
  })

  it('v3：direction 仅接受 horizontal/vertical；underline 为布尔', () => {
    const d = createTemplate('t', 'x', { widthMm: 40, heightMm: 30 })
    d.content.elements.push(createElement('text',
      { text: '竖', direction: 'vertical', underline: true },
      { x: 1, y: 1, w: 10, h: 20 }))
    const ok = TemplateDocumentSchema.safeParse(d)
    expect(ok.success).toBe(true)
    const bad = TemplateDocumentSchema.safeParse({
      ...d, content: { elements: [{ ...d.content.elements[0], props: { ...d.content.elements[0].props, direction: 'sideways' } }] }
    })
    expect(bad.success).toBe(false)
  })

  it('textOnly：createTemplate 默认 true；缺字段 zod 补 true；显式 false 保留', () => {
    expect(createTemplate('t1', 'x', { widthMm: 40, heightMm: 30 }).textOnly).toBe(true)

    const raw = JSON.parse(JSON.stringify(createTemplate('t2', 'x', { widthMm: 40, heightMm: 30 })))
    delete raw.textOnly
    expect(TemplateDocumentSchema.parse(raw).textOnly).toBe(true)

    const off = JSON.parse(JSON.stringify(raw))
    off.textOnly = false
    expect(TemplateDocumentSchema.parse(off).textOnly).toBe(false)
  })
})
