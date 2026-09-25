import { z } from 'zod'

/** 服务端静态更新清单 latest.json */
export const UpdateManifestSchema = z.object({
  version: z.string().min(1),
  releaseDate: z.string().default(''),
  releaseNotes: z.string().default(''),
  /** 相对 UPDATE_BASE_URL 的路径，或绝对 http(s) URL */
  url: z.string().min(1),
  /** 字节数；发布脚本总是生成，软校验用；旧清单可能没有 */
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/)
})
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>

/** 点分数字版本比较：a>b → 1，相等 → 0，a<b → -1；缺段补 0，非数字段按 0 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (s: string): number[] =>
    s.split('.').map((seg) => {
      const n = parseInt(seg, 10)
      return Number.isFinite(n) ? n : 0
    })
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/** 清单 url → 可下载绝对 URL（相对路径相对 base；绝对 http(s) 原样） */
export function resolveDownloadUrl(baseUrl: string, u: string): string {
  if (/^https?:\/\//i.test(u)) return u
  return baseUrl.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '')
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024 * 1024) return Math.max(0, Math.round(n / 1024)) + ' KB'
  if (n < 1024 ** 3) return (n / 1048576).toFixed(1) + ' MB'
  return (n / 1073741824).toFixed(2) + ' GB'
}

/** 安装状态文件 updates/install-state.json */
export interface InstallState {
  from: string
  to: string
  phase: 'installing' | 'done' | 'failed'
  reason: string | null
  ts: number
}

// ---------- 主→渲事件 payload ----------
export interface CheckResultPayload {
  hasUpdate: boolean
  /** 手动检查为 true：无更新/失败也要给用户反馈；自动检查静默 */
  manual: boolean
  manifest?: UpdateManifest
  /** 无更新/失败原因码：up-to-date | net-error | bad-manifest */
  reason?: string
}

export type UpdateProgressPayload =
  | { phase: 'downloading'; downloaded: number; total: number | null; bytesPerMs: number }
  | { phase: 'verifying' }
  | { phase: 'ready'; version: string }
  | { phase: 'simulated'; version: string }
  | { phase: 'error'; reason: string }
  | { phase: 'canceled' }

export interface InstallFailedPayload {
  from: string
  to: string
  reason: string
}
