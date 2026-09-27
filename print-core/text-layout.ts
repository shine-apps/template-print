// 注意：该常量会内联进打印 HTML 的 style="..." 双引号属性中，字体名只能用单引号，
// 双引号会提前闭合 style 属性导致后续声明全部丢失（打印回退默认字体/无加粗下划线）。
// 规范真源位于 text-style.ts，此处转出以保持既有引用路径可用。
import { SYSTEM_FONT_STACK } from './text-style'
import type { TextDirection, TextAlign } from './text-style'
export { SYSTEM_FONT_STACK }
export type { TextDirection, TextAlign }

export interface TextStyle {
  fontFamily: string
  fontSizeMm: number
  bold: boolean
  italic: boolean
  underline: boolean
  align: TextAlign
  color: string
  lineHeight: number
  direction: TextDirection
}

export interface Measurer {
  measureChar(ch: string, fontSizeMm: number, style: TextStyle): { w: number; h: number }
  /**
   * 可选：宿主用与打印端完全相同的 CSS 实测横排几何（真实换行/字距/基线/垂直居中），
   * layoutText 直接采用实测像素坐标，避免手工排版与浏览器行盒模型的系统性偏差。
   * 返回 null/空数组表示当前环境无法测量，回退到手工排版。竖排不走此通道。
   */
  measureHorizontal?(
    text: string,
    boxW: number,
    boxH: number,
    st: TextStyle
  ): MeasuredProbeLine[] | null
}

/** DOM 实测的一行横排文本几何，单位 mm，坐标相对元素框 */
export interface MeasuredProbeLine {
  /** 行内容左边缘（已含 text-align 偏移） */
  x: number
  /** 行内容区顶部（已含 flex 垂直居中偏移） */
  top: number
  /** 行内容宽度（首字符左缘→末字符右缘） */
  widthMm: number
  /** 本行 alphabetic 基线 y（相对元素框顶部） */
  baselineY: number
  /** 逐字符 x（笔位起点，已含浏览器 kerning/断行结果）；y 统一取本行 baselineY */
  chars: { ch: string; x: number }[]
}

export interface LaidChar { ch: string; x: number; y: number; rotated: boolean }
export interface UnderlineSeg { x: number; y: number; w: number; h: number }
export interface LaidLine {
  chars: LaidChar[]
  widthMm: number
  heightMm: number
  underlines: UnderlineSeg[]
  /** 本行字符 y 的语义：'top'=em-box 顶（手工排版默认）；'alphabetic'=字母基线（DOM 实测） */
  baseline?: 'top' | 'alphabetic'
}
export interface LayoutResult { lines: LaidLine[]; widthMm: number; heightMm: number }

const round2 = (n: number) => Math.round(n * 100) / 100

/** CJK 汉字、全角/表意文字判定（竖排正立字符集）。保留为工具函数；当前竖排统一正立，不再据此旋转 */
export function isUprightChar(ch: string): boolean {
  return /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/.test(ch)
}

/** 分段：ASCII 单词/连续空白各为一段（段内不优先断行），其余逐字符 */
function segments(text: string): string[] {
  return text.match(/[A-Za-z0-9]+|\s+|[\s\S]/g) ?? []
}

interface Cell {
  ch: string
  /** 字符实际墨迹宽（用于横排排版、竖排正立字形在字身格内的水平居中） */
  w: number
  /** 沿排版轴的步进：横排=墨迹宽；竖排正立=1em（每个字符占一个字身格） */
  advance: number
  rotated: boolean
}

/** cross=当前行/列的排版轴容量（横排=框宽，竖排=框高） */
function buildLines(
  text: string,
  boxCross: number,
  st: TextStyle,
  vertical: boolean,
  m: Measurer
): { cells: Cell[]; cross: number }[] {
  const fs = st.fontSizeMm
  const cell = (ch: string): Cell => {
    const w = round2(m.measureChar(ch, fs, st).w)
    return {
      ch,
      w,
      // 竖排 text-orientation:upright：任意字符（含数字/英文）都占 1em 字身格
      advance: vertical ? fs : w,
      rotated: false
    }
  }
  const lines: { cells: Cell[]; cross: number }[] = []
  let cur: Cell[] = []
  let cursor = 0
  const flush = () => { lines.push({ cells: cur, cross: cursor }); cur = []; cursor = 0 }

  for (const segStr of segments(text)) {
    const seg = segStr.split('').map(cell)
    const segW = seg.reduce((s, c) => s + c.advance, 0)
    // 行非空且整段放不下 → 整段下沉新行（ASCII 单词不拆）；
    // 新行仍放不下的超长段在下方逐字循环中被强制断字
    if (cursor > 0 && cursor + segW > boxCross) flush()
    for (const c of seg) {
      if (cursor > 0 && cursor + c.advance > boxCross) flush()
      cur.push(c); cursor = round2(cursor + c.advance)
    }
  }
  flush()
  return lines
}

export function layoutText(
  text: string,
  boxW: number,
  boxH: number,
  st: TextStyle,
  m: Measurer
): LayoutResult {
  const fs = st.fontSizeMm
  const paragraphs = text.split('\n')
  const vertical = st.direction === 'vertical'
  const pitch = round2(fs * st.lineHeight) // 横排=行高，竖排=列距
  const underlineThick = round2(Math.max(fs * 0.06, 0.15))

  interface RawLine { cells: Cell[]; cross: number }
  const rawLines: RawLine[] = []
  for (const par of paragraphs) {
    const built = buildLines(par, vertical ? boxH : boxW, st, vertical, m)
    rawLines.push(...built)
  }

  const lines: LaidLine[] = []

  if (!vertical) {
    // 像素补偿通道：宿主以与打印端相同的 CSS 实测几何，逐字符坐标与浏览器行盒完全一致
    // （真实换行/kerning/字体度量/垂直居中），y 为 alphabetic 基线。
    if (m.measureHorizontal) {
      const probed = m.measureHorizontal(text, boxW, boxH, st)
      if (probed && probed.length > 0) {
        const probeLines: LaidLine[] = probed.map((ln) => {
          const chars: LaidChar[] = ln.chars.map((c) => ({ ch: c.ch, x: c.x, y: ln.baselineY, rotated: false }))
          const underlines: UnderlineSeg[] = st.underline && ln.chars.length
            ? [{ x: ln.x, y: round2(ln.top + fs * 0.9), w: ln.widthMm, h: underlineThick }]
            : []
          return { chars, widthMm: ln.widthMm, heightMm: fs, underlines, baseline: 'alphabetic' }
        })
        const last = probed[probed.length - 1]
        return {
          lines: probeLines,
          widthMm: boxW,
          heightMm: round2(Math.min(boxH, Math.max(0, last.top + pitch)))
        }
      }
    }

    const contentH = round2(rawLines.length * pitch)
    const offsetY = round2(Math.max(0, (boxH - contentH) / 2))
    // 半行距补偿：CSS line-height>1 时差值对半拆为每行上下的 half-leading，
    // 字形 em-box 顶部位于半行距处；画布 textBaseline:'top' 需补上同一偏移，
    // 否则打印预览（CSS 行盒）的文字会比画布系统性偏下 (pitch-fs)/2。
    const halfLeading = round2((pitch - fs) / 2)
    rawLines.forEach((ln, i) => {
      let startX = 0
      if (st.align === 'center') startX = round2((boxW - ln.cross) / 2)
      else if (st.align === 'right') startX = round2(boxW - ln.cross)
      const y = round2(offsetY + halfLeading + i * pitch)
      let cx = startX
      const chars: LaidChar[] = ln.cells.map((c) => {
        const lc = { ch: c.ch, x: round2(cx), y, rotated: false }
        cx = round2(cx + c.w)
        return lc
      })
      const underlines: UnderlineSeg[] = st.underline && ln.cells.length
        ? [{ x: startX, y: round2(y + fs * 0.9), w: ln.cross, h: underlineThick }]
        : []
      lines.push({ chars, widthMm: ln.cross, heightMm: fs, underlines })
    })
    return { lines, widthMm: boxW, heightMm: Math.min(contentH, boxH) }
  }

  // 竖排：lines 即列，按视觉顺序右→左
  const colW = fs
  const occupied = round2(rawLines.length * colW + Math.max(0, rawLines.length - 1) * (pitch - colW))
  let rightEdge = boxW // 最右列的右边缘（= 首列 x + colW）
  if (st.align === 'left') rightEdge = boxW
  else if (st.align === 'right') rightEdge = occupied
  else rightEdge = round2((boxW + occupied) / 2)

  rawLines.forEach((ln, i) => {
    const x = round2(rightEdge - colW - i * pitch)
    let cy = 0
    const chars: LaidChar[] = ln.cells.map((c) => {
      // 正立字形在 1em 字身格内水平居中（数字/英文墨迹窄于字身格，汉字 c.w≈fs 偏移≈0）
      const lc = { ch: c.ch, x: round2(x + (fs - c.w) / 2), y: cy, rotated: c.rotated }
      cy = round2(cy + fs)
      return lc
    })
    const flowH = round2(ln.cells.length * fs)
    const underlines: UnderlineSeg[] = st.underline && ln.cells.length
      ? [{ x: round2(x + fs * 0.82), y: 0, w: underlineThick, h: flowH }]
      : []
    lines.push({ chars, widthMm: colW, heightMm: flowH, underlines })
  })
  return { lines, widthMm: Math.min(occupied, boxW), heightMm: boxH }
}
