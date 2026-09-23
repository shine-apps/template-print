import { describe, it, expect } from 'vitest'
import { snapPosition, type GuideRect } from '../../src/renderer/designer/guides'

const paper: GuideRect = { id: '__paper__', x: 0, y: 0, w: 200, h: 280 }
const others: GuideRect[] = [
  { id: 'a', x: 50, y: 50, w: 40, h: 10 },
  { id: 'b', x: 10, y: 100, w: 80, h: 20 }
]

describe('snapPosition', () => {
  it('左边对齐其他元素左边（阈值内）', () => {
    const r = snapPosition({ x: 48.5, y: 80, w: 30, h: 8 }, paper, others, 3)
    expect(r.x).toBe(50)
    expect(r.guidesV.some((g) => g === 50)).toBe(true)
  })
  it('中心垂直对齐', () => {
    // a 的中心 x=70；拖动框中心 70 → x=54(w=32)
    const r = snapPosition({ x: 54, y: 200, w: 32, h: 8 }, paper, others, 3)
    expect(Math.abs((r.x + 16) - 70)).toBeLessThanOrEqual(3)
  })
  it('顶边对齐纸张顶边 0', () => {
    const r = snapPosition({ x: 30, y: 1.2, w: 20, h: 8 }, paper, others, 3)
    expect(r.y).toBe(0)
  })
  it('超阈值不吸附', () => {
    const r = snapPosition({ x: 40, y: 80, w: 30, h: 8 }, paper, others, 3)
    expect(r.x).toBe(40)
    expect(r.guidesV.length + r.guidesH.length).toBe(0)
  })
  it('网格吸附：开启时落到 10 的倍数', () => {
    const r = snapPosition({ x: 33, y: 47, w: 8, h: 8 }, paper, [], 0, { enabled: true, sizeMm: 10 })
    expect(r.x % 10).toBe(0)
    expect(r.y % 10).toBe(0)
  })
})
