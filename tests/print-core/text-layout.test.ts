import { describe, it, expect } from 'vitest'
import { layoutText, SYSTEM_FONT_STACK, type Measurer, type TextStyle } from '../../print-core/text-layout'

// 假测量：全角（CJK/全角标点/全角空格）= 字号见方；其余半角 = 字号 0.5 宽
const m: Measurer = {
  measureChar(ch, fs) {
    const wide = /[　-〿㐀-䶿一-鿿＀-￯]/.test(ch)
    return { w: wide ? fs : fs * 0.5, h: fs }
  }
}
const style = (over: Partial<TextStyle> = {}): TextStyle => ({
  fontFamily: '', fontSizeMm: 10, bold: false, italic: false, underline: false,
  align: 'left', color: '#000000', lineHeight: 1.2, direction: 'horizontal', ...over
})

describe('横排', () => {
  it('CJK 逐字换行；行高=字号×lineHeight；左对齐', () => {
    const r = layoutText('一二三四五六', 30, 100, style(), m) // 每字 10mm，框宽 30 → 每行 3 字
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].chars.map((c) => c.ch).join('')).toBe('一二三')
    expect(r.lines[0].chars[0].x).toBe(0)
    expect(r.lines[1].chars[0].y).toBe(12) // 10*1.2
  })
  it('ASCII 单词尽量整词移动，超框强制断字', () => {
    const word = layoutText('ab cd', 100, 100, style(), m) // 单词 10mm
    expect(word.lines).toHaveLength(1)
    const force = layoutText('abcdefghij', 15, 100, style(), m) // 词宽 50 > 框 15
    expect(force.lines.length).toBeGreaterThan(1)
  })
  it('\\n 强制换行', () => {
    const r = layoutText('a\nb', 100, 100, style(), m)
    expect(r.lines.map((l) => l.chars.map((c) => c.ch).join(''))).toEqual(['a', 'b'])
  })
  it('对齐：center/right 行起点偏移', () => {
    const left = layoutText('一', 30, 100, style({ align: undefined }), m)
    const center = layoutText('一', 30, 100, style({ align: 'center' as never }), m)
    const right = layoutText('一', 30, 100, style({ align: 'right' as never }), m)
    expect(left.lines[0].chars[0].x).toBe(0)
    expect(center.lines[0].chars[0].x).toBe(10) // (30-10)/2
    expect(right.lines[0].chars[0].x).toBe(20)
  })
  it('下划线为水平线段（y 在字身下部）', () => {
    const r = layoutText('一', 30, 100, style({ underline: true }), m)
    expect(r.lines[0].underlines.length).toBe(1)
    const u = r.lines[0].underlines[0]
    expect(u.w).toBe(10)
    expect(u.h).toBeLessThan(1)
  })
})

describe('竖排', () => {
  const v = (over: Partial<TextStyle> = {}) => style({ direction: 'vertical', ...over })
  it('首列贴右、满列向左换列；汉字正立', () => {
    const r = layoutText('一二三四', 100, 25, v(), m) // 列容量 2 字（25/10 取整）
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].chars.map((c) => c.ch).join('')).toBe('一二')
    expect(r.lines[1].chars.map((c) => c.ch).join('')).toBe('三四')
    expect(r.lines[0].chars[0].x).toBe(90) // 首列左边 = 框宽 100 - 列宽 10
    expect(r.lines[1].chars[0].x).toBe(78) // 列距 12
    expect(r.lines[0].chars[0].rotated).toBe(false)
  })
  it('ASCII 字符 rotated=true；字位仍按方格', () => {
    const r = layoutText('A一', 100, 25, v(), m)
    expect(r.lines[0].chars[0].rotated).toBe(true)
    expect(r.lines[0].chars[1].rotated).toBe(false)
  })
  it('align 映射：right 贴左、center 居中', () => {
    const left = layoutText('一', 100, 25, v({ align: 'left' as never }), m)  // left=贴右
    const right = layoutText('一', 100, 25, v({ align: 'right' as never }), m) // right=贴左
    const center = layoutText('一', 100, 25, v({ align: 'center' as never }), m)
    expect(left.lines[0].chars[0].x).toBe(90)
    expect(right.lines[0].chars[0].x).toBe(0)
    expect(center.lines[0].chars[0].x).toBe(45) // (100-10)/2
  })
  it('下划线为竖直线段', () => {
    const r = layoutText('一', 100, 25, v({ underline: true }), m)
    const u = r.lines[0].underlines[0]
    expect(u.h).toBe(10)
    expect(u.w).toBeLessThan(1)
  })
})

it('SYSTEM_FONT_STACK 导出', () => expect(SYSTEM_FONT_STACK).toContain('Microsoft YaHei'))
