// 文本样式单一真源：打印 HTML（render-print-document）与设计器画布的 DOM 测量探针共用。
// 两端同处 Electron Chromium，探针以与打印端完全相同的 CSS 声明实测逐字几何（换行/基线/
// 垂直居中），再用实测像素坐标补偿 Canvas 绘制，保证设计器=打印预览=实际打印像素级一致。
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

/** 样式对象 → CSS 声明字符串（过滤 undefined/null/空串），无尾部分号 */
export function toCssString(o: Record<string, string | number | undefined>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${kebab(k)}:${v}`)
    .join(';')
}

/** 字体四声明（font-family/font-size/font-weight/font-style），横排竖排/探针共用 */
export function fontCssProps(p: Pick<TextStyleProps, 'fontFamily' | 'fontSizeMm' | 'bold' | 'italic'>): Record<string, string> {
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

type CssDecl = string | number | undefined

/**
 * DOM/HTML 文本样式：
 * - 横排：单 flex 容器，align-items:safe center 垂直居中（内容溢出时退化为顶部对齐，不裁首行）
 * - 竖排：{ outer, inner }——outer 用 flex row-reverse 决定列组对齐，inner 用 writing-mode 竖排
 */
export function textCssProps(p: TextStyleProps): {
  outer: Record<string, CssDecl>
  inner?: Record<string, CssDecl>
} {
  const deco = p.underline
    ? { textDecoration: 'underline', textDecorationThickness: '0.2mm' }
    : {}
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
        ...fontCssProps(p),
        color: p.color,
        lineHeight: p.lineHeight,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        ...deco
      }
    }
  }
  return {
    outer: {
      display: 'flex',
      alignItems: 'safe center',
      height: '100%',
      ...fontCssProps(p),
      color: p.color,
      lineHeight: p.lineHeight,
      textAlign: p.align,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'hidden',
      ...deco
    }
  }
}

/** 打印 HTML 用：横排返回单容器 style；竖排返回 { outer, inner } 两段 style */
export function textCssString(p: TextStyleProps): { outer: string; inner?: string } {
  const { outer, inner } = textCssProps(p)
  return { outer: toCssString(outer), inner: inner ? toCssString(inner) : undefined }
}
