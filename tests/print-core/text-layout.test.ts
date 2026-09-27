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
  align: 'left', color: '#000000', lineHeight: 1.2, direction: 'horizontal',
  columnDirection: 'rtl', ...over
})

describe('横排', () => {
  it('CJK 逐字换行；行高=字号×lineHeight；左对齐', () => {
    const r = layoutText('一二三四五六', 30, 100, style(), m) // 每字 10mm，框宽 30 → 每行 3 字
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].chars.map((c) => c.ch).join('')).toBe('一二三')
    expect(r.lines[0].chars[0].x).toBe(0)
    // 内容高 2*12=24，框高 100，居中偏移 (100-24)/2=38；半行距 (12-10)/2=1；
    // 第二行 y=38+1+12=51（半行距补偿对齐 CSS 行盒）
    expect(r.lines[1].chars[0].y).toBe(51)
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

describe('DOM 像素补偿通道（measureHorizontal）', () => {
  function makeProbe(result: ReturnType<NonNullable<Measurer['measureHorizontal']>>): Measurer {
    return { measureChar: m.measureChar, measureHorizontal: () => result }
  }

  it('采用探针实测的逐字 x 与基线 y，行标记 alphabetic 基线', () => {
    const pm = makeProbe([
      { x: 5, top: 7, widthMm: 20, baselineY: 15.5, chars: [
        { ch: '甲', x: 5 }, { ch: '乙', x: 15 }
      ] }
    ])
    const r = layoutText('甲乙', 30, 100, style(), pm)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].baseline).toBe('alphabetic')
    expect(r.lines[0].chars).toEqual([
      { ch: '甲', x: 5, y: 15.5, rotated: false },
      { ch: '乙', x: 15, y: 15.5, rotated: false }
    ])
    expect(r.widthMm).toBe(30)
  })

  it('下划线按探针实测的行几何生成（x/宽取实测，y=行顶+0.9 字号）', () => {
    const pm = makeProbe([
      { x: 5, top: 7, widthMm: 20, baselineY: 15.5, chars: [
        { ch: '甲', x: 5 }, { ch: '乙', x: 15 }
      ] }
    ])
    const r = layoutText('甲乙', 30, 100, style({ underline: true }), pm)
    const u = r.lines[0].underlines[0]
    expect(u.x).toBe(5)
    expect(u.w).toBe(20)
    expect(u.y).toBe(16) // top 7 + 10*0.9
    expect(u.h).toBeLessThan(1)
  })

  it('探针返回 null 时回退手工排版（含半行距补偿）', () => {
    const pm = makeProbe(null)
    const r = layoutText('一二三四五六', 30, 100, style(), pm)
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].baseline).toBeUndefined()
    expect(r.lines[1].chars[0].y).toBe(51)
  })

  it('探针返回空数组时同样回退手工排版', () => {
    const pm = makeProbe([])
    const r = layoutText('a', 100, 100, style(), pm)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].baseline).toBeUndefined()
  })

  it('竖排不调用横排探针', () => {
    let called = false
    const pm: Measurer = {
      measureChar: m.measureChar,
      measureHorizontal: () => { called = true; return null }
    }
    layoutText('一二', 100, 25, style({ direction: 'vertical' }), pm)
    expect(called).toBe(false)
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
  it('ASCII 字符竖排也正立（rotated=false），字位按方格排列', () => {
    const r = layoutText('A一', 100, 25, v(), m)
    expect(r.lines[0].chars[0].rotated).toBe(false)
    expect(r.lines[0].chars[1].rotated).toBe(false)
  })
  it('正立英数每字占 1em 字身格推进，超框高与打印端同样换列', () => {
    // 假测量 ASCII 墨迹宽 5mm，但竖排步进须按 10mm；3 字共 30mm > 框高 25mm → 换列
    const r = layoutText('AB一', 100, 25, v(), m)
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].chars.map((c) => c.ch).join('')).toBe('AB')
    expect(r.lines[1].chars.map((c) => c.ch).join('')).toBe('一')
  })
  it('正立英数字形在字身格内水平居中（汉字偏移≈0）', () => {
    const r = layoutText('A一', 100, 25, v(), m) // 首列 x=90；A 墨迹 5mm → 居中偏移 2.5
    expect(r.lines[0].chars[0].x).toBe(92.5)
    expect(r.lines[0].chars[1].x).toBe(90)
  })
  it('align 映射：right 贴左、center 居中', () => {
    const left = layoutText('一', 100, 25, v({ align: 'left' as never }), m)  // left=贴右
    const right = layoutText('一', 100, 25, v({ align: 'right' as never }), m) // right=贴左
    const center = layoutText('一', 100, 25, v({ align: 'center' as never }), m)
    expect(left.lines[0].chars[0].x).toBe(90)
    expect(right.lines[0].chars[0].x).toBe(0)
    expect(center.lines[0].chars[0].x).toBe(45) // (100-10)/2
  })
  it('列方向 ltr：首列在左、向右换列（align left=贴右语义不变）', () => {
    const r = layoutText('一二三四', 100, 25, v({ columnDirection: 'ltr' }), m) // 列容量 2 字
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].chars.map((c) => c.ch).join('')).toBe('一二')
    expect(r.lines[1].chars.map((c) => c.ch).join('')).toBe('三四')
    // 列组宽 = 2*10 + 1*(12-10) = 22；align left 贴右 → 首列左缘 100-22=78，次列 +12=90
    expect(r.lines[0].chars[0].x).toBe(78)
    expect(r.lines[1].chars[0].x).toBe(90)
  })
  it('列方向 ltr：align 语义与 rtl 一致（right 贴左、center 居中）', () => {
    const right = layoutText('一', 100, 25, v({ columnDirection: 'ltr', align: 'right' as never }), m)
    const center = layoutText('一', 100, 25, v({ columnDirection: 'ltr', align: 'center' as never }), m)
    expect(right.lines[0].chars[0].x).toBe(0)
    expect(center.lines[0].chars[0].x).toBe(45)
  })
  it('下划线为竖直线段', () => {
    const r = layoutText('一', 100, 25, v({ underline: true }), m)
    const u = r.lines[0].underlines[0]
    expect(u.h).toBe(10)
    expect(u.w).toBeLessThan(1)
  })
})

it('SYSTEM_FONT_STACK 导出', () => expect(SYSTEM_FONT_STACK).toContain('Microsoft YaHei'))
