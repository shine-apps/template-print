import { describe, it, expect } from 'vitest'
import { textCssProps, textCssString, toCssString, SYSTEM_FONT_STACK } from '../../print-core/text-style'

const p = (over: Partial<Parameters<typeof textCssProps>[0]> = {}) => ({
  fontFamily: '',
  fontSizeMm: 10,
  bold: false,
  italic: false,
  underline: false,
  direction: 'horizontal' as const,
  align: 'left' as const,
  color: '#000000',
  lineHeight: 1.2,
  ...over
})

describe('textCssProps 横排', () => {
  it('safe center 垂直居中、mm 字号、100% 高裁剪', () => {
    const { outer, inner } = textCssProps(p())
    expect(inner).toBeUndefined()
    expect(outer.alignItems).toBe('safe center')
    expect(outer.fontSize).toBe('10mm')
    expect(outer.height).toBe('100%')
    expect(outer.overflow).toBe('hidden')
    expect(outer.whiteSpace).toBe('pre-wrap')
  })
  it('加粗/斜体/下划线映射', () => {
    const { outer } = textCssProps(p({ bold: true, italic: true, underline: true }))
    expect(outer.fontWeight).toBe('bold')
    expect(outer.fontStyle).toBe('italic')
    expect(outer.textDecoration).toBe('underline')
    expect(outer.textDecorationThickness).toBe('0.2mm')
  })
  it('自定义字体族用单引号包裹并回退系统栈', () => {
    const { outer } = textCssProps(p({ fontFamily: '宋体' }))
    expect(outer.fontFamily).toBe(`'宋体', ${SYSTEM_FONT_STACK}`)
  })
})

describe('textCssProps 竖排', () => {
  it('返回 outer(row-reverse)+inner(writing-mode) 两层', () => {
    const { outer, inner } = textCssProps(p({ direction: 'vertical' }))
    expect(outer.flexDirection).toBe('row-reverse')
    expect(inner?.writingMode).toBe('vertical-rl')
    expect(inner?.textOrientation).toBe('mixed')
  })
  it('align 映射到 justifyContent（left=贴右=flex-start）', () => {
    expect(textCssProps(p({ direction: 'vertical', align: 'left' })).outer.justifyContent).toBe('flex-start')
    expect(textCssProps(p({ direction: 'vertical', align: 'right' })).outer.justifyContent).toBe('flex-end')
    expect(textCssProps(p({ direction: 'vertical', align: 'center' })).outer.justifyContent).toBe('center')
  })
})

describe('textCssString / toCssString', () => {
  it('对象序列化为 style 字符串，undefined 被过滤', () => {
    expect(toCssString({ a: '1', b: undefined, c: 0 })).toBe('a:1;c:0')
  })
  it('横排仅返回 outer 字符串', () => {
    const s = textCssString(p())
    expect(s.inner).toBeUndefined()
    expect(s.outer).toContain('align-items:safe center')
    expect(s.outer).toContain('font-size:10mm')
  })
  it('竖排返回两段字符串', () => {
    const s = textCssString(p({ direction: 'vertical' }))
    expect(s.outer).toContain('flex-direction:row-reverse')
    expect(s.inner).toContain('writing-mode:vertical-rl')
  })
})
