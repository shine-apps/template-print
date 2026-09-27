import { pxToMmAt96 } from '../../../shared/units'
import { fontCssProps, textCssString, toCssString } from '../../../print-core/text-style'
import type { MeasuredProbeLine, TextStyle } from '../../../print-core/text-layout'

/**
 * 像素补偿探针（仅设计器渲染进程使用）：
 * 在隐藏容器中以与打印端（renderPrintDocument → renderTextHtml）完全相同的 CSS 声明
 * 排出横排文本，再用 Range.getClientRects 逐字符实测浏览器真实排版：
 *   - 换行结果（word-break:break-word + pre-wrap，与打印同源，含 kerning）
 *   - text-align 的行起点偏移
 *   - flex align-items:safe center 的垂直居中偏移（含溢出退化）
 *   - 每行 alphabetic 基线位置（inline-block 基线探针实测，不依赖任何字体常量）
 * 实测 px 换算回 mm 后交给 layoutText，画布逐字 fillText 直接采用，
 * 从而消除「手工排版 + Canvas top 基线」与「CSS 行盒」之间的系统性像素差。
 *
 * 设计器/预览/打印同处一个 Electron Chromium（同版本同字体），探针几何即打印几何。
 */

let host: HTMLDivElement | null = null

function ensureHost(): HTMLDivElement {
  if (host) return host
  host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  // visibility:hidden 仍参与排版（display:none 无法测量）；fixed 脱离文档流不影响界面
  host.style.cssText =
    'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;z-index:-9999;' +
    'margin:0;padding:0;border:0;'
  document.body.appendChild(host)
  return host
}

interface BaselineMetric {
  /** 字体内容区顶部 → alphabetic 基线的距离（px），与 line-height 无关 */
  ascentPx: number
}

const baselineCache = new Map<string, BaselineMetric>()

/**
 * 单行基线探针：容器无 flex/无 padding（盒顶即行盒顶），
 * 内联 1×1 inline-block 的底边（vertical-align:baseline）落在基线上；
 * Range 矩形给出字体内容区相对行盒顶的位置，两者之差即内容区内的 ascent。
 */
function measureBaseline(metricCss: string): BaselineMetric {
  const cached = baselineCache.get(metricCss)
  if (cached) return cached

  const h = ensureHost()
  const box = document.createElement('div')
  box.style.cssText = `position:absolute;left:0;top:0;${metricCss};width:max-content;margin:0;padding:0;border:0;`
  const textNode = document.createTextNode('M')
  const probe = document.createElement('span')
  probe.style.cssText = 'display:inline-block;width:1px;height:1px;padding:0;border:0;margin:0;'
  box.appendChild(textNode)
  box.appendChild(probe)
  h.appendChild(box)

  const boxTop = box.getBoundingClientRect().top
  const baselinePx = probe.getBoundingClientRect().bottom - boxTop
  const range = document.createRange()
  range.setStart(textNode, 0)
  range.setEnd(textNode, 1)
  // Range 矩形为行盒内字体内容区；若浏览器给出整行盒（top 与盒顶重合），contentTop=0 同样成立
  const rect = range.getClientRects()[0]
  const contentTopPx = rect ? rect.top - boxTop : 0
  const metric = { ascentPx: baselinePx - contentTopPx }
  box.remove()
  baselineCache.set(metricCss, metric)
  return metric
}

interface CharRect { ch: string; leftPx: number; rightPx: number }
interface LineGroup { topPx: number; chars: CharRect[] }

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * 实测一段横排文本的逐行几何。无法测量（无 DOM、零尺寸、空文本）时返回 null，
 * 调用方回退到手工程序化排版。
 */
export function measureHorizontalDom(
  text: string,
  boxWMm: number,
  boxHMm: number,
  st: TextStyle
): MeasuredProbeLine[] | null {
  if (!text || typeof document === 'undefined') return null

  const h = ensureHost()
  const outer = document.createElement('div')
  outer.style.cssText =
    `position:relative;box-sizing:border-box;overflow:hidden;` +
    `width:${boxWMm}mm;height:${boxHMm}mm;margin:0;padding:0;border:0;`
  const inner = document.createElement('div')
  // 与打印端横排文本同一份样式真源（下划线装饰不影响几何，关闭以减少干扰）
  inner.style.cssText = textCssString({ ...st, direction: 'horizontal', underline: false }).outer
  const textNode = document.createTextNode(text)
  inner.appendChild(textNode)
  outer.appendChild(inner)
  h.appendChild(outer)

  try {
    const outerRect = outer.getBoundingClientRect()
    if (outerRect.width === 0 || outerRect.height === 0) return null

    const metricCss = toCssString({ ...fontCssProps(st), lineHeight: st.lineHeight })
    const metric = measureBaseline(metricCss)

    const groups: LineGroup[] = []
    let current: LineGroup | null = null
    let lineBreakBeforeNext = false
    const range = document.createRange()

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '\n') {
        // 强制换行符本身不绘制；标记其后的字符另起一行
        lineBreakBeforeNext = true
        continue
      }
      range.setStart(textNode, i)
      range.setEnd(textNode, i + 1)
      const rect = range.getClientRects()[0]
      if (!rect) {
        lineBreakBeforeNext = true
        continue
      }
      const topPx = rect.top - outerRect.top
      // 0.5px 容差区分不同视觉行（亚像素定位下同一行各字 top 可能有极小差异）
      if (!current || lineBreakBeforeNext || Math.abs(topPx - current.topPx) > 0.5) {
        current = { topPx, chars: [] }
        groups.push(current)
      }
      lineBreakBeforeNext = false
      current.chars.push({
        ch,
        leftPx: rect.left - outerRect.left,
        rightPx: rect.right - outerRect.left
      })
    }

    if (groups.length === 0) return null

    return groups.map((g) => {
      const first = g.chars[0]
      const last = g.chars[g.chars.length - 1]
      const top = round2(pxToMmAt96(g.topPx))
      return {
        x: round2(pxToMmAt96(first.leftPx)),
        top,
        widthMm: round2(pxToMmAt96(last.rightPx - first.leftPx)),
        baselineY: round2(pxToMmAt96(g.topPx + metric.ascentPx)),
        chars: g.chars.map((c) => ({ ch: c.ch, x: round2(pxToMmAt96(c.leftPx)) }))
      }
    })
  } finally {
    outer.remove()
  }
}
