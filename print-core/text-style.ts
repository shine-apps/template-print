// 文本样式单一真源：打印 HTML（render-print-document）与设计器画布 DOM 文本层共用。
// 两端同处 Electron Chromium，使用同一份 CSS 声明，保证画布=预览=实际打印像素级一致。
//
// 注意：SYSTEM_FONT_STACK 会内联进打印 HTML 的 style="..." 双引号属性中，字体名只能用单引号，
// 双引号会提前闭合 style 属性导致后续声明全部丢失（打印回退默认字体/无加粗下划线）。

export const SYSTEM_FONT_STACK =
  "system-ui, 'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif"

export type TextDirection = 'horizontal' | 'vertical'
export type TextAlign = 'left' | 'center' | 'right'
/** 竖排多行（列）方向：rtl=从右到左（vertical-rl）、ltr=从左到右（vertical-lr） */
export type ColumnDirection = 'ltr' | 'rtl'

export interface TextStyleProps {
  fontFamily: string
  fontSizeMm: number
  bold: boolean
  italic: boolean
  underline: boolean
  direction: TextDirection
  columnDirection: ColumnDirection
  align: TextAlign
  color: string
  lineHeight: number
}

/** 驼峰 CSS 属性 → 短横线形式（如 textAlign → text-align） */
const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

/** 样式对象 → CSS 字符串（过滤 undefined/null） */
export function toCssString(o: Record<string, string | number | undefined>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${kebab(k)}:${v}`)
    .join(';')
}

function fontDecls(p: TextStyleProps): Record<string, string | number> {
  const family = p.fontFamily.trim() === ''
    ? SYSTEM_FONT_STACK
    : `'${p.fontFamily.replace(/'/g, '\\\'')}', ${SYSTEM_FONT_STACK}`
  return {
    fontFamily: family,
    fontSize: `${p.fontSizeMm}mm`,
    fontWeight: p.bold ? 'bold' : 'normal',
    fontStyle: p.italic ? 'italic' : 'normal'
  }
}

/**
 * DOM/HTML 文本样式：
 * - 横排：单层 flex 容器，align-items:safe center 垂直居中（溢出退化为顶部对齐，不裁首行）
 * - 竖排：{ outer, inner }——outer 固定 flex row-reverse 决定列组对齐（与列方向无关），
 *   inner 用 writing-mode 竖排：columnDirection rtl → vertical-rl，ltr → vertical-lr
 */
type CssDecl = string | number | undefined
export function textCssProps(p: TextStyleProps): {
  outer: Record<string, CssDecl>
  inner?: Record<string, CssDecl>
} {
  if (p.direction === 'vertical') {
    const justify = p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center'
    return {
      outer: {
        display: 'flex',
        flexDirection: 'row-reverse',
        justifyContent: justify,
        width: '100%',
        height: '100%',
        overflow: 'hidden'
      },
      inner: {
        // 列方向：rtl 用 vertical-rl（从右到左），ltr 用 vertical-lr（从左到右）；
        // 外层 flex row-reverse 的对齐语义与列方向无关，保持不变
        writingMode: p.columnDirection === 'ltr' ? 'vertical-lr' : 'vertical-rl',
        // upright：竖排中汉字、数字、英文字母一律正立（每个半角字符占一个字身格）；
        // 如需拉丁/数字顺时针横躺的传统混排，改回 'mixed'
        textOrientation: 'upright',
        height: '100%',
        ...fontDecls(p),
        color: p.color,
        lineHeight: p.lineHeight,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        textDecoration: p.underline ? 'underline' : undefined,
        textDecorationThickness: p.underline ? '0.2mm' : undefined
      }
    }
  }
  return {
    outer: {
      display: 'flex',
      alignItems: 'safe center',
      width: '100%',
      height: '100%',
      ...fontDecls(p),
      color: p.color,
      lineHeight: p.lineHeight,
      textAlign: p.align,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'hidden',
      textDecoration: p.underline ? 'underline' : undefined,
      textDecorationThickness: p.underline ? '0.2mm' : undefined
    }
  }
}

/** 打印 HTML 用：横排返回单容器 style；竖排返回 { outer, inner } 两段 style */
export function textCssString(p: TextStyleProps): { outer: string; inner?: string } {
  const { outer, inner } = textCssProps(p)
  return { outer: toCssString(outer), inner: inner ? toCssString(inner) : undefined }
}
