import { describe, it, expect } from 'vitest'
import { createTemplate, createElement, createParamDef } from '../../print-core/template-model'
import { renderPrintDocument } from '../../print-core/render-print-document'

function buildDoc() {
  const tpl = createTemplate('t1', '证书', { widthMm: 210, heightMm: 297 })
  tpl.params.push(createParamDef({ key: 'name', label: '姓名', type: 'text' }))
  tpl.content.elements.push(
    createElement('text', { text: '荣誉证书', fontSizeMm: 10, bold: true, align: 'center' }, { x: 30, y: 20, w: 150, h: 14 }),
    createElement('param', { paramId: tpl.params[0].id }, { x: 40, y: 80, w: 80, h: 8 }),
    createElement('shape', { shape: 'rect', strokeColor: '#000', strokeWidthMm: 0.5, fillColor: null }, { x: 10, y: 10, w: 190, h: 277 }),
    createElement('image', { assetId: 'a1', fit: 'contain', opacity: 1 }, { x: 150, y: 230, w: 30, h: 30 })
  )
  return tpl
}

describe('renderPrintDocument', () => {
  it('输出含毫米 @page 与绝对定位元素', () => {
    const html = renderPrintDocument(buildDoc(), { name: '张三' }, { a1: 'file:///img/a1.png' })
    expect(html).toContain('@page')
    expect(html).toContain('size: 210mm 297mm')
    expect(html).toContain('position:absolute')
    expect(html).toContain('荣誉证书')
    expect(html).toContain('张三')
    expect(html).toContain('file:///img/a1.png')
    expect(html).toContain('print-color-adjust: exact')
  })

  it('空值横线元素渲染为下边框空 div', () => {
    const tpl = buildDoc()
    const html = renderPrintDocument(tpl, { name: '{{__EMPTY_LINE__}}' }, { a1: '' })
    expect(html).toContain('border-bottom:')
  })

  it('所有 HTML 特殊字符被转义', () => {
    const tpl = createTemplate('t2', 'x', { widthMm: 40, heightMm: 30 })
    tpl.content.elements.push(createElement('text', { text: '<b>&</b>' }, { x: 0, y: 0, w: 30, h: 5 }))
    const html = renderPrintDocument(tpl, {}, {})
    expect(html).toContain('&lt;b&gt;&amp;&lt;/b&gt;')
    expect(html).not.toContain('<b>&</b>')
  })
})
