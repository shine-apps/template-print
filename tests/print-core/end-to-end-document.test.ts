import { describe, it, expect } from 'vitest'
import { createTemplate, createElement, createParamDef } from '../../print-core/template-model'
import { evaluateParams } from '../../print-core/param-evaluator'
import { renderPrintDocument } from '../../print-core/render-print-document'

describe('端到端打印文档', () => {
  it('模板+用户输入 → 完整打印 HTML', () => {
    const tpl = createTemplate('t', '小票', { widthMm: 80, heightMm: 200 })
    tpl.params.push(createParamDef({ name: '姓名', type: 'text' }))
    tpl.content.elements.push(
      createElement('text', { text: '收银小票', bold: true, align: 'center' }, { x: 0, y: 5, w: 80, h: 8 }),
      createElement('text', { text: '客户：{{姓名}}' }, { x: 5, y: 20, w: 70, h: 6 })
    )
    const values = evaluateParams(tpl.params, { 姓名: '李四' })
    const html = renderPrintDocument(tpl, values, {})
    expect(html).toContain('size: 80mm 200mm')
    expect(html).toContain('李四')
    expect(html).not.toContain('{{')
  })

  it('textOnly=true 时图形与图片不进 HTML；文本 token 正常', () => {
    const tpl = createTemplate('t', '小票', { widthMm: 80, heightMm: 200 })
    tpl.params.push(createParamDef({ name: '姓名', type: 'text' }))
    tpl.content.elements.push(
      createElement('shape', { shape: 'rect' }, { x: 1, y: 1, w: 78, h: 100 }),
      createElement('image', { assetId: 'a9' }, { x: 1, y: 120, w: 20, h: 20 }),
      createElement('text', { text: '客户：{{姓名}}' }, { x: 5, y: 20, w: 70, h: 6 })
    )
    const values = evaluateParams(tpl.params, { 姓名: '李四' })
    const html = renderPrintDocument(tpl, values, {}) // 新模板默认 textOnly=true
    expect(html).toContain('李四')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('border:')
  })
})
