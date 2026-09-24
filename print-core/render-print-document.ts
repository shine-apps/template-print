import type { TemplateDocument, TemplateElement } from './template-model'
import { EMPTY_LINE_TOKEN } from './param-evaluator'
import { SYSTEM_FONT_STACK } from './text-layout'

export interface RenderOptions {
  /** assetId → 可在打印窗口/预览中访问的图片 URL（file:// 或 data:） */
  [assetId: string]: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function geoStyle(el: TemplateElement): string {
  return [
    `left:${el.x}mm`,
    `top:${el.y}mm`,
    `width:${el.w}mm`,
    `height:${el.h}mm`,
    el.rotation ? `transform:rotate(${el.rotation}deg)` : '',
    'position:absolute',
    'box-sizing:border-box'
  ]
    .filter(Boolean)
    .join(';')
}

/**
 * 文本分段渲染：普通片段做 HTML 转义；{{参数名称}} token 用求值后的值替换（同样转义），
 * 值为空值横线标记时渲染为逻辑下划线片段。未知名替换为空串。
 */
function textSegments(text: string, values: Record<string, string>): string {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    parts.push(esc(text.slice(last, m.index)))
    const v = values[m[1].trim()] ?? ''
    parts.push(
      v === EMPTY_LINE_TOKEN
        ? '<span style="text-decoration:underline;white-space:pre">&emsp;&emsp;</span>'
        : esc(v)
    )
    last = m.index + m[0].length
  }
  parts.push(esc(text.slice(last)))
  return parts.join('')
}

function fontCss(p: { fontFamily: string; fontSizeMm: number; bold: boolean; italic: boolean }): string {
  const family = p.fontFamily.trim() === ''
    ? SYSTEM_FONT_STACK
    : `'${p.fontFamily.replace(/'/g, '\\\'')}', ${SYSTEM_FONT_STACK}`
  return `font-family:${family};font-size:${p.fontSizeMm}mm;` +
    `font-weight:${p.bold ? 'bold' : 'normal'};font-style:${p.italic ? 'italic' : 'normal'}`
}

function renderTextHtml(
  p: {
    text: string
    fontFamily: string
    fontSizeMm: number
    bold: boolean
    italic: boolean
    underline: boolean
    direction: 'horizontal' | 'vertical'
    align: 'left' | 'center' | 'right'
    color: string
    lineHeight: number
  },
  values: Record<string, string>
): string {
  const body = textSegments(p.text, values)
  const deco = p.underline ? 'text-decoration:underline;text-decoration-thickness:0.2mm;' : ''
  if (p.direction === 'vertical') {
    const justify = p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center'
    // 外层 flex row-reverse 实现列组对齐（left=贴右=flex-start）；内层 vertical-rl 实现竖排
    return `<div style="display:flex;flex-direction:row-reverse;justify-content:${justify};width:100%;height:100%;overflow:hidden">` +
      `<div style="writing-mode:vertical-rl;text-orientation:mixed;height:100%;${fontCss(p)};` +
      `color:${p.color};line-height:${p.lineHeight};white-space:pre-wrap;word-break:break-word;overflow:hidden;${deco}">${body}</div></div>`
  }
  // height:100% 把文本约束在元素框内，超出部分由 overflow:hidden 裁剪（与画布 LaidText 裁剪一致）
  return `<div style="height:100%;${fontCss(p)};color:${p.color};line-height:${p.lineHeight};` +
    `text-align:${p.align};white-space:pre-wrap;word-break:break-word;overflow:hidden;${deco}">${body}</div>`
}

function renderElement(el: TemplateElement, values: Record<string, string>, assetUrls: Record<string, string>): string {
  const style = geoStyle(el)
  switch (el.type) {
    case 'text':
      return `<div style="${style}">${renderTextHtml(el.props, values)}</div>`
    case 'image': {
      const p = el.props
      const src = assetUrls[p.assetId] ?? ''
      const objectFit = p.fit === 'fill' ? 'fill' : p.fit
      return `<div style="${style};overflow:hidden"><img src="${esc(src)}" ` +
        `style="width:100%;height:100%;object-fit:${objectFit};opacity:${p.opacity}" /></div>`
    }
    case 'shape': {
      const p = el.props
      if (p.shape === 'line') {
        return `<div style="${style};border-top:${p.strokeWidthMm}mm solid ${p.strokeColor};height:0;top:${el.y + el.h / 2}mm"></div>`
      }
      const radius = p.shape === 'ellipse' ? '50%' : '0'
      return `<div style="${style};border:${p.strokeWidthMm}mm solid ${p.strokeColor};` +
        `border-radius:${radius};background:${p.fillColor ?? 'transparent'}"></div>`
    }
  }
}

export function renderPrintDocument(
  doc: TemplateDocument,
  values: Record<string, string>,
  assetUrls: RenderOptions
): string {
  const { widthMm, heightMm } = doc.paper
  // textOnly（预印纸套打）：图片/图形/边框节点不生成，预览/实打印/缩略图共用此输出
  const visibleElements = doc.textOnly
    ? doc.content.elements.filter((el) => el.type === 'text')
    : doc.content.elements
  const sorted = [...visibleElements].sort((a, b) => a.zIndex - b.zIndex)
  const body = sorted.map((el) => renderElement(el, values, assetUrls)).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${widthMm}mm; height: ${heightMm}mm;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { overflow: visible; }
</style>
</head>
<body>
${body}
</body>
</html>`
}
