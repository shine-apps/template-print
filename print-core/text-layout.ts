// 注意：该常量会内联进打印 HTML 的 style="..." 双引号属性中，字体名只能用单引号，
// 双引号会提前闭合 style 属性导致后续声明全部丢失（打印回退默认字体/无加粗下划线）。
export const SYSTEM_FONT_STACK =
  "system-ui, 'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif"

export type TextDirection = 'horizontal' | 'vertical'
export type TextAlign = 'left' | 'center' | 'right'

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
}

export interface LaidChar { ch: string; x: number; y: number; rotated: boolean }
export interface UnderlineSeg { x: number; y: number; w: number; h: number }
export interface LaidLine {
  chars: LaidChar[]
  widthMm: number
  heightMm: number
  underlines: UnderlineSeg[]
}
export interface LayoutResult { lines: LaidLine[]; widthMm: number; heightMm: number }

const round2 = (n: number) => Math.round(n * 100) / 100

/** CJK 汉字、全角/表意标点在竖排中保持正立；ASCII 等旋转 90° */
export function isUprightChar(ch: string): boolean {
  return /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/.test(ch)
}

/** 分段：ASCII 单词/连续空白各为一段（段内不优先断行），其余逐字符 */
function segments(text: string): string[] {
  return text.match(/[A-Za-z0-9]+|\s+|[\s\S]/g) ?? []
}

interface Cell { ch: string; w: number; rotated: boolean }

/** cross=当前行/列的排版轴容量（横排=框宽，竖排=框高） */
function buildLines(
  text: string,
  boxCross: number,
  st: TextStyle,
  vertical: boolean,
  m: Measurer
): { cells: Cell[]; cross: number }[] {
  const cell = (ch: string): Cell => ({
    ch,
    w: round2(m.measureChar(ch, st.fontSizeMm, st).w),
    rotated: vertical ? !isUprightChar(ch) : false
  })
  const lines: { cells: Cell[]; cross: number }[] = []
  let cur: Cell[] = []
  let cursor = 0
  const flush = () => { lines.push({ cells: cur, cross: cursor }); cur = []; cursor = 0 }

  for (const segStr of segments(text)) {
    const seg = segStr.split('').map(cell)
    const segW = seg.reduce((s, c) => s + c.w, 0)
    // 行非空且整段放不下 → 整段下沉新行（ASCII 单词不拆）；
    // 新行仍放不下的超长段在下方逐字循环中被强制断字
    if (cursor > 0 && cursor + segW > boxCross) flush()
    for (const c of seg) {
      if (cursor > 0 && cursor + c.w > boxCross) flush()
      cur.push(c); cursor = round2(cursor + c.w)
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
    const contentH = round2(rawLines.length * pitch)
    const offsetY = round2(Math.max(0, (boxH - contentH) / 2))
    rawLines.forEach((ln, i) => {
      let startX = 0
      if (st.align === 'center') startX = round2((boxW - ln.cross) / 2)
      else if (st.align === 'right') startX = round2(boxW - ln.cross)
      const y = round2(offsetY + i * pitch)
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
      const lc = { ch: c.ch, x, y: cy, rotated: c.rotated }
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
