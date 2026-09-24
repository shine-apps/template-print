import { describe, it, expect } from 'vitest'
import { isStandardDriverPaper, paperHintKey } from '../../shared/paper-presets'

describe('isStandardDriverPaper', () => {
  it('A4 纵向/横向均为标准纸', () => {
    expect(isStandardDriverPaper(210, 297)).toBe(true)
    expect(isStandardDriverPaper(297, 210)).toBe(true)
  })
  it('小票/标签尺寸不是标准纸', () => {
    expect(isStandardDriverPaper(80, 200)).toBe(false)
    expect(isStandardDriverPaper(40, 30)).toBe(false)
    expect(isStandardDriverPaper(58, 297)).toBe(false)
  })
  it('确认键按毫米取整', () => {
    expect(paperHintKey('HP', 40.2, 30.7)).toBe('HP|40x31')
  })
})
