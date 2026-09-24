import { describe, it, expect } from 'vitest'
import { createTemplate, createElement, createParamDef } from '../../print-core/template-model'
import { renderPrintDocument } from '../../print-core/render-print-document'
import { EMPTY_LINE_TOKEN } from '../../print-core/param-evaluator'
import { SYSTEM_FONT_STACK } from '../../print-core/text-layout'

function baseDoc(elements: ReturnType<typeof createElement>[]) {
  const tpl = createTemplate('t', 'x', { widthMm: 40, heightMm: 30 })
  tpl.content.elements.push(...elements)
  return tpl
}

function buildDoc() {
  const tpl = createTemplate('t1', '证书', { widthMm: 210, heightMm: 297 })
  tpl.params.push(createParamDef({ name: '姓名', type: 'text' }))
  tpl.content.elements.push(
    createElement('text', { text: '荣誉证书', fontSizeMm: 10, bold: true, align: 'center' }, { x: 30, y: 20, w: 150, h: 14 }),
    createElement('text', { text: '姓名：{{姓名}}', fontSizeMm: 6 }, { x: 40, y: 80, w: 80, h: 8 }),
    createElement('shape', { shape: 'rect', strokeColor: '#000', strokeWidthMm: 0.5, fillColor: null }, { x: 10, y: 10, w: 190, h: 277 }),
    createElement('image', { assetId: 'a1', fit: 'contain', opacity: 1 }, { x: 150, y: 230, w: 30, h: 30 })
  )
  return tpl
}

describe('renderPrintDocument', () => {
  it('输出含毫米 @page 与绝对定位元素', () => {
    const html = renderPrintDocument(buildDoc(), { 姓名: '张三' }, { a1: 'file:///img/a1.png' })
    expect(html).toContain('@page')
    expect(html).toContain('size: 210mm 297mm')
    expect(html).toContain('position:absolute')
    expect(html).toContain('荣誉证书')
    expect(html).toContain('姓名：张三')
    expect(html).not.toContain('{{姓名}}')
    expect(html).toContain('file:///img/a1.png')
    expect(html).toContain('print-color-adjust: exact')
  })

  it('文本中的 {{名称}} 被替换并做 HTML 转义', () => {
    const doc = buildDoc()
    doc.content.elements = [
      createElement('text', { text: '姓名：{{姓名}}' }, { x: 1, y: 1, w: 60, h: 8 })
    ]
    const html = renderPrintDocument(doc, { 姓名: '<b>张三</b>' }, {})
    expect(html).toContain('姓名：&lt;b&gt;张三&lt;/b&gt;')
    expect(html).not.toContain('<b>张三</b>')
  })

  it('空值横线 token 渲染为逻辑下划线片段（text-decoration）', () => {
    const doc = buildDoc()
    doc.content.elements = [
      createElement('text', { text: '日期：{{日期}}' }, { x: 1, y: 1, w: 60, h: 8 })
    ]
    const html = renderPrintDocument(doc, { 日期: EMPTY_LINE_TOKEN }, {})
    expect(html).toContain('text-decoration:underline')
    expect(html).not.toContain('border-bottom')
  })

  it('文本引用未定义参数时替换为空串', () => {
    const tpl = createTemplate('t3', 'x', { widthMm: 40, heightMm: 30 })
    tpl.content.elements.push(createElement('text', { text: '值[{{未知}}]' }, { x: 0, y: 0, w: 30, h: 5 }))
    const html = renderPrintDocument(tpl, {}, {})
    expect(html).toContain('值[]')
  })

  it('所有 HTML 特殊字符被转义', () => {
    const tpl = createTemplate('t2', 'x', { widthMm: 40, heightMm: 30 })
    tpl.content.elements.push(createElement('text', { text: '<b>&</b>' }, { x: 0, y: 0, w: 30, h: 5 }))
    const html = renderPrintDocument(tpl, {}, {})
    expect(html).toContain('&lt;b&gt;&amp;&lt;/b&gt;')
    expect(html).not.toContain('<b>&</b>')
  })

  it('fontFamily 空串时输出系统默认字体栈', () => {
    const doc = baseDoc([createElement('text', { text: 'x', fontFamily: '' }, { x: 1, y: 1, w: 20, h: 8 })])
    const html = renderPrintDocument(doc, {}, {})
    expect(html).toContain(SYSTEM_FONT_STACK)
  })

  it('underline 输出 text-decoration:underline', () => {
    const doc = baseDoc([createElement('text', { text: 'x', underline: true }, { x: 1, y: 1, w: 20, h: 8 })])
    expect(renderPrintDocument(doc, {}, {})).toContain('text-decoration:underline')
  })

  it('竖排输出 writing-mode/text-orientation 与 flex row-reverse；align left 映射 justify-content:flex-start', () => {
    const doc = baseDoc([createElement('text', { text: '甲{{乙}}', direction: 'vertical', align: 'left' }, { x: 1, y: 1, w: 20, h: 40 })])
    const html = renderPrintDocument(doc, { 乙: '乙' }, {})
    expect(html).toContain('writing-mode:vertical-rl')
    expect(html).toContain('text-orientation:mixed')
    expect(html).toContain('flex-direction:row-reverse')
    expect(html).toContain('justify-content:flex-start')
  })

  it('空值横线占位为 text-decoration（非 border-bottom）', () => {
    const doc = baseDoc([createElement('text', { text: '{{d}}' }, { x: 1, y: 1, w: 20, h: 8 })])
    const html = renderPrintDocument(doc, { d: EMPTY_LINE_TOKEN }, {})
    expect(html).toContain('text-decoration:underline')
    expect(html).not.toContain('border-bottom')
  })
})
