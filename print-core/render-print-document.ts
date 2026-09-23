import type { TemplateDocument, TemplateElement } from './template-model'
import { EMPTY_LINE_TOKEN } from './param-evaluator'

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

function renderElement(el: TemplateElement, values: Record<string, string>, assetUrls: Record<string, string>): string {
  const style = geoStyle(el)
  switch (el.type) {
    case 'text': {
      const p = el.props
      return `<div style="${style};font-family:'${esc(p.fontFamily)}';font-size:${p.fontSizeMm}mm;` +
        `font-weight:${p.bold ? 'bold' : 'normal'};font-style:${p.italic ? 'italic' : 'normal'};` +
        `text-align:${p.align};color:${p.color};line-height:${p.lineHeight};` +
        `display:flex;align-items:flex-start;justify-content:${p.align === 'center' ? 'center' : p.align === 'right' ? 'flex-end' : 'flex-start'}">` +
        `${esc(p.text)}</div>`
    }
    case 'param': {
      const p = el.props
      const raw = values[p.paramId] ?? ''
      if (raw === EMPTY_LINE_TOKEN) {
        return `<div style="${style};border-bottom:0.3mm solid #000"></div>`
      }
      return `<div style="${style};font-family:'${esc(p.fontFamily)}';font-size:${p.fontSizeMm}mm;` +
        `font-weight:${p.bold ? 'bold' : 'normal'};text-align:${p.align};color:${p.color};` +
        `overflow:hidden;white-space:pre-wrap;word-break:break-word">${esc(raw)}</div>`
    }
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
  const sorted = [...doc.content.elements].sort((a, b) => a.zIndex - b.zIndex)
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
