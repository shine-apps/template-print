import { describe, it, expect } from 'vitest'
import {
  SYSTEM_FONT_STACK,
  fontCssProps,
  textCssString,
  toCssString,
  type TextStyleProps
} from '../../print-core/text-style'

const props = (over: Partial<TextStyleProps> = {}): TextStyleProps => ({
  fontFamily: '',
  fontSizeMm: 10,
  bold: false,
  italic: false,
  underline: false,
  direction: 'horizontal',
  align: 'left',
  color: '#000000',
  lineHeight: 1.2,
  ...over
})

describe('textCssString 横排', () => {
  it('输出打印端关键声明且为单容器（无 inner）', () => {
    const { outer, inner } = textCssString(props())
    expect(inner).toBeUndefined()
    expect(outer).toContain('display:flex')
    expect(outer).toContain('align-items:safe center')
    expect(outer).toContain('height:100%')
    expect(outer).toContain(`font-size:10mm`)
    expect(outer).toContain('line-height:1.2')
    expect(outer).toContain('text-align:left')
    expect(outer).toContain('white-space:pre-wrap')
    expect(outer).toContain('word-break:break-word')
    expect(outer).toContain('overflow:hidden')
  })

  it('加粗/斜体/下划线声明齐全；无下划线时不输出 decoration', () => {
    const on = textCssString(props({ bold: true, italic: true, underline: true })).outer
    expect(on).toContain('font-weight:bold')
    expect(on).toContain('font-style:italic')
    expect(on).toContain('text-decoration:underline')
    expect(on).toContain('text-decoration-thickness:0.2mm')
    const off = textCssString(props()).outer
    expect(off).not.toContain('text-decoration')
  })

  it('系统字体栈内联；自定义字体名仅用单引号', () => {
    expect(textCssString(props()).outer).toContain(SYSTEM_FONT_STACK)
    const custom = textCssString(props({ fontFamily: 'My Font' })).outer
    expect(custom).toContain("'My Font'")
    expect(custom).toContain(SYSTEM_FONT_STACK)
    expect(custom).not.toContain('"My Font"')
  })

  it('字体名中的单引号被转义，不会破坏声明', () => {
    const css = toCssString(fontCssProps({ fontFamily: "a'b", fontSizeMm: 5, bold: false, italic: false }))
    expect(css).toContain("'a\\'b'")
  })
})

describe('textCssString 竖排', () => {
  it('返回 outer+inner 双容器：row-reverse 对齐 + vertical-rl 竖排', () => {
    const { outer, inner } = textCssString(props({ direction: 'vertical', align: 'left' }))
    expect(outer).toContain('display:flex')
    expect(outer).toContain('flex-direction:row-reverse')
    expect(outer).toContain('justify-content:flex-start')
    expect(inner).toContain('writing-mode:vertical-rl')
    expect(inner).toContain('text-orientation:upright')
    expect(inner).toContain('height:100%')
    expect(inner).toContain('font-size:10mm')
  })

  it('align 映射 justify-content', () => {
    expect(textCssString(props({ direction: 'vertical', align: 'right' })).outer)
      .toContain('justify-content:flex-end')
    expect(textCssString(props({ direction: 'vertical', align: 'center' })).outer)
      .toContain('justify-content:center')
  })
})
