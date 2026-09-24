import type { FontListDto } from '../../shared/ipc-contract'

let cache: FontListDto | null = null
let inflight: Promise<FontListDto> | null = null

/** 字体列表全应用只读一次（含并发合并） */
export function getFonts(): Promise<FontListDto> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = window.api.fonts
      .list()
      .then((dto) => {
        cache = dto
        return dto
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}
