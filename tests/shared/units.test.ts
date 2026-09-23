import { describe, it, expect } from 'vitest'
import { mmToPxAt96, pxToMmAt96, mmToMicron, ptToMm, mmToPt } from '../../shared/units'

describe('单位换算', () => {
  it('mm↔px 按 96dpi（1mm = 96/25.4 px）', () => {
    expect(mmToPxAt96(25.4)).toBeCloseTo(96, 6)
    expect(pxToMmAt96(96)).toBeCloseTo(25.4, 6)
  })
  it('mm → 微米', () => {
    expect(mmToMicron(40)).toBe(40000)
  })
  it('pt 与 mm 互转（1pt = 25.4/72 mm）', () => {
    expect(ptToMm(72)).toBeCloseTo(25.4, 6)
    expect(mmToPt(25.4)).toBeCloseTo(72, 6)
  })
})
