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
