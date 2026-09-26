import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { mmToPxAt96 } from '../../../shared/units'
import { SYSTEM_FONT_STACK } from '../../../print-core/text-layout'
import type { TemplateDocument, TemplateElement } from '../../../print-core/template-model'

/** 卡片封面高度（px），与模板卡片网格协调 */
const COVER_HEIGHT = 156
const PAD = 10

/**
 * 模板列表缩略图：以 mm 坐标 + CSS 等比缩放呈现模板真实版式（文本/图片/图形）。
 * 文本中的 {{参数}} 占位符原样展示并高亮，图片元素按需通过 IPC 取 data URL。
 */
export function TemplateThumbnail({ doc }: { doc: TemplateDocument }): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  const assetUrls = useAssetUrls(doc)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = (): void => setBoxWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pxW = mmToPxAt96(doc.paper.widthMm)
  const pxH = mmToPxAt96(doc.paper.heightMm)
  const scale = boxWidth > 0
    ? Math.min((boxWidth - PAD * 2) / pxW, (COVER_HEIGHT - PAD * 2) / pxH)
    : 0

  const sorted = [...doc.content.elements].sort((a, b) => a.zIndex - b.zIndex)

  return (
    <div ref={boxRef}
      style={{
        height: COVER_HEIGHT,
        background: '#fafafa',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}>
      {scale > 0 && (
        <div
          style={{
            width: pxW * scale,
            height: pxH * scale,
            position: 'relative',
            background: '#fff',
            border: '1px solid #bbb',
            boxShadow: '0 1px 4px rgba(0,0,0,.15)',
            boxSizing: 'content-box'
          }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: `${doc.paper.widthMm}mm`,
              height: `${doc.paper.heightMm}mm`,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              overflow: 'hidden'
            }}>
            {sorted.map((el) => (
              <ThumbElement key={el.id} el={el} assetUrls={assetUrls} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** 仅含图片元素的模板才拉取资产 data URL；按 doc.id 去重避免筛选刷新重复请求 */
function useAssetUrls(doc: TemplateDocument): Record<string, string> {
  const hasImages = doc.content.elements.some((e) => e.type === 'image')
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!hasImages) return
    let cancelled = false
    void window.api.assets.listUrls(doc.id)
      .then((map) => { if (!cancelled) setUrls(map) })
      .catch(() => { if (!cancelled) setUrls({}) })
    return () => { cancelled = true }
  }, [doc.id, hasImages])
  return urls
}

function geoStyle(el: TemplateElement, extra?: CSSProperties): CSSProperties {
  return {
    position: 'absolute',
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.w}mm`,
    height: `${el.h}mm`,
    boxSizing: 'border-box',
    ...(el.rotation ? { transform: `rotate(${el.rotation}deg)` } : null),
    ...extra
  }
}

function fontFamily(family: string): string {
  const f = family.trim()
  return f ? `'${f.replace(/'/g, '\\\'')}', ${SYSTEM_FONT_STACK}` : SYSTEM_FONT_STACK
}

/** 文本分段：普通片段原样展示，{{参数名称}} 高亮为参数占位符样式 */
function textSegments(text: string): ReactNode[] {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(
      <span key={key++}
        style={{
          background: 'rgba(22,119,255,.12)',
          color: '#1677ff',
          borderRadius: 2,
          padding: '0 1px',
          whiteSpace: 'pre'
        }}>{m[0]}</span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function ThumbElement({ el, assetUrls }: {
  el: TemplateElement
  assetUrls: Record<string, string>
}): JSX.Element | null {
  if (el.type === 'text') {
    const p = el.props
    const fontStyle: CSSProperties = {
      fontFamily: fontFamily(p.fontFamily),
      fontSize: `${p.fontSizeMm}mm`,
      fontWeight: p.bold ? 'bold' : 'normal',
      fontStyle: p.italic ? 'italic' : 'normal',
      color: p.color,
      lineHeight: p.lineHeight,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'hidden'
    }
    if (p.direction === 'vertical') {
      const justify = p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center'
      return (
        <div style={geoStyle(el)}>
          <div style={{ display: 'flex', flexDirection: 'row-reverse', justifyContent: justify, width: '100%', height: '100%', overflow: 'hidden' }}>
            <div style={{
              ...fontStyle,
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              height: '100%',
              textDecoration: p.underline ? 'underline' : 'none'
            }}>{textSegments(p.text)}</div>
          </div>
        </div>
      )
    }
    return (
      <div style={geoStyle(el)}>
        <div style={{
          ...fontStyle,
          height: '100%',
          textAlign: p.align,
          textDecoration: p.underline ? 'underline' : 'none',
          textDecorationThickness: '0.2mm'
        }}>{textSegments(p.text)}</div>
      </div>
    )
  }

  if (el.type === 'image') {
    const src = assetUrls[el.props.assetId]
    return (
      <div style={geoStyle(el, { overflow: 'hidden' })}>
        {src
          ? <img src={src} alt="" draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: el.props.fit,
              opacity: el.props.opacity,
              display: 'block'
            }} />
          : null}
      </div>
    )
  }

  // shape
  const p = el.props
  if (p.shape === 'line') {
    return (
      <div style={geoStyle(el, {
        height: 0,
        top: `${el.y + el.h / 2}mm`,
        borderTop: `${p.strokeWidthMm}mm solid ${p.strokeColor}`
      })} />
    )
  }
  return (
    <div style={geoStyle(el, {
      border: `${p.strokeWidthMm}mm solid ${p.strokeColor}`,
      borderRadius: p.shape === 'ellipse' ? '50%' : '0',
      background: p.fillColor ?? 'transparent'
    })} />
  )
}
