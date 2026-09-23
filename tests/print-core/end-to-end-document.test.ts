import { describe, it, expect } from 'vitest'
import { createTemplate, createElement, createParamDef } from '../../print-core/template-model'
import { evaluateParams } from '../../print-core/param-evaluator'
import { renderPrintDocument } from '../../print-core/render-print-document'

describe('端到端打印文档', () => {
  it('模板+用户输入 → 完整打印 HTML', () => {
    const tpl = createTemplate('t', '小票', { widthMm: 80, heightMm: 200 })
    const p = createParamDef({ key: 'name', label: '姓名', type: 'text' })
    tpl.params.push(p)
    tpl.content.elements.push(
      createElement('text', { text: '收银小票', bold: true, align: 'center' }, { x: 0, y: 5, w: 80, h: 8 }),
      createElement('param', { paramId: p.id }, { x: 5, y: 20, w: 70, h: 6 })
    )
    const values = evaluateParams(tpl.params, { name: '李四' })
    const html = renderPrintDocument(tpl, values, {})
    expect(html).toContain('size: 80mm 200mm')
    expect(html).toContain('李四')
  })
})
