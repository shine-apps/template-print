const MM_PER_INCH = 25.4
const PX_PER_INCH_96 = 96
const PT_PER_INCH = 72

export function mmToPxAt96(mm: number): number {
  return (mm / MM_PER_INCH) * PX_PER_INCH_96
}
export function pxToMmAt96(px: number): number {
  return (px / PX_PER_INCH_96) * MM_PER_INCH
}
export function mmToMicron(mm: number): number {
  return Math.round(mm * 1000)
}
export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH
}
export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH
}
