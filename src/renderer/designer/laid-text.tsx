import { useEffect, useMemo, useReducer, type Ref } from 'react'
import { Shape } from 'react-konva'
import type Konva from 'konva'
import { mmToPxAt96 } from '../../../shared/units'
import { layoutText, SYSTEM_FONT_STACK, type Measurer, type TextStyle } from '../../../print-core/text-layout'
import type { TemplateElement } from '../../../print-core/template-model'
import { measureHorizontalDom } from './dom-text-probe'

type TextEl = Extract<TemplateElement, { type: 'text' }>

/** 离屏 canvas 2D 测量：入参 mm，返回 mm；内部按当前画布缩放比构造字号像素 */
function createPxMeasurer(scale: number): Measurer {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  return {
    measureChar(ch, fontSizeMm, st) {
      const fsPx = mmToPxAt96(fontSizeMm) * scale
      const family = st.fontFamily.trim() === ''
        ? SYSTEM_FONT_STACK
        : `"${st.fontFamily.replace(/"/g, '')}", ${SYSTEM_FONT_STACK}`
      ctx.font = `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${fsPx}px ${family}`
      const wPxAt96 = ctx.measureText(ch).width / scale
      return { w: wPxAt96 / mmToPxAt96(1), h: fontSizeMm }
    },
    // 横排走 DOM 像素补偿：探针以打印端同款 CSS 实测逐字几何（竖排返回 null，由手工排版处理）
    measureHorizontal: (text, boxW, boxH, st) =>
      st.direction === 'vertical' ? null : measureHorizontalDom(text, boxW, boxH, st)
  }
}

export interface LaidTextProps {
  el: TextEl
  scale: number
  shapeRef: Ref<Konva.Shape>
  commonProps: Record<string, unknown>
  onEdit: () => void
}

export function LaidText({ el, scale, shapeRef, commonProps, onEdit }: LaidTextProps): JSX.Element {
  // 字体异步加载完成后自增：DOM 探针测量与画布重绘都依赖最终字体度量
  const [fontTick, force] = useReducer((x: number) => x + 1, 0)
  const wPx = mmToPxAt96(el.w) * scale
  const hPx = mmToPxAt96(el.h) * scale

  // 系统/自定义字体异步加载完成后重绘
  useEffect(() => {
    const fonts = document.fonts
    void fonts?.ready.then(force)
    const handler = (): void => force()
    fonts?.addEventListener?.('loadingdone', handler)
    return () => fonts?.removeEventListener?.('loadingdone', handler)
  }, [])

  const st: TextStyle = useMemo(() => ({
    fontFamily: el.props.fontFamily,
    fontSizeMm: el.props.fontSizeMm,
    bold: el.props.bold,
    italic: el.props.italic,
    underline: el.props.underline,
    align: el.props.align,
    color: el.props.color,
    lineHeight: el.props.lineHeight,
    direction: el.props.direction,
    columnDirection: el.props.columnDirection
  }), [el.props])

  const laid = useMemo(
    () => layoutText(el.props.text, el.w, el.h, st, createPxMeasurer(scale)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [el.props.text, el.w, el.h, st, scale, fontTick]
  )

  const family = el.props.fontFamily.trim() === ''
    ? SYSTEM_FONT_STACK
    : `"${el.props.fontFamily.replace(/"/g, '')}", ${SYSTEM_FONT_STACK}`

  return (
    <Shape
      ref={shapeRef}
      {...commonProps}
      onDblClick={() => onEdit()}
      sceneFunc={(ctx) => {
        const fsPx = mmToPxAt96(el.props.fontSizeMm) * scale
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, wPx, hPx)
        ctx.clip()
        ctx.font = `${el.props.italic ? 'italic ' : ''}${el.props.bold ? 'bold ' : ''}${fsPx}px ${family}`
        ctx.fillStyle = el.props.color
        for (const line of laid.lines) {
          // DOM 实测行按字母基线落字；手工排版行（含竖排）按 em-box 顶部
          ctx.textBaseline = line.baseline === 'alphabetic' ? 'alphabetic' : 'top'
          for (const c of line.chars) {
            const x = mmToPxAt96(c.x) * scale
            const y = mmToPxAt96(c.y) * scale
            if (c.rotated) {
              ctx.save()
              ctx.translate(x + fsPx / 2, y + fsPx / 2)
              ctx.rotate(Math.PI / 2)
              ctx.fillText(c.ch, -fsPx / 2, -fsPx / 2)
              ctx.restore()
            } else {
              ctx.fillText(c.ch, x, y)
            }
          }
          for (const u of line.underlines) {
            const ux = mmToPxAt96(u.x) * scale
            const uy = mmToPxAt96(u.y) * scale
            const uw = Math.max(mmToPxAt96(u.w) * scale, 0.5)
            const uh = Math.max(mmToPxAt96(u.h) * scale, 0.5)
            ctx.fillRect(ux, uy, uw, uh)
          }
        }
        ctx.restore()
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath()
        ctx.rect(0, 0, wPx, hPx)
        ctx.fillStrokeShape(shape)
      }}
    />
  )
}
