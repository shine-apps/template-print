export type Orientation = 'portrait' | 'landscape'

export interface MarginsMm {
  t: number
  r: number
  b: number
  l: number
}
export interface PaperDef {
  id: string
  name: string
  widthMm: number
  heightMm: number
}

export const PAPER_PRESETS: PaperDef[] = [
  { id: 'a4', name: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a3', name: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'receipt-58', name: '小票 58mm', widthMm: 58, heightMm: 297 },
  { id: 'receipt-80', name: '小票 80mm', widthMm: 80, heightMm: 297 },
  { id: 'label-40x30', name: '标签 40×30mm', widthMm: 40, heightMm: 30 },
  { id: 'label-60x40', name: '标签 60×40mm', widthMm: 60, heightMm: 40 },
  { id: 'card-54x86', name: '证卡 54×86mm', widthMm: 54, heightMm: 86 }
]

export function findPreset(id: string): PaperDef | undefined {
  return PAPER_PRESETS.find((p) => p.id === id)
}

/**
 * 驱动普遍内置的标准纸张（mm，横纵均可）。命中则静默直打不提示；
 * 其他任意尺寸（含 58/80mm 小票、标签自定义）首次静默直打给出纸张引导。
 */
export const STANDARD_DRIVER_SIZES: ReadonlyArray<{ w: number; h: number }> = [
  { w: 210, h: 297 }, // A4
  { w: 297, h: 420 }, // A3
  { w: 148, h: 210 }, // A5
  { w: 176, h: 250 }, // B5
  { w: 215.9, h: 279.4 } // Letter
]

export function isStandardDriverPaper(widthMm: number, heightMm: number): boolean {
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.6
  return STANDARD_DRIVER_SIZES.some(
    (s) => (eq(widthMm, s.w) && eq(heightMm, s.h)) || (eq(widthMm, s.h) && eq(heightMm, s.w))
  )
}

/** “打印机|宽x高”确认键（尺寸四舍五入到 mm） */
export function paperHintKey(printerName: string, widthMm: number, heightMm: number): string {
  return `${printerName}|${Math.round(widthMm)}x${Math.round(heightMm)}`
}
