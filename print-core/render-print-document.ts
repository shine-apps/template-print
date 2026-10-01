import type { TemplateDocument, TemplateElement } from './template-model'
import { EMPTY_LINE_TOKEN } from './param-evaluator'
import { textCssString, verticalGlyphCss, type TextStyleProps } from './text-style'

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
    // 绕左上角旋转：设计器 Konva 的 (x,y) 即旋转原点；CSS 默认 50% 50% 会导致旋转后偏移
    el.rotation ? 'transform-origin:0 0' : '',
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

type TextProps = {
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
  columnDirection: 'rtl' | 'ltr'
}

/** 竖排逐字单元格：char=单字（每字占一个字身格），empty-line=空值横线占位，br=换行强制断列 */
type VCell =
  | { kind: 'char'; ch: string }
  | { kind: 'empty-line' }
  | { kind: 'br' }

/** 竖排：把文本解析成逐字单元格序列（含 {{参数}} 求值、\n 断列、空值横线占位） */
function verticalCells(text: string, values: Record<string, string>): VCell[] {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  const cells: VCell[] = []
  let last = 0
  let m: RegExpExecArray | null
  const pushChars = (raw: string): void => {
    for (const ch of raw) {
      if (ch === '\n') cells.push({ kind: 'br' })
      else cells.push({ kind: 'char', ch })
    }
  }
  while ((m = re.exec(text))) {
    pushChars(text.slice(last, m.index))
    const v = values[m[1].trim()] ?? ''
    if (v === EMPTY_LINE_TOKEN) cells.push({ kind: 'empty-line' })
    else pushChars(v)
    last = m.index + m[0].length
  }
  pushChars(text.slice(last))
  return cells
}

/**
 * 方案 B：竖排不再依赖 writing-mode，改为逐字绝对定位 span。
 * 每个字的垂直推进用显式 top = row × fontSizeMm（1em），列宽 = fontSizeMm × lineHeight，
 * 消除浏览器 vertical-rl/lr 逐字推进的字体 vertical advance 亚像素取整在
 * 「预览 96dpi 屏幕排版」与「webContents.print 打印机 DPI 排版」两套管线间的累积偏差。
 */
function renderVerticalHtml(
  p: TextProps,
  values: Record<string, string>,
  boxW: number,
  boxH: number
): string {
  const cells = verticalCells(p.text, values)
  const glyphCss = verticalGlyphCss(p as TextStyleProps)
  if (cells.length === 0) {
    return `<div style="position:relative;width:100%;height:100%;overflow:hidden"></div>`
  }
  const fs = p.fontSizeMm
  const colW = fs * p.lineHeight
  const maxPerCol = Math.max(1, Math.floor(boxH / fs))
  // 拆列：\n 强制断列；每列最多 maxPerCol 字（1em 推进）
  const cols: VCell[][] = []
  let cur: VCell[] = []
  for (const c of cells) {
    if (c.kind === 'br') {
      if (cur.length > 0) { cols.push(cur); cur = [] }
    } else {
      cur.push(c)
      if (cur.length >= maxPerCol) { cols.push(cur); cur = [] }
    }
  }
  if (cur.length > 0) cols.push(cur)
  const n = cols.length
  const groupW = n * colW
  // 列组水平对齐：与外层 flex row-reverse 的历史语义一致——align=left 贴右、right 贴左、center 居中
  const originX =
    p.align === 'left' ? Math.max(0, boxW - groupW)
    : p.align === 'right' ? 0
    : Math.max(0, (boxW - groupW) / 2)
  const spans: string[] = []
  cols.forEach((col, i) => {
    // rtl：第 0 列在最右；ltr：第 0 列在最左
    const colLeft = originX + (p.columnDirection === 'ltr' ? i * colW : (n - 1 - i) * colW)
    col.forEach((c, row) => {
      const top = row * fs
      const content = c.kind === 'char' ? esc(c.ch) : '&nbsp;'
      const underline = p.underline || c.kind === 'empty-line'
      const underlineCss = underline ? 'text-decoration:underline;text-decoration-thickness:0.2mm;' : ''
      spans.push(
        `<span style="position:absolute;left:${colLeft}mm;top:${top}mm;width:${colW}mm;height:${fs}mm;` +
        `${glyphCss};${underlineCss}">${content}</span>`
      )
    })
  })
  return `<div style="position:relative;width:100%;height:100%;overflow:hidden">${spans.join('')}</div>`
}

function renderTextHtml(
  p: TextProps,
  values: Record<string, string>,
  boxW: number,
  boxH: number
): string {
  if (p.direction === 'vertical') {
    return renderVerticalHtml(p, values, boxW, boxH)
  }
  // 横排：flex + align-items:safe center 垂直居中（溢出退化为顶部对齐，不裁首行）
  const body = textSegments(p.text, values)
  const { outer } = textCssString(p as TextStyleProps)
  return `<div style="${outer}">${body}</div>`
}

function renderElement(el: TemplateElement, values: Record<string, string>, assetUrls: Record<string, string>): string {
  const style = geoStyle(el)
  switch (el.type) {
    case 'text':
      return `<div style="${style}">${renderTextHtml(el.props, values, el.w, el.h)}</div>`
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
  // textOnly（预印纸套打）：图片/图形/边框节点不生成；
  // 实打印/缩略图走此过滤，渲染端预览固定传 textOnly:false 以显示完整版式
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
