export interface GuideRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface SnapResult {
  x: number
  y: number
  /** 竖向辅助线的 x 坐标（mm） */
  guidesV: number[]
  /** 横向辅助线的 y 坐标（mm） */
  guidesH: number[]
}

interface GridOpt {
  enabled: boolean
  sizeMm: number
}

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * 计算拖动后位置的吸附结果。
 * 候选线：拖动框（左/中/右、上/中/下）与纸张、其他元素对应线对齐。
 * @param thresholdMm 吸附阈值（mm）；网格吸附不受阈值限制
 */
// 拖动中的矩形无需 id（仅几何参与计算）
export type MovingRect = Omit<GuideRect, 'id'>

export function snapPosition(
  moving: MovingRect,
  paper: GuideRect,
  others: GuideRect[],
  thresholdMm: number,
  grid: GridOpt = { enabled: false, sizeMm: 10 }
): SnapResult {
  let { x, y } = moving
  const guidesV: number[] = []
  const guidesH: number[] = []

  type R = MovingRect
  const vTargets = [
    { m: (r: R) => r.x, line: (r: R) => r.x },
    { m: (r: R) => r.x + r.w / 2, line: (r: R) => r.x + r.w / 2 },
    { m: (r: R) => r.x + r.w, line: (r: R) => r.x + r.w }
  ]
  const hTargets = [
    { m: (r: R) => r.y, line: (r: R) => r.y },
    { m: (r: R) => r.y + r.h / 2, line: (r: R) => r.y + r.h / 2 },
    { m: (r: R) => r.y + r.h, line: (r: R) => r.y + r.h }
  ]

  const candidates = [paper, ...others]

  const trySnap = (
    targets: typeof vTargets,
    posKey: 'x' | 'y',
    guides: number[]
  ): void => {
    for (const t of targets) {
      const movingMark = t.m(moving)
      let best: { delta: number; line: number } | null = null
      for (const c of candidates) {
        const line = t.line(c)
        const delta = line - movingMark
        if (Math.abs(delta) <= thresholdMm && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, line }
        }
      }
      if (best) {
        if (posKey === 'x') x = round(moving.x + best.delta)
        else y = round(moving.y + best.delta)
        if (!guides.includes(best.line)) guides.push(round(best.line))
        return // 每个轴取一条最强对齐即可
      }
    }
  }

  if (thresholdMm > 0) {
    trySnap(vTargets, 'x', guidesV)
    trySnap(hTargets, 'y', guidesH)
  }

  if (grid.enabled) {
    x = Math.round(x / grid.sizeMm) * grid.sizeMm
    y = Math.round(y / grid.sizeMm) * grid.sizeMm
  }

  return { x: round(x), y: round(y), guidesV, guidesH }
}
