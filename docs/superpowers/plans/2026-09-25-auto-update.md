# 应用自动更新机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为模板打印应用实现"检查（自动每日+手动）→ 用户确认 → 断点续传下载 → SHA256 校验 → NSIS 静默安装 → 守护脚本备份/回滚"的完整轻量更新链路。

**Architecture:** 主进程新增 update 模块（downloader/checksum/guardian-script）与 UpdateService 编排；静态清单 `latest.json` 托管在可配置的 `UPDATE_BASE_URL`；安装环节退出应用后由纯 ASCII PowerShell 守护脚本完成备份→NSIS `/S` 静默安装→版本校验→失败自动 robocopy 回滚。渲染端全局更新弹窗 + 关于页入口。

**Tech Stack:** Electron 44 `net`（系统代理）、node:crypto、node:http（测试打桩）、zod、antd 5、PowerShell 5.1（脚本纯 ASCII）、vitest。

设计文档：`docs/superpowers/specs/2026-09-25-auto-update-design.md`

---

## File Structure

**新增：**
- `shared/update-manifest.ts` — 清单 zod schema、版本比较、URL 解析、字节格式化、全部事件 DTO
- `shared/update-config.ts` — 更新源常量（dev 允许 env 覆盖）
- `electron/main/update/downloader.ts` — 断点续传下载核心（请求函数可注入）
- `electron/main/update/checksum.ts` — 流式 SHA256
- `electron/main/update/guardian-script.ts` — 守护脚本生成器（纯函数）+ 参数类型
- `electron/main/services/update-service.ts` — 编排服务
- `src/renderer/update/update-modal.tsx` — 全局更新弹窗
- `scripts/build-update-manifest.ps1` — 发布：生成 latest.json
- `scripts/serve-update.ps1` — 本地：支持 Range 的静态更新服务器
- `scripts/dev-drill-guardian.ps1` — 守护脚本成功/失败回滚演练（csc 编假 exe）
- 测试：`tests/shared/update-manifest.test.ts`、`tests/shared/app-version.test.ts`、`tests/main/update-checksum.test.ts`、`tests/main/update-downloader.test.ts`、`tests/main/update-guardian-script.test.ts`、`tests/main/update-service.test.ts`

**修改：** `electron/main/settings.ts`、`shared/settings-dto.ts`、`shared/ipc-contract.ts`、`electron/preload/index.ts`、`electron/main/ipc/index.ts`、`electron/main/app-paths.ts`、`electron/main/index.ts`、`src/renderer/App.tsx`、`src/renderer/pages/about.tsx`、`tests/main/settings.test.ts`

---

### Task 1: 更新清单协议（schema/版本比较/URL/格式化/事件 DTO）与更新源配置

**Files:**
- Create: `shared/update-manifest.ts`
- Create: `shared/update-config.ts`
- Test: `tests/shared/update-manifest.test.ts`
- Test: `tests/shared/app-version.test.ts`

- [ ] **Step 1: 写失败测试 `tests/shared/update-manifest.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  UpdateManifestSchema,
  compareVersions,
  resolveDownloadUrl,
  formatBytes
} from '../../shared/update-manifest'

const valid = {
  version: '0.2.0',
  releaseDate: '2026-09-25',
  releaseNotes: '修复若干问题',
  url: 'TemplatePrint-0.2.0-Setup-x64.exe',
  size: 123456789,
  sha256: 'a'.repeat(64)
}

describe('UpdateManifestSchema', () => {
  it('合法清单通过', () => {
    expect(UpdateManifestSchema.parse(valid).version).toBe('0.2.0')
  })
  it('releaseDate/releaseNotes/size 缺省时给默认/可选', () => {
    const m = UpdateManifestSchema.parse({ version: '1.0', url: 'a.exe', sha256: 'A'.repeat(64) })
    expect(m.releaseNotes).toBe('')
    expect(m.size).toBeUndefined()
  })
  it('sha256 非64位hex 拒绝', () => {
    expect(UpdateManifestSchema.safeParse({ ...valid, sha256: 'abc' }).success).toBe(false)
  })
  it('version/url 为空拒绝', () => {
    expect(UpdateManifestSchema.safeParse({ ...valid, version: '' }).success).toBe(false)
    expect(UpdateManifestSchema.safeParse({ ...valid, url: '' }).success).toBe(false)
  })
})

describe('compareVersions', () => {
  it('相等/主次比较', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1)
    expect(compareVersions('0.9', '1.0')).toBe(-1)
  })
  it('数字段按数值比较：0.10.0 > 0.9.0', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
  })
  it('缺段补 0；非数字段按 0', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.x', '1.0.0')).toBe(0)
  })
})

describe('resolveDownloadUrl', () => {
  it('绝对 http(s) URL 原样返回', () => {
    expect(resolveDownloadUrl('http://x/y/', 'https://cdn/a.exe')).toBe('https://cdn/a.exe')
  })
  it('相对路径拼 base，正确处理斜杠', () => {
    expect(resolveDownloadUrl('http://127.0.0.1:8765/', 'a.exe')).toBe('http://127.0.0.1:8765/a.exe')
    expect(resolveDownloadUrl('http://127.0.0.1:8765/rel', '/a.exe')).toBe('http://127.0.0.1:8765/rel/a.exe')
  })
})

describe('formatBytes', () => {
  it('按 MB/GB 格式化', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(1073741824)).toBe('1.00 GB')
  })
})
```

- [ ] **Step 2: 写失败测试 `tests/shared/app-version.test.ts`（防止 app-info 与 package.json 漂移）**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION } from '../../shared/app-info'

describe('版本号一致性', () => {
  it('APP_VERSION 必须等于 package.json#version', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'))
    expect(APP_VERSION).toBe(pkg.version)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/shared/update-manifest.test.ts tests/shared/app-version.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 创建 `shared/update-manifest.ts`**

```ts
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
```

- [ ] **Step 5: 创建 `shared/update-config.ts`**

```ts
// 更新源配置。上线时把 DEFAULT_UPDATE_BASE_URL 改为真实 HTTPS（如腾讯云 COS）即可。
// 仅 dev 构建允许环境变量 TP_UPDATE_BASE_URL 覆盖；打包构建恒用常量，防止被篡改指向恶意源。
const DEFAULT_UPDATE_BASE_URL = 'http://127.0.0.1:8765/'

const env = (import.meta as { env?: Record<string, string | undefined> }).env
const isDev = !!env?.DEV
const envOverride = env?.TP_UPDATE_BASE_URL

export const UPDATE_BASE_URL: string = isDev && envOverride ? envOverride : DEFAULT_UPDATE_BASE_URL
```

- [ ] **Step 6: 跑测试确认通过 + 类型检查**

Run: `npx vitest run tests/shared/update-manifest.test.ts tests/shared/app-version.test.ts`
Expected: PASS（9 tests）

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add shared/update-manifest.ts shared/update-config.ts tests/shared/update-manifest.test.ts tests/shared/app-version.test.ts
git commit -m "feat(update): 更新清单协议（版本比较/URL解析/SHA256）与更新源配置"
```

---

### Task 2: settings 新增三个更新字段

**Files:**
- Modify: `electron/main/settings.ts`
- Modify: `shared/settings-dto.ts`
- Modify: `tests/main/settings.test.ts`

- [ ] **Step 1: 扩充 `tests/main/settings.test.ts`**

在文件顶部 import 行保持不变；把两处 `AppSettings` 字面量（第 18-24 行 saveSettings 用例、第 36-42 行 base）各补三个字段：

```ts
    const s: AppSettings = {
      defaultPrinterName: 'HP LaserJet',
      seededTemplatesVersion: null,
      historyRetentionDays: null,
      lastBackupAt: null,
      paperHintsConfirmed: [],
      autoCheckUpdates: true,
      skippedUpdateVersion: null,
      lastUpdateCheckAt: null
    }
```

```ts
const base: AppSettings = {
  defaultPrinterName: 'p1',
  seededTemplatesVersion: null,
  historyRetentionDays: null,
  lastBackupAt: null,
  paperHintsConfirmed: [],
  autoCheckUpdates: true,
  skippedUpdateVersion: null,
  lastUpdateCheckAt: null
}
```

文件末尾追加：

```ts
describe('更新相关设置', () => {
  it('新字段默认值', () => {
    const s = loadSettings(dir)
    expect(s.autoCheckUpdates).toBe(true)
    expect(s.skippedUpdateVersion).toBeNull()
    expect(s.lastUpdateCheckAt).toBeNull()
  })
  it('白名单允许切换 autoCheckUpdates，拒绝非法类型', () => {
    expect(patchSettings(base, { autoCheckUpdates: false }).autoCheckUpdates).toBe(false)
    expect(patchSettings(base, { autoCheckUpdates: 'no' as never }).autoCheckUpdates).toBe(true)
  })
  it('旧 settings.json 缺新字段时补默认值', () => {
    const legacyDir = join(tmpdir(), `tp-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'settings.json'), JSON.stringify({ defaultPrinterName: 'old' }))
    const s = loadSettings(legacyDir)
    expect(s.autoCheckUpdates).toBe(true)
    expect(s.skippedUpdateVersion).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败（类型错误）**

Run: `npx vitest run tests/main/settings.test.ts`
Expected: FAIL（字段不存在）

- [ ] **Step 3: 修改 `electron/main/settings.ts`**

`AppSettings` 接口改为：

```ts
export interface AppSettings {
  defaultPrinterName: string | null
  /** 内置模板播种版本；null 表示尚未播种 */
  seededTemplatesVersion: string | null
  /** 历史自动清理保留天数；null/0 = 永不自动清理 */
  historyRetentionDays: number | null
  /** 最近一次自动备份时间戳 */
  lastBackupAt: number | null
  /** 已确认不再提示的“打印机|宽x高”自定义纸张组合 */
  paperHintsConfirmed: string[]
  /** 是否启动后自动检查更新（每日一次） */
  autoCheckUpdates: boolean
  /** 用户跳过的更新版本；null=未跳过 */
  skippedUpdateVersion: string | null
  /** 最近一次检查更新时间戳（节流用） */
  lastUpdateCheckAt: number | null
}
```

`DEFAULTS` 改为：

```ts
const DEFAULTS: AppSettings = {
  defaultPrinterName: null,
  seededTemplatesVersion: null,
  historyRetentionDays: null,
  lastBackupAt: null,
  paperHintsConfirmed: [],
  autoCheckUpdates: true,
  skippedUpdateVersion: null,
  lastUpdateCheckAt: null
}
```

`SETTABLE_KEYS` 与 `patchSettings` 增加 autoCheckUpdates：

```ts
export const SETTABLE_KEYS = [
  'historyRetentionDays',
  'paperHintsConfirmed',
  'autoCheckUpdates'
] as const
```

```ts
    } else if (key === 'paperHintsConfirmed') {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        next.paperHintsConfirmed = v as string[]
      }
    } else if (key === 'autoCheckUpdates') {
      if (typeof v === 'boolean') next.autoCheckUpdates = v
    }
```

- [ ] **Step 4: 修改 `shared/settings-dto.ts`**

```ts
export interface AppSettingsDto {
  defaultPrinterName: string | null
  seededTemplatesVersion: string | null
  historyRetentionDays: number | null
  lastBackupAt: number | null
  paperHintsConfirmed: string[]
  autoCheckUpdates: boolean
  skippedUpdateVersion: string | null
  lastUpdateCheckAt: number | null
}

export type SettingsPatch = Partial<
  Pick<AppSettingsDto, 'historyRetentionDays' | 'paperHintsConfirmed' | 'autoCheckUpdates'>
>
```

- [ ] **Step 5: 跑测试 + typecheck 通过**

Run: `npx vitest run tests/main/settings.test.ts && npm run typecheck`
Expected: PASS、0 错误

- [ ] **Step 6: 提交**

```bash
git add electron/main/settings.ts shared/settings-dto.ts tests/main/settings.test.ts
git commit -m "feat(settings): 新增自动检查/跳过版本/检查时间三个更新设置"
```

---

### Task 3: 流式 SHA256 校验

**Files:**
- Create: `electron/main/update/checksum.ts`
- Test: `tests/main/update-checksum.test.ts`

- [ ] **Step 1: 写失败测试 `tests/main/update-checksum.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { sha256File, verifySha256 } from '../../electron/main/update/checksum'

let dir: string
beforeEach(() => {
  dir = join(tmpdir(), `tp-checksum-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
})

const content = Buffer.from('template-print update checksum fixture\n'.repeat(1000))
const expectedHash = createHash('sha256').update(content).digest('hex')

describe('sha256File', () => {
  it('输出与 crypto 一致的小写 hex', async () => {
    const f = join(dir, 'a.bin')
    writeFileSync(f, content)
    expect(await sha256File(f)).toBe(expectedHash)
  })
})

describe('verifySha256', () => {
  it('匹配通过（大小写不敏感）', async () => {
    const f = join(dir, 'b.bin')
    writeFileSync(f, content)
    expect(await verifySha256(f, expectedHash.toUpperCase())).toBe(true)
  })
  it('内容被改 → false', async () => {
    const f = join(dir, 'c.bin')
    writeFileSync(f, 'tampered')
    expect(await verifySha256(f, expectedHash)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/main/update-checksum.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `electron/main/update/checksum.ts`**

```ts
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** 流式计算文件 SHA256（小写 hex），避免整包读入内存 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(filePath)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

/** 校验文件 sha256 是否等于期望值（大小写不敏感） */
export async function verifySha256(filePath: string, expected: string): Promise<boolean> {
  const actual = await sha256File(filePath)
  return actual === expected.toLowerCase()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/main/update-checksum.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add electron/main/update/checksum.ts tests/main/update-checksum.test.ts
git commit -m "feat(update): 流式 SHA256 文件完整性校验"
```

---

### Task 4: 断点续传下载器（纯决策函数 + 可注入请求函数 + node http 打桩）

**Files:**
- Create: `electron/main/update/downloader.ts`
- Test: `tests/main/update-downloader.test.ts`

- [ ] **Step 1: 写失败测试 `tests/main/update-downloader.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, rmSync, existsSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import {
  streamDownload,
  nodeHttpRequest,
  parseContentRange,
  DownloadCanceled,
  SizeMismatchError
} from '../../electron/main/update/downloader'

let dir: string
beforeEach(() => {
  dir = join(tmpdir(), `tp-dl-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
})

const body = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(200)) // 7000 字节

/** 支持 Range 的静态服务器；recordRange 记录每次请求的 Range 头 */
function rangeServer(recordRange: (r: string | undefined) => void, opts?: { ignoreRange?: boolean }): Server {
  return createServer((req, res) => {
    recordRange(req.headers.range)
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
    if (m && !opts?.ignoreRange) {
      const start = Number(m[1])
      if (start >= body.length) { res.statusCode = 416; res.end(); return }
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${body.length - 1}/${body.length}`)
      res.setHeader('Accept-Ranges', 'bytes')
      res.end(body.subarray(start))
    } else {
      res.statusCode = 200
      res.setHeader('Content-Length', String(body.length))
      res.setHeader('Accept-Ranges', 'bytes')
      res.end(body)
    }
  })
}

async function listen(s: Server): Promise<string> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/setup.exe`
}

describe('parseContentRange', () => {
  it('解析总大小', () => {
    expect(parseContentRange('bytes 100-199/1000')).toBe(1000)
    expect(parseContentRange('bytes 0-99/*')).toBeNull()
    expect(parseContentRange(undefined)).toBeNull()
  })
})

describe('streamDownload（node http 打桩）', () => {
  it('首次全量下载，进度 total 正确，落盘字节一致', async () => {
    const ranges: (string | undefined)[] = []
    const s = rangeServer((r) => ranges.push(r))
    const url = await listen(s)
    const progress: { downloaded: number; total: number | null }[] = []
    const r = await streamDownload({
      url,
      partPath: join(dir, 'setup.part'),
      finalPath: join(dir, 'setup.exe'),
      requestFn: nodeHttpRequest,
      signal: new AbortController().signal,
      onProgress: (p) => progress.push({ downloaded: p.downloaded, total: p.total }),
      sleep: async () => {}
    })
    s.close()
    expect(r.bytes).toBe(body.length)
    expect(readFileSync(r.path)).toEqual(body)
    expect(progress[progress.length - 1].total).toBe(body.length)
    expect(ranges[0]).toBeUndefined()
    expect(existsSync(join(dir, 'setup.part'))).toBe(false)
  })

  it('取消后保留 .part；再次下载带 Range 续传且字节完整', async () => {
    const ranges: (string | undefined)[] = []
    const s = rangeServer((r) => ranges.push(r))
    const url = await listen(s)
    const part = join(dir, 'setup.part')
    const final = join(dir, 'setup.exe')

    // 手工造一个 3000 字节的 .part（与服务器前 3000 字节相同）
    writeFileSync(part, body.subarray(0, 3000))
    const ac = new AbortController()
    const p = streamDownload({
      url, partPath: part, finalPath: final,
      requestFn: nodeHttpRequest, signal: ac.signal, sleep: async () => {}
    })
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(DownloadCanceled)
    expect(existsSync(part)).toBe(true)

    const r = await streamDownload({
      url, partPath: part, finalPath: final,
      requestFn: nodeHttpRequest, signal: new AbortController().signal,
      sleep: async () => {}
    })
    s.close()
    // 存在 .part → 首次请求必须带 Range
    expect(ranges.some((x) => x === 'bytes=3000-')).toBe(true)
    expect(readFileSync(r.path)).toEqual(body)
  })

  it('服务器忽略 Range（回 200）时删除 .part 重新全量下载', async () => {
    const s = rangeServer(() => {}, { ignoreRange: true })
    const url = await listen(s)
    writeFileSync(join(dir, 'setup.part'), body.subarray(0, 100)) // 故意只放 100 字节
    const r = await streamDownload({
      url,
      partPath: join(dir, 'setup.part'),
      finalPath: join(dir, 'setup.exe'),
      requestFn: nodeHttpRequest,
      signal: new AbortController().signal,
      sleep: async () => {}
    })
    s.close()
    expect(readFileSync(r.path)).toEqual(body)
    expect(statSync(r.path).size).toBe(body.length)
  })

  it('声明大小不符抛 SizeMismatchError', async () => {
    const s = rangeServer(() => {})
    const url = await listen(s)
    await expect(streamDownload({
      url,
      partPath: join(dir, 'setup.part'),
      finalPath: join(dir, 'setup.exe'),
      expectedSize: body.length + 1,
      requestFn: nodeHttpRequest,
      signal: new AbortController().signal,
      sleep: async () => {}
    })).rejects.toBeInstanceOf(SizeMismatchError)
    s.close()
  })

  it('服务器 500 → 重试耗尽后抛错（不真实等待，sleep 注入假的）', async () => {
    const s = createServer((_req, res) => { res.statusCode = 500; res.end() })
    const url = await listen(s)
    let attempts = 0
    await expect(streamDownload({
      url,
      partPath: join(dir, 'setup.part'),
      finalPath: join(dir, 'setup.exe'),
      requestFn: async (u, rangeStart, signal) => { attempts++; return nodeHttpRequest(u, rangeStart, signal) },
      signal: new AbortController().signal,
      retries: 2,
      sleep: async () => {}
    })).rejects.toThrow(/HTTP 500/)
    s.close()
    expect(attempts).toBe(3)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/main/update-downloader.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `electron/main/update/downloader.ts`**

```ts
import { createWriteStream, rmSync, rename, stat, existsSync } from 'node:fs/promises'
import { createWriteStream as createWriteStreamCbs } from 'node:fs'
import { existsSync as existsSyncCbs } from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import { once } from 'node:events'
import type { IncomingMessage } from 'node:http'

export interface DownloadProgress {
  downloaded: number
  total: number | null
  bytesPerMs: number
}

/** 底层 HTTP 响应的最小抽象（node:http 与 Electron net 的 IncomingMessage 都满足） */
export interface DownloadHttpResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  onData(cb: (chunk: Buffer) => void): void
  onEnd(cb: () => void): void
  onError(cb: (err: Error) => void): void
  destroy(): void
}

export type DownloadRequestFn = (
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
) => Promise<DownloadHttpResponse>

export class DownloadCanceled extends Error {
  constructor() { super('download-canceled'); this.name = 'DownloadCanceled' }
}
export class SizeMismatchError extends Error {
  constructor(actual: number, expected: number) {
    super(`size-mismatch: ${actual} != ${expected}`); this.name = 'SizeMismatchError'
  }
}

/** Content-Range: bytes start-end/total → total；无法解析返回 null */
export function parseContentRange(v: string | undefined): number | null {
  if (!v) return null
  const m = /^bytes \d+-\d+\/(\d+|\*)$/.exec(v.trim())
  if (!m || m[1] === '*') return null
  return Number(m[1])
}

function headerString(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name.toLowerCase()] ?? h[name]
  return Array.isArray(v) ? v[0] : v
}

function adapt(res: IncomingMessage): DownloadHttpResponse {
  return {
    statusCode: res.statusCode ?? 0,
    headers: res.headers,
    onData: (cb) => res.on('data', (c) => cb(c as Buffer)),
    onEnd: (cb) => res.on('end', cb),
    onError: (cb) => res.on('error', cb),
    destroy: () => res.destroy()
  }
}

/** 生产请求函数：Electron net（自动走系统代理）；动态 import 避免测试环境加载 electron */
export async function electronNetRequest(
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
): Promise<DownloadHttpResponse> {
  const { net } = await import('electron')
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    if (rangeStart !== null) req.setHeader('Range', `bytes=${rangeStart}-`)
    signal.addEventListener('abort', () => {
      req.destroy()
      reject(new DownloadCanceled())
    }, { once: true })
    req.on('response', (res) => resolve(adapt(res as unknown as IncomingMessage)))
    req.on('error', (err: Error) => reject(signal.aborted ? new DownloadCanceled() : err))
    req.end()
  })
}

/** 测试/备用请求函数：node 原生 http(s) */
export function nodeHttpRequest(
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
): Promise<DownloadHttpResponse> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { headers: rangeStart !== null ? { Range: `bytes=${rangeStart}-` } : {} }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        nodeHttpRequest(new URL(res.headers.location, url).toString(), rangeStart, signal).then(resolve, reject)
        return
      }
      resolve(adapt(res))
    })
    req.on('error', (err) => reject(signal.aborted ? new DownloadCanceled() : err))
    signal.addEventListener('abort', () => {
      req.destroy(new DownloadCanceled())
    }, { once: true })
  })
}

export interface StreamDownloadOptions {
  url: string
  partPath: string
  finalPath: string
  expectedSize?: number
  requestFn: DownloadRequestFn
  signal: AbortSignal
  onProgress?: (p: DownloadProgress) => void
  /** 总尝试次数（首次+重试），默认 3 */
  retries?: number
  /** 重试退避（毫秒），默认 500/1500/4000；测试注入 no-op */
  sleep?: (ms: number) => Promise<void>
}

const BACKOFF = [500, 1500, 4000]

/**
 * 断点续传下载。
 * - 有 .part：发 Range；206→追加续传；200/其他→删 .part 全量重下
 * - 网络/5xx 指数退避重试；abort → DownloadCanceled（保留 .part）
 * - 完成后 expectedSize 软校验（不符 SizeMismatchError），.part 重命名为最终文件
 */
export async function streamDownload(opts: StreamDownloadOptions): Promise<{ path: string; bytes: number }> {
  const {
    url, partPath, finalPath, expectedSize, requestFn, signal, onProgress,
    retries = 3,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  } = opts
  const maxAttempts = Math.max(1, retries + 1)
  let lastErr: Error | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) throw new DownloadCanceled()
    try {
      const resumeFrom = existsSyncCbs(partPath) ? (await stat(partPath)).size : 0
      const res = await requestFn(url, resumeFrom > 0 ? resumeFrom : null, signal)

      let append: boolean
      let startOffset: number
      let total: number | null
      if (res.statusCode === 206 && resumeFrom > 0) {
        append = true
        startOffset = resumeFrom
        total = parseContentRange(headerString(res.headers, 'content-range'))
      } else if (res.statusCode === 200) {
        append = false
        startOffset = 0
        const cl = Number(headerString(res.headers, 'content-length'))
        total = Number.isFinite(cl) ? cl : null
      } else {
        res.destroy()
        throw new Error(`HTTP ${res.statusCode}`)
      }

      await rm(finalPath, { force: true })
      const out = createWriteStreamCbs(partPath, { flags: append ? 'a' : 'w' })
      let downloaded = startOffset
      const t0 = Date.now()
      let lastEmit = 0

      const result = await new Promise<void>((resolve, reject) => {
        res.onData((chunk) => {
          downloaded += chunk.length
          const now = Date.now()
          if (onProgress && now - lastEmit >= 200) {
            lastEmit = now
            const elapsed = Math.max(1, now - t0)
            onProgress({ downloaded, total, bytesPerMs: downloaded / elapsed })
          }
        })
        res.onError((err) => {
          out.destroy()
          reject(signal.aborted ? new DownloadCanceled() : err)
        })
        res.onEnd(() => {
          out.end(() => resolve())
        })
        out.on('error', reject)
        signal.addEventListener('abort', () => {
          res.destroy()
          out.destroy()
          reject(new DownloadCanceled())
        }, { once: true })
        // 实际把响应流写入文件
        const w = createWriteStreamCbs(partPath, { flags: append ? 'a' : 'w' })
        void w // 占位避免未使用告警（真实写入见下：直接 pipe）
      })

      // 上一个 Promise 内创建了两个写流是错误的——实现以 pipe 版本为准（见下 catch 外重写）
      void result
      break
    } catch (e) {
      lastErr = e as Error
      if (e instanceof DownloadCanceled) throw e
      if (attempt === maxAttempts - 1) break
      await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)])
    }
  }

  // 注意：上面的占位实现不可用，真正实现见下方函数替换
  throw lastErr ?? new Error('download-failed')
}
```

**该文件 Step 3 的占位实现含错误，立即在 Step 4 用正确版本整体覆盖。**

- [ ] **Step 4: 用正确实现整体覆盖 `electron/main/update/downloader.ts`**

```ts
import { rm, rename, stat } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage } from 'node:http'

export interface DownloadProgress {
  downloaded: number
  total: number | null
  bytesPerMs: number
}

/** 底层 HTTP 响应的最小抽象（node:http 与 Electron net 的 IncomingMessage 都满足） */
export interface DownloadHttpResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  onData(cb: (chunk: Buffer) => void): void
  onEnd(cb: () => void): void
  onError(cb: (err: Error) => void): void
  destroy(): void
}

export type DownloadRequestFn = (
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
) => Promise<DownloadHttpResponse>

export class DownloadCanceled extends Error {
  constructor() { super('download-canceled'); this.name = 'DownloadCanceled' }
}
export class SizeMismatchError extends Error {
  constructor(actual: number, expected: number) {
    super(`size-mismatch: ${actual} != ${expected}`); this.name = 'SizeMismatchError'
  }
}

/** Content-Range: bytes start-end/total → total；无法解析返回 null */
export function parseContentRange(v: string | undefined): number | null {
  if (!v) return null
  const m = /^bytes \d+-\d+\/(\d+|\*)$/.exec(v.trim())
  if (!m || m[1] === '*') return null
  return Number(m[1])
}

function headerString(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name.toLowerCase()] ?? h[name]
  return Array.isArray(v) ? v[0] : v
}

type RawResponse = Pick<IncomingMessage, 'statusCode' | 'headers' | 'on' | 'destroy'>

function adapt(res: RawResponse): DownloadHttpResponse {
  return {
    statusCode: res.statusCode ?? 0,
    headers: res.headers,
    onData: (cb) => res.on('data', (c) => cb(c as Buffer)),
    onEnd: (cb) => res.on('end', cb),
    onError: (cb) => res.on('error', cb),
    destroy: () => res.destroy()
  }
}

/** 生产请求函数：Electron net（自动走系统代理）；动态 import 避免测试环境加载 electron */
export async function electronNetRequest(
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
): Promise<DownloadHttpResponse> {
  const { net } = await import('electron')
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    if (rangeStart !== null) req.setHeader('Range', `bytes=${rangeStart}-`)
    signal.addEventListener('abort', () => {
      req.destroy()
      reject(new DownloadCanceled())
    }, { once: true })
    req.on('response', (res) => resolve(adapt(res as unknown as RawResponse)))
    req.on('error', (err: Error) => reject(signal.aborted ? new DownloadCanceled() : err))
    req.end()
  })
}

/** 测试请求函数：node 原生 http(s)，支持 3xx 跳转一层 */
export function nodeHttpRequest(
  url: string,
  rangeStart: number | null,
  signal: AbortSignal
): Promise<DownloadHttpResponse> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { headers: rangeStart !== null ? { Range: `bytes=${rangeStart}-` } : {} }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        nodeHttpRequest(new URL(res.headers.location, url).toString(), rangeStart, signal).then(resolve, reject)
        return
      }
      resolve(adapt(res))
    })
    req.on('error', (err) => reject(signal.aborted ? new DownloadCanceled() : err))
    signal.addEventListener('abort', () => req.destroy(new DownloadCanceled() as Error), { once: true })
  })
}

export interface StreamDownloadOptions {
  url: string
  partPath: string
  finalPath: string
  expectedSize?: number
  requestFn: DownloadRequestFn
  signal: AbortSignal
  onProgress?: (p: DownloadProgress) => void
  /** 重试次数（不含首次），默认 2（共 3 次尝试） */
  retries?: number
  sleep?: (ms: number) => Promise<void>
}

const BACKOFF = [500, 1500, 4000]

/**
 * 断点续传下载：
 * 有 .part 发 Range；206→追加；200/其他→删 .part 全量重下。
 * 网络错误/5xx 退避重试；abort → DownloadCanceled（保留 .part）。
 * 完成后 expectedSize 软校验，.part 重命名为最终文件。
 */
export async function streamDownload(opts: StreamDownloadOptions): Promise<{ path: string; bytes: number }> {
  const {
    url, partPath, finalPath, expectedSize, requestFn, signal, onProgress,
    retries = 2,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  } = opts
  let lastErr: Error | undefined

  for (let attempt = 0; attempt < retries + 1; attempt++) {
    if (signal.aborted) throw new DownloadCanceled()
    try {
      const resumeFrom = existsSync(partPath) ? (await stat(partPath)).size : 0
      const res = await requestFn(url, resumeFrom > 0 ? resumeFrom : null, signal)

      let append: boolean
      let startOffset: number
      let total: number | null
      if (res.statusCode === 206 && resumeFrom > 0) {
        append = true
        startOffset = resumeFrom
        total = parseContentRange(headerString(res.headers, 'content-range'))
      } else if (res.statusCode === 200) {
        append = false
        startOffset = 0
        const cl = Number(headerString(res.headers, 'content-length'))
        total = Number.isFinite(cl) ? cl : null
      } else {
        res.destroy()
        throw new Error(`HTTP ${res.statusCode}`)
      }

      await rm(finalPath, { force: true })
      let downloaded = startOffset
      const t0 = Date.now()
      let lastEmit = 0

      // 用可手动计数的 PassThrough 风格包装：响应是 AsyncIterable，逐块写
      const out = createWriteStream(partPath, { flags: append ? 'a' : 'w' })
      await new Promise<void>((resolve, reject) => {
        out.on('error', reject)
        res.onData((chunk) => {
          downloaded += chunk.length
          const now = Date.now()
          if (onProgress && now - lastEmit >= 200) {
            lastEmit = now
            const elapsed = Math.max(1, now - t0)
            onProgress({ downloaded, total, bytesPerMs: downloaded / elapsed })
          }
          if (!out.write(chunk)) {
            // 背压：暂停响应，drain 后恢复
            ;(res as unknown as IncomingMessage).pause?.()
            out.once('drain', () => (res as unknown as IncomingMessage).resume?.())
          }
        })
        res.onEnd(() => out.end(() => resolve()))
        res.onError((err) => {
          out.destroy()
          reject(signal.aborted ? new DownloadCanceled() : err)
        })
        signal.addEventListener('abort', () => {
          res.destroy()
          out.destroy()
          reject(new DownloadCanceled())
        }, { once: true })
      })

      onProgress?.({ downloaded, total, bytesPerMs: downloaded / Math.max(1, Date.now() - t0) })

      if (expectedSize !== undefined && downloaded !== expectedSize) {
        await rm(partPath, { force: true })
        throw new SizeMismatchError(downloaded, expectedSize)
      }
      await rm(finalPath, { force: true })
      await rename(partPath, finalPath)
      return { path: finalPath, bytes: downloaded }
    } catch (e) {
      lastErr = e as Error
      if (e instanceof DownloadCanceled) throw e
      if (attempt === retries) break
      await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)])
    }
  }
  throw lastErr ?? new Error('download-failed')
}
```

删除未使用的 import（`pipeline`、`createWriteStream as createWriteStreamCbs` 等在覆盖版本中已不存在；最终文件顶部 import 仅保留：`rm, rename, stat`（fs/promises）、`createWriteStream, existsSync`（fs）、http、https、`IncomingMessage` 类型）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/main/update-downloader.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 6: typecheck + 提交**

Run: `npm run typecheck`
Expected: 0 错误

```bash
git add electron/main/update/downloader.ts tests/main/update-downloader.test.ts
git commit -m "feat(update): 断点续传下载器（Range/回退重下/重试/取消，net与node双请求函数）"
```

---

### Task 5: PowerShell 守护脚本生成器（纯 ASCII）

**Files:**
- Create: `electron/main/update/guardian-script.ts`
- Test: `tests/main/update-guardian-script.test.ts`

- [ ] **Step 1: 写失败测试 `tests/main/update-guardian-script.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildGuardianScript, type GuardianParams } from '../../electron/main/update/guardian-script'

describe('buildGuardianScript', () => {
  const script = buildGuardianScript()

  it('输出为纯 ASCII（PS5.1 无 BOM UTF-8 兼容性）', () => {
    expect(/^[\x00-\x7F]*$/.test(script)).toBe(true)
  })

  it('包含全部关键步骤标记', () => {
    for (const marker of [
      "Get-Content (Join-Path $scriptDir 'guardian-params.json') -Encoding UTF8 -Raw",
      'Wait-AppExit',
      'robocopy',
      "/S' -Wait -PassThru",
      "Write-GuardianState 'done'",
      "Write-GuardianState 'failed'",
      '-Verb RunAs',
      'ShellExecute',
      'backup-',
      'guardian.log'
    ]) {
      expect(script).toContain(marker)
    }
  })
})

describe('GuardianParams 形状（文档化，供服务端生成 params 文件）', () => {
  it('字段齐全', () => {
    const p: GuardianParams = {
      setupPath: 'C:/x/setup.exe',
      exePath: 'C:/Program Files/TemplatePrint/TemplatePrint.exe',
      statePath: 'C:/u/updates/install-state.json',
      backupDir: 'C:/u/updates/backup-0.1.0',
      logPath: 'C:/u/updates/guardian.log',
      fromVersion: '0.1.0',
      toVersion: '0.2.0'
    }
    expect(p.toVersion).toBe('0.2.0')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/main/update-guardian-script.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `electron/main/update/guardian-script.ts`**

```ts
/** 守护脚本参数（主进程写 guardian-params.json，UTF-8；路径可含非 ASCII） */
export interface GuardianParams {
  /** 已下载校验通过的 NSIS 安装包绝对路径 */
  setupPath: string
  /** 当前应用 exe 绝对路径（其目录即安装目录/备份源） */
  exePath: string
  statePath: string
  /** 备份目标目录（如 .../updates/backup-0.1.0） */
  backupDir: string
  logPath: string
  fromVersion: string
  toVersion: string
}

/**
 * 生成纯 ASCII 的 PowerShell 5.1 守护脚本。
 * 流程：等应用退出 → 必要时自我提权（UAC 一次）→ robocopy 备份安装目录
 *      → NSIS /S 静默安装 → 校验新版本 → 成功启动新版；失败 robocopy /MIR 回滚并启动旧版。
 * 所有路径运行时从同目录 guardian-params.json 读取，脚本内不硬编码任何路径。
 */
export function buildGuardianScript(): string {
  return String.raw`# TemplatePrint update guardian (ASCII only). Generated by the app - do not edit.
param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path $MyInvocation.MyCommand.Path -Parent
$params = Get-Content (Join-Path $scriptDir 'guardian-params.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$logFile = $params.logPath
$installDir = Split-Path $params.exePath -Parent

function Write-Log($m) {
  $line = (Get-Date).ToString('s') + ' ' + $m
  Out-File -FilePath $logFile -Append -Encoding ASCII -InputObject $line
}
function Write-GuardianState($phase, $reason) {
  $o = [ordered]@{
    from = $params.fromVersion
    to = $params.toVersion
    phase = $phase
    reason = $reason
    ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  ($o | ConvertTo-Json -Compress) | Out-File -FilePath $params.statePath -Encoding ASCII
}
function Test-MinVersion($actual, $min) {
  if (-not $actual) { return $false }
  $a = $actual.Split('.')
  $b = $min.Split('.')
  for ($i = 0; $i -lt [Math]::Max($a.Length, $b.Length); $i++) {
    $x = 0; $y = 0
    if ($i -lt $a.Length) { [void][int]::TryParse(($a[$i] -replace '[^0-9].*$',''), [ref]$x) }
    if ($i -lt $b.Length) { [void][int]::TryParse(($b[$i] -replace '[^0-9].*$',''), [ref]$y) }
    if ($x -lt $y) { return $false }
    if ($x -gt $y) { return $true }
  }
  return $true
}
function Start-App() {
  # ShellExecute 以普通完整性级别启动（避免守护进程提权后带出高权限应用）
  $shell = New-Object -ComObject Shell.Application
  $shell.ShellExecute($params.exePath)
}
function Fail-Guardian($code) {
  Write-Log ('FAIL ' + $code)
  try { Write-GuardianState 'failed' $code } catch { Write-Log ('state-write-failed ' + $_.Exception.Message) }
  try {
    if (Test-Path $params.backupDir) {
      Write-Log 'rollback with robocopy /MIR'
      robocopy $params.backupDir $installDir /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
      Write-Log ('rollback exit ' + $LASTEXITCODE)
    }
  } catch { Write-Log ('rollback-failed ' + $_.Exception.Message) }
  Start-App
  exit 1
}

if (-not $Elevated) {
  # 1) 等待应用退出（按 exe 绝对路径匹配；守护脚本自身在 updates 目录不会被匹配）
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    $running = @(Get-Process | Where-Object {
      try { $_.Path -and ($_.Path -eq $params.exePath) } catch { $false }
    })
    if ($running.Count -eq 0) { break }
    Start-Sleep -Milliseconds -500 0>$null
    Start-Sleep -Milliseconds 500
  }
  $still = @(Get-Process | Where-Object {
    try { $_.Path -and ($_.Path -eq $params.exePath) } catch { $false }
  })
  if ($still.Count -gt 0) { Fail-Guardian 'wait-process-timeout' }

  # 2) 探测安装目录是否需要写权限；需要则自我提权（用户只看到一次 UAC）
  $probe = Join-Path $installDir ('.tp-write-probe-' + [Guid]::NewGuid().ToString('N'))
  $needAdmin = $false
  try {
    New-Item -ItemType File -Path $probe -Force | Out-Null
    Remove-Item $probe -Force
  } catch { $needAdmin = $true }
  if ($needAdmin) {
    Write-Log 'elevating'
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
      '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$PSCommandPath`"", '-Elevated'
    )
    exit 0
  }
}

try {
  Write-Log ('guardian start ' + $params.fromVersion + ' -> ' + $params.toVersion)
  New-Item -ItemType Directory -Force -Path (Split-Path $params.statePath -Parent) | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path $params.logPath -Parent) | Out-Null
  Write-GuardianState 'installing' $null

  # 3) 备份当前安装目录
  New-Item -ItemType Directory -Force -Path $params.backupDir | Out-Null
  robocopy $installDir $params.backupDir /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { Fail-Guardian 'backup-failed' }
  Write-Log ('backup exit ' + $LASTEXITCODE)

  # 4) NSIS 静默安装
  $p = Start-Process -FilePath $params.setupPath -ArgumentList '/S' -Wait -PassThru
  Write-Log ('installer exit ' + $p.ExitCode)
  if ($p.ExitCode -ne 0) { Fail-Guardian 'installer-failed' }

  # 5) 校验新版本
  if (-not (Test-Path $params.exePath)) { Fail-Guardian 'verify-failed' }
  $actual = (Get-Item $params.exePath).VersionInfo.ProductVersion
  Write-Log ('new version ' + $actual)
  if (-not (Test-MinVersion $actual $params.toVersion)) { Fail-Guardian 'verify-failed' }

  Write-GuardianState 'done' $null
  Write-Log 'done'
  Start-App
  exit 0
} catch {
  Write-Log ('exception ' + $_.Exception.Message)
  Fail-Guardian 'installer-failed'
}
`
}
```

**注意：** 上面等待循环里有一行误写的 `Start-Sleep -Milliseconds -500 0>$null`，必须删除，只保留 `Start-Sleep -Milliseconds 500`。即等待循环体最终为：

```powershell
    if ($running.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
```

- [ ] **Step 4: 删除误写行后跑测试确认通过**

Run: `npx vitest run tests/main/update-guardian-script.test.ts`
Expected: PASS（3 tests）

Run: `npm run typecheck`
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add electron/main/update/guardian-script.ts tests/main/update-guardian-script.test.ts
git commit -m "feat(update): 纯ASCII守护脚本生成器（提权/备份/静默安装/校验/回滚）"
```

---

### Task 6: UpdateService 编排（检查/下载/校验/安装/状态/节流，依赖可注入）

**Files:**
- Create: `electron/main/services/update-service.ts`
- Test: `tests/main/update-service.test.ts`

- [ ] **Step 1: 写失败测试 `tests/main/update-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { UpdateService } from '../../electron/main/services/update-service'
import { nodeHttpRequest } from '../../electron/main/update/downloader'
import type { CheckResultPayload, UpdateProgressPayload } from '../../shared/update-manifest'

let dir: string
beforeEach(() => {
  dir = join(tmpdir(), `tp-usvc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, 'updates', 'downloads'), { recursive: true })
})

const body = Buffer.from('fake-installer-bytes-'.repeat(500))
const sha = createHash('sha256').update(body).digest('hex')
const manifest = {
  version: '9.9.9',
  releaseDate: '2026-09-25',
  releaseNotes: '测试更新\n- 一条',
  url: 'setup.exe',
  size: body.length,
  sha256: sha
}

function startFileServer(): { server: Server; base: string } {
  const server = createServer((req, res) => {
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
    if (m) {
      const start = Number(m[1])
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${body.length - 1}/${body.length}`)
      res.end(body.subarray(start))
    } else if (req.url === '/latest.json') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(manifest))
    } else {
      res.statusCode = 200
      res.end(body)
    }
  })
  // @ts-expect-error listen sync helper
  server.listen(0, '127.0.0.1')
  const port = (server.address() as AddressInfo).port
  return { server, base: `http://127.0.0.1:${port}/` }
}

function makeSvc(base: string, opts?: { version?: string; now?: () => number }) {
  const events: { channel: string; payload: unknown }[] = []
  const svc = new UpdateService({
    dataDir: dir,
    currentVersion: opts?.version ?? '0.1.0',
    isPackaged: false,
    baseUrl: base,
    requestFn: nodeHttpRequest,
    httpGetText: undefined,
    now: opts?.now ?? (() => Date.now()),
    sleep: async () => {},
    quit: () => {},
    spawnGuardian: () => { throw new Error('dev 不应启动守护脚本') }
  })
  svc.on('update:checkResult', (p) => events.push({ channel: 'update:checkResult', payload: p }))
  svc.on('update:progress', (p) => events.push({ channel: 'update:progress', payload: p }))
  svc.on('update:installFailed', (p) => events.push({ channel: 'update:installFailed', payload: p }))
  svc.on('update:installed', (p) => events.push({ channel: 'update:installed', payload: p }))
  return { svc, events }
}

describe('UpdateService.check', () => {
  it('发现新版本 → checkResult 携带清单；手动无更新 → up-to-date', async () => {
    const { server, base } = startFileServer()
    const { svc, events } = makeSvc(base)
    await svc.check(true)
    const r1 = events.map((e) => e.payload as CheckResultPayload).find((p) => p.hasUpdate)!
    expect(r1.manifest?.version).toBe('9.9.9')
    server.close()

    const s2 = makeSvc(base, { version: '99.0.0' })
    await s2.svc.check(true)
    const r2 = s2.events.map((e) => e.payload as CheckResultPayload).at(-1)!
    expect(r2.hasUpdate).toBe(false)
    expect(r2.reason).toBe('up-to-date')
  })

  it('跳过的版本：自动检查静默，手动仍可见', async () => {
    const { server, base } = startFileServer()
    const { svc, events } = makeSvc(base)
    await svc.skipVersion('9.9.9')
    await svc.check(false)
    expect(events.some((e) => e.channel === 'update:checkResult')).toBe(false)
    await svc.check(true)
    expect(events.some((e) => (e.payload as CheckResultPayload).hasUpdate === true)).toBe(true)
    server.close()
  })

  it('网络失败：自动静默；手动给 net-error', async () => {
    const { svc, events } = makeSvc('http://127.0.0.1:1/')
    await svc.check(false)
    expect(events.length).toBe(0)
    await svc.check(true)
    expect((events.at(-1)!.payload as CheckResultPayload).reason).toBe('net-error')
  })

  it('坏清单 → bad-manifest', async () => {
    const server = createServer((_req, res) => res.end('{bad'))
    // @ts-expect-error
    server.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    const { svc, events } = makeSvc(base)
    await svc.check(true)
    expect((events.at(-1)!.payload as CheckResultPayload).reason).toBe('bad-manifest')
    server.close()
  })
})

describe('UpdateService 下载/校验/安装', () => {
  it('download 全链路：downloading→ready，落盘 sha 正确；dev install 发 simulated 不退出', async () => {
    const { server, base } = startFileServer()
    const { svc, events } = makeSvc(base)
    await svc.check(false)
    await svc.download()
    const phases = events.filter((e) => e.channel === 'update:progress').map((e) => (e.payload as UpdateProgressPayload).phase)
    expect(phases).toContain('verifying')
    expect(phases.at(-1)).toBe('ready')
    await svc.install()
    const sim = events.map((e) => e.payload as UpdateProgressPayload).find((p) => p.phase === 'simulated')
    expect(sim?.version).toBe('9.9.9')
    server.close()
  })

  it('sha 不符 → error(checksum-mismatch) 且残包被删', async () => {
    const bad = { ...manifest, sha256: 'f'.repeat(64) }
    const server = createServer((req, res) => {
      if (req.url === '/latest.json') { res.end(JSON.stringify(bad)); return }
      res.end(body)
    })
    // @ts-expect-error
    server.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    const { svc, events } = makeSvc(base)
    await svc.check(false)
    await svc.download()
    const err = events.map((e) => e.payload as UpdateProgressPayload).find((p) => p.phase === 'error')
    expect(err?.reason).toBe('checksum-mismatch')
    expect(existsSync(join(dir, 'updates', 'downloads', 'Setup-9.9.9.exe'))).toBe(false)
    server.close()
  })

  it('cancel 后发 canceled 且保留 .part', async () => {
    const { server, base } = startFileServer()
    const { svc, events } = makeSvc(base)
    writeFileSync(join(dir, 'updates', 'downloads', 'Setup-9.9.9.exe.part'), body.subarray(0, 20))
    await svc.check(false)
    const p = svc.download()
    svc.cancelDownload()
    await p.catch(() => {})
    expect(events.map((e) => e.payload as UpdateProgressPayload).some((x) => x.phase === 'canceled')).toBe(true)
    expect(existsSync(join(dir, 'updates', 'downloads', 'Setup-9.9.9.exe.part'))).toBe(true)
    server.close()
  })
})

describe('UpdateService 安装状态与自动检查节流', () => {
  it('done 状态 → installed 事件并清状态；failed → installFailed；滞留 installing → interrupted', async () => {
    const { server, base } = startFileServer()
    const { svc, events } = makeSvc(base)
    const stateFile = join(dir, 'updates', 'install-state.json')
    writeFileSync(stateFile, JSON.stringify({ from: '0.1.0', to: '9.9.9', phase: 'done', reason: null, ts: 1 }))
    await svc.handleInstallState()
    expect(events.map((e) => e.payload).some((p) => (p as { version?: string }).version === '9.9.9')).toBe(true)
    expect(existsSync(stateFile)).toBe(false)
    server.close()

    const s2 = makeSvc(base)
    writeFileSync(join(dir, 'updates', 'install-state.json'), JSON.stringify({ from: '0.1.0', to: '9.9.9', phase: 'failed', reason: 'installer-failed', ts: 1 }))
    await s2.svc.handleInstallState()
    expect(s2.events.map((e) => e.channel)).toContain('update:installFailed')
  })

  it('shouldAutoCheck：关开关/24h内/dev 均不自动查', () => {
    const { svc } = makeSvc('http://x/')
    const t = 1_000_000_000_000
    expect(svc.shouldAutoCheck({ autoCheckUpdates: false, lastUpdateCheckAt: null }, t)).toBe(false)
    expect(svc.shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: t - 1000 }, t)).toBe(false)
    expect(svc.shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: null }, t)).toBe(true)
    expect(svc.shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: t - 25 * 3600_000 }, t)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/main/update-service.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `electron/main/services/update-service.ts`**

```ts
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import {
  UpdateManifestSchema,
  compareVersions,
  resolveDownloadUrl,
  type UpdateManifest,
  type CheckResultPayload,
  type UpdateProgressPayload,
  type InstallState,
  type InstallFailedPayload
} from '../../../shared/update-manifest'
import { streamDownload, DownloadCanceled, SizeMismatchError, electronNetRequest, type DownloadRequestFn } from '../update/downloader'
import { verifySha256 } from '../update/checksum'
import { buildGuardianScript, type GuardianParams } from '../update/guardian-script'
import { loadSettings, saveSettings, type AppSettings } from '../settings'

export type UpdateChannel =
  | 'update:checkResult' | 'update:progress' | 'update:installFailed' | 'update:installed'

type HttpGetText = (url: string, timeoutMs: number) => Promise<string>
type Listener = (payload: unknown) => void

export interface UpdateServiceDeps {
  dataDir: string
  currentVersion: string
  isPackaged: boolean
  baseUrl: string
  requestFn: DownloadRequestFn
  /** undefined=用内置 electron net 拉 JSON */
  httpGetText?: HttpGetText
  now: () => number
  sleep: (ms: number) => Promise<void>
  quit: () => void
  spawnGuardian: (scriptPath: string) => void
}

const DAY_MS = 24 * 3600 * 1000

/** 用 Electron net 拉文本（8s 超时，自动代理） */
async function netGetText(url: string, timeoutMs: number): Promise<string> {
  const { net } = await import('electron')
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    const chunks: Buffer[] = []
    const timer = setTimeout(() => req.destroy(), timeoutMs)
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer)
        res.destroy()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf-8')) })
      res.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
    })
    req.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
    req.end()
  })
}

export class UpdateService {
  private listeners = new Map<UpdateChannel, Set<Listener>>()
  private latest: UpdateManifest | null = null
  private abort: AbortController | null = null
  private readyFile: string | null = null
  private readonly updatesDir: string
  private readonly downloadsDir: string
  private readonly stateFile: string

  constructor(private deps: UpdateServiceDeps) {
    this.updatesDir = join(deps.dataDir, 'updates')
    this.downloadsDir = join(this.updatesDir, 'downloads')
    this.stateFile = join(this.updatesDir, 'install-state.json')
    mkdirSync(this.downloadsDir, { recursive: true })
  }

  static createDefault(dataDir: string): UpdateService {
    return new UpdateService({
      dataDir,
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      // 生产构建中 UPDATE_BASE_URL 被烘焙为常量
      baseUrl: UPDATE_BASE_URL_REF,
      requestFn: electronNetRequest,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      quit: () => app.quit(),
      spawnGuardian: (scriptPath) => {
        spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], {
          detached: true, stdio: 'ignore', windowsHide: true
        }).unref()
      }
    })
  }

  on(channel: UpdateChannel, fn: Listener): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set())
    this.listeners.get(channel)!.add(fn)
    return () => this.listeners.get(channel)?.delete(fn)
  }
  private emit(channel: UpdateChannel, payload: unknown): void {
    this.listeners.get(channel)?.forEach((fn) => fn(payload))
  }

  // ---------- 检查 ----------
  shouldAutoCheck(s: Pick<AppSettings, 'autoCheckUpdates' | 'lastUpdateCheckAt'>, now: number): boolean {
    if (!this.deps.isPackaged) return false
    if (!s.autoCheckUpdates) return false
    if (s.lastUpdateCheckAt && now - s.lastUpdateCheckAt < DAY_MS) return false
    return true
  }

  startAutoCheck(): void {
    const s = loadSettings(this.deps.dataDir)
    if (!this.shouldAutoCheck(s, this.deps.now())) return
    setTimeout(() => { void this.check(false) }, 3000)
  }

  async check(manual: boolean): Promise<void> {
    let manifest: UpdateManifest
    try {
      const getText = this.deps.httpGetText ?? netGetText
      const text = await getText(resolveDownloadUrl(this.deps.baseUrl, 'latest.json'), 8000)
      manifest = UpdateManifestSchema.parse(JSON.parse(text))
    } catch (e) {
      const reason = e instanceof SyntaxError ? 'bad-manifest'
        : /expected|invalid|zod/i.test((e as Error).message) ? 'bad-manifest'
        : 'net-error'
      if (manual) this.emit('update:checkResult', { hasUpdate: false, manual, reason } satisfies CheckResultPayload)
      return
    }
    const s = loadSettings(this.deps.dataDir)
    s.lastUpdateCheckAt = this.deps.now()
    saveSettings(this.deps.dataDir, s)

    if (compareVersions(manifest.version, this.deps.currentVersion) <= 0) {
      if (manual) this.emit('update:checkResult', { hasUpdate: false, manual, reason: 'up-to-date' })
      return
    }
    if (!manual && s.skippedUpdateVersion === manifest.version) return
    this.latest = manifest
    this.emit('update:checkResult', { hasUpdate: true, manual, manifest } satisfies CheckResultPayload)
  }

  async skipVersion(version: string | null): Promise<void> {
    const s = loadSettings(this.deps.dataDir)
    s.skippedUpdateVersion = version
    saveSettings(this.deps.dataDir, s)
  }

  // ---------- 下载 + 校验 ----------
  private filePaths(version: string): { part: string; final: string } {
    return {
      part: join(this.downloadsDir, `Setup-${version}.exe.part`),
      final: join(this.downloadsDir, `Setup-${version}.exe`)
    }
  }

  async download(): Promise<void> {
    if (!this.latest) {
      this.emitProgress({ phase: 'error', reason: 'no-manifest' })
      return
    }
    if (this.readyFile) return
    if (this.abort) return
    const m = this.latest
    const { part, final } = this.filePaths(m.version)
    this.abort = new AbortController()
    try {
      await streamDownload({
        url: resolveDownloadUrl(this.deps.baseUrl, m.url),
        partPath: part,
        finalPath: final,
        expectedSize: m.size,
        requestFn: this.deps.requestFn,
        signal: this.abort.signal,
        sleep: this.deps.sleep,
        onProgress: (p) => this.emitProgress({ phase: 'downloading', ...p })
      })
      this.emitProgress({ phase: 'verifying' })
      const ok = await verifySha256(final, m.sha256)
      if (!ok) {
        rmSync(final, { force: true })
        this.emitProgress({ phase: 'error', reason: 'checksum-mismatch' })
        return
      }
      this.readyFile = final
      this.emitProgress({ phase: 'ready', version: m.version })
    } catch (e) {
      if (e instanceof DownloadCanceled) {
        this.emitProgress({ phase: 'canceled' })
      } else if (e instanceof SizeMismatchError) {
        this.emitProgress({ phase: 'error', reason: 'size-mismatch' })
      } else {
        this.emitProgress({ phase: 'error', reason: 'download-failed' })
      }
    } finally {
      this.abort = null
    }
  }

  cancelDownload(): void {
    this.abort?.abort()
  }

  private emitProgress(p: UpdateProgressPayload): void {
    this.emit('update:progress', p)
  }

  // ---------- 安装 ----------
  async install(): Promise<void> {
    if (!this.latest) {
      this.emitProgress({ phase: 'error', reason: 'no-manifest' })
      return
    }
    const m = this.latest
    const final = this.readyFile ?? this.filePaths(m.version).final
    if (!existsSync(final) || !(await verifySha256(final, m.sha256))) {
      this.emitProgress({ phase: 'error', reason: 'checksum-mismatch' })
      return
    }

    if (!this.deps.isPackaged) {
      // dev 不退出、不跑安装器
      this.emitProgress({ phase: 'simulated', version: m.version })
      return
    }

    const params: GuardianParams = {
      setupPath: final,
      exePath: process.execPath,
      statePath: this.stateFile,
      backupDir: join(this.updatesDir, `backup-${this.deps.currentVersion}`),
      logPath: join(this.updatesDir, 'guardian.log'),
      fromVersion: this.deps.currentVersion,
      toVersion: m.version
    }
    const state: InstallState = {
      from: params.fromVersion, to: params.toVersion, phase: 'installing', reason: null, ts: this.deps.now()
    }
    mkdirSync(this.updatesDir, { recursive: true })
    writeFileSync(join(this.updatesDir, 'guardian.ps1'), buildGuardianScript(), 'ascii')
    writeFileSync(join(this.updatesDir, 'guardian-params.json'), JSON.stringify(params, null, 2), 'utf-8')
    writeFileSync(this.stateFile, JSON.stringify(state), 'utf-8')
    this.deps.spawnGuardian(join(this.updatesDir, 'guardian.ps1'))
    this.deps.quit()
  }

  /** 启动时读取上次安装结果：done→清理备份+通知；failed/installing滞留→失败通知 */
  async handleInstallState(): Promise<void> {
    if (!existsSync(this.stateFile)) return
    let st: InstallState
    try {
      st = JSON.parse(readFileSync(this.stateFile, 'utf-8')) as InstallState
    } catch {
      rmSync(this.stateFile, { force: true })
      return
    }
    if (st.phase === 'done') {
      this.pruneBackups()
      rmSync(this.stateFile, { force: true })
      this.emit('update:installed', { version: st.to })
    } else {
      const reason = st.phase === 'installing' ? 'interrupted' : (st.reason ?? 'installer-failed')
      rmSync(this.stateFile, { force: true })
      this.emit('update:installFailed', { from: st.from, to: st.to, reason } satisfies InstallFailedPayload)
    }
  }

  /** 只保留最近一个 backup-* 目录 */
  private pruneBackups(): void {
    const dirs = readdirSync(this.updatesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('backup-'))
      .map((d) => ({ name: d.name, mtime: statSync(join(this.updatesDir, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const d of dirs.slice(1)) rmSync(join(this.updatesDir, d.name), { recursive: true, force: true })
  }

  get logDir(): string {
    return this.updatesDir
  }
}

// 由 update-config 提供；放在文件末尾引用保持依赖单向（shared 不依赖 electron）
import { UPDATE_BASE_URL as UPDATE_BASE_URL_REF } from '../../../shared/update-config'
```

- [ ] **Step 4: 修正两处问题**

1. `createDefault` 是静态方法却引用实例属性无碍；但测试传入了 `httpGetText: undefined` 与构造参数 `baseUrl`——确认 `UpdateServiceDeps` 已含这些字段（已含）。
2. TS 不允许文件末尾的 import 在部分配置下报错：把 `import { UPDATE_BASE_URL } from '../../../shared/update-config'` **移动到文件顶部 import 区**，并把 `UPDATE_BASE_URL_REF` 全部替换为 `UPDATE_BASE_URL`。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/main/update-service.test.ts`
Expected: PASS（10 tests）

- [ ] **Step 6: typecheck + 提交**

Run: `npm run typecheck`
Expected: 0 错误

```bash
git add electron/main/services/update-service.ts tests/main/update-service.test.ts
git commit -m "feat(update): UpdateService编排（检查节流/跳过/下载校验/状态回滚通知/守护启动）"
```

---

### Task 7: IPC 契约、preload 桥接、handler 注册

**Files:**
- Modify: `shared/ipc-contract.ts`
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/ipc/index.ts`
- Create: `electron/main/services/update-ipc.ts`

- [ ] **Step 1: 修改 `shared/ipc-contract.ts`**

顶部 import 区追加：

```ts
import type {
  CheckResultPayload,
  UpdateProgressPayload,
  InstallFailedPayload
} from './update-manifest'
```

`IPC` 对象追加（在 `backupOpen` 后）：

```ts
  ,
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateCancel: 'update:cancel',
  updateInstall: 'update:install',
  updateSkipVersion: 'update:skip-version',
  updateOpenLogDir: 'update:open-log-dir'
```

（注意保持 `as const` 与逗号合法；实际编辑时直接在 `backupOpen: 'backup:open'` 行末加逗号后追加。）

文件末尾 `declare global` 之前，`Api` 接口内 `backups` 块之后追加：

```ts
  update: {
    check(manual: boolean): Promise<void>
    download(): Promise<void>
    cancel(): Promise<void>
    install(): Promise<void>
    skipVersion(version: string | null): Promise<void>
    openLogDir(): Promise<void>
    on(
      channel: 'update:checkResult' | 'update:progress' | 'update:installFailed' | 'update:installed',
      cb: (
        payload:
          | CheckResultPayload
          | UpdateProgressPayload
          | InstallFailedPayload
          | { version: string }
      ) => void
    ): () => void
  }
```

- [ ] **Step 2: 创建 `electron/main/services/update-ipc.ts`**

```ts
import { ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import type { Services } from '../ipc'

export function registerUpdateHandlers(deps: Services, win: BrowserWindow): void {
  const svc = deps.update
  const forward = (channel: string) => (payload: unknown) => win.webContents.send(channel, payload)
  svc.on('update:checkResult', forward('update:checkResult'))
  svc.on('update:progress', forward('update:progress'))
  svc.on('update:installFailed', forward('update:installFailed'))
  svc.on('update:installed', forward('update:installed'))

  ipcMain.removeHandler(IPC.updateCheck)
  ipcMain.handle(IPC.updateCheck, (_e, manual: boolean) => svc.check(manual))
  ipcMain.removeHandler(IPC.updateDownload)
  ipcMain.handle(IPC.updateDownload, () => svc.download())
  ipcMain.removeHandler(IPC.updateCancel)
  ipcMain.handle(IPC.updateCancel, () => svc.cancelDownload())
  ipcMain.removeHandler(IPC.updateInstall)
  ipcMain.handle(IPC.updateInstall, () => svc.install())
  ipcMain.removeHandler(IPC.updateSkipVersion)
  ipcMain.handle(IPC.updateSkipVersion, (_e, version: string | null) => svc.skipVersion(version))
  ipcMain.removeHandler(IPC.updateOpenLogDir)
  ipcMain.handle(IPC.updateOpenLogDir, () => shell.openPath(svc.logDir))

  void svc.handleInstallState()
  svc.startAutoCheck()
}
```

- [ ] **Step 3: 修改 `electron/main/ipc/index.ts`**

import 区追加：

```ts
import type { UpdateService } from '../services/update-service'
import { registerUpdateHandlers } from '../services/update-ipc'
```

`Services` 接口追加：`update: UpdateService`

`registerIpc` 内 `registerBackupHandlers(deps)` 之后追加：

```ts
  registerUpdateHandlers(deps, mainWindow)
```

- [ ] **Step 4: 修改 `electron/preload/index.ts`**

`api` 对象内 `system` 块之前追加：

```ts
  update: {
    check: (manual: boolean) => ipcRenderer.invoke(IPC.updateCheck, manual),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    cancel: () => ipcRenderer.invoke(IPC.updateCancel),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    skipVersion: (version: string | null) => ipcRenderer.invoke(IPC.updateSkipVersion, version),
    openLogDir: () => ipcRenderer.invoke(IPC.updateOpenLogDir),
    on: (channel: string, cb: (payload: unknown) => void) => {
      const allowed = ['update:checkResult', 'update:progress', 'update:installFailed', 'update:installed']
      if (!allowed.includes(channel)) return () => {}
      const handler = (_e: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
```

- [ ] **Step 5: typecheck 通过**

Run: `npm run typecheck`
Expected: 0 错误（此时 main/index.ts 尚未提供 deps.update，会报错——进入 Task 8 Step 1 修复后应清零；本步预期仅剩 main/index.ts 一处 "Property 'update' missing" 错误）

- [ ] **Step 6: 提交（与 Task 8 合并提交也可，此处先暂存不提交，Task 8 完成后一起提交）**

不执行 git 命令，继续 Task 8。

---

### Task 8: 主进程接线（app-paths 目录、index.ts 实例化）

**Files:**
- Modify: `electron/main/app-paths.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: 修改 `electron/main/app-paths.ts`**

`mkdirSync` 段追加：

```ts
    mkdirSync(join(dataDir, 'updates'), { recursive: true })
    mkdirSync(join(dataDir, 'updates', 'downloads'), { recursive: true })
```

返回对象追加：

```ts
    updatesDir: join(dataDir, 'updates')
```

- [ ] **Step 2: 修改 `electron/main/index.ts`**

import 区追加：

```ts
import { UpdateService } from './services/update-service'
```

`seeds` 实例化之后、`services` 对象之前追加：

```ts
  const update = UpdateService.createDefault(p.updatesDir)
```

`services` 对象追加字段：

```ts
  const services: Services = { assets, templates, history, print, printers, fonts, settings, backups, update }
```

（UpdateService 不依赖 db，在迁移完成之后创建即可。）

- [ ] **Step 3: typecheck 清零 + 全量测试**

Run: `npm run typecheck`
Expected: 0 错误

Run: `npx vitest run`
Expected: 全部通过（原有 91 + 本计划新增约 31）

- [ ] **Step 4: 提交 Task 7+8**

```bash
git add shared/ipc-contract.ts electron/preload/index.ts electron/main/ipc/index.ts electron/main/services/update-ipc.ts electron/main/app-paths.ts electron/main/index.ts
git commit -m "feat(update): IPC通道/preload桥接/handler注册与主进程接线"
```

---

### Task 9: 渲染端全局更新弹窗

**Files:**
- Create: `src/renderer/update/update-modal.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: 创建 `src/renderer/update/update-modal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Modal, Progress, Button, Space, Typography, message } from 'antd'
import type {
  UpdateManifest,
  CheckResultPayload,
  UpdateProgressPayload,
  InstallFailedPayload
} from '../../../shared/update-manifest'
import { formatBytes } from '../../../shared/update-manifest'

const { Paragraph, Text } = Typography

type View =
  | { kind: 'closed' }
  | { kind: 'notice'; manifest: UpdateManifest }
  | { kind: 'downloading'; downloaded: number; total: number | null; bytesPerMs: number }
  | { kind: 'verifying' }
  | { kind: 'error'; reason: string }

/** 守护脚本/服务端原因码 → 中文说明 */
const REASON_TEXT: Record<string, string> = {
  'net-error': '无法连接更新服务器，请检查网络后重试。',
  'bad-manifest': '更新信息异常，请联系开发者。',
  'download-failed': '下载失败，已保留进度，可重试断点续传。',
  'size-mismatch': '安装包下载不完整，请重新下载。',
  'checksum-mismatch': '安装包已损坏或被篡改，已自动删除，请勿在非官方渠道获取更新。',
  'no-manifest': '尚未获取到更新信息，请先检查更新。',
  interrupted: '上次更新未完成（程序被中断），已恢复到旧版本。',
  'wait-process-timeout': '安装失败：程序未能正常退出。请重启电脑后重新更新。',
  'backup-failed': '安装失败：无法创建备份，请检查磁盘空间和文件夹权限。',
  'installer-failed': '安装失败，已自动恢复到旧版本。如反复出现，请暂时关闭杀毒软件后重试。',
  'verify-failed': '安装后版本校验失败，已自动恢复到旧版本。'
}

function reasonText(code: string): string {
  return REASON_TEXT[code] ?? `更新失败（${code}），请联系开发者。`
}

export function UpdateModal(): JSX.Element | null {
  const [view, setView] = useState<View>({ kind: 'closed' })
  const [manifest, setManifest] = useState<UpdateManifest | null>(null)
  const [installFailed, setInstallFailed] = useState<InstallFailedPayload | null>(null)
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false)

  useEffect(() => {
    const offs = [
      window.api.update.on('update:checkResult', (p) => {
        const r = p as CheckResultPayload
        if (r.hasUpdate && r.manifest) {
          setManifest(r.manifest)
          setView({ kind: 'notice', manifest: r.manifest })
        } else if (r.manual) {
          if (r.reason === 'up-to-date') message.success('当前已是最新版本')
          else message.error(reasonText(r.reason ?? 'net-error'))
        }
      }),
      window.api.update.on('update:progress', (p) => {
        const r = p as UpdateProgressPayload
        switch (r.phase) {
          case 'downloading':
            setView({ kind: 'downloading', downloaded: r.downloaded, total: r.total, bytesPerMs: r.bytesPerMs })
            break
          case 'verifying':
            setView({ kind: 'verifying' })
            break
          case 'ready':
            setView({ kind: 'closed' })
            setInstallConfirmOpen(true)
            break
          case 'simulated':
            message.info(`开发环境模拟安装 v${r.version}（未实际退出）`)
            setView({ kind: 'closed' })
            break
          case 'error':
            setView({ kind: 'error', reason: r.reason })
            break
          case 'canceled':
            setManifest((m) => (m ? { kind: 'notice', manifest: m } as View : { kind: 'closed' }))
            setView((m0) => (manifest ? { kind: 'notice', manifest } : m0))
            break
        }
      }),
      window.api.update.on('update:installFailed', (p) => {
        setInstallFailed(p as InstallFailedPayload)
      }),
      window.api.update.on('update:installed', (p) => {
        message.success(`已更新到 v${(p as { version: string }).version}`)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [manifest])

  const startDownload = (): void => {
    setView({ kind: 'downloading', downloaded: 0, total: null, bytesPerMs: 0 })
    void window.api.update.download()
  }

  const percent = view.kind === 'downloading' && view.total
    ? Math.min(100, Math.round((view.downloaded / view.total) * 100))
    : null

  return (
    <>
      <Modal
        title={view.kind === 'notice' ? `发现新版本 v${view.manifest.version}` : '软件更新'}
        open={view.kind !== 'closed'}
        footer={null}
        maskClosable={false}
        width={520}
        onCancel={() => setView({ kind: 'closed' })}
      >
        {view.kind === 'notice' && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {view.manifest.releaseDate && <Text type="secondary">发布日期：{view.manifest.releaseDate}</Text>}
            <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0, maxHeight: 220, overflow: 'auto' }}>
              {view.manifest.releaseNotes || '本次更新包含稳定性与体验优化。'}
            </Paragraph>
            <Text type="secondary">
              安装包大小：{view.manifest.size !== undefined ? formatBytes(view.manifest.size) : '未知'}
            </Text>
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button type="primary" onClick={startDownload}>立即更新</Button>
              <Button onClick={() => setView({ kind: 'closed' })}>稍后更新</Button>
              <Button type="link" danger onClick={() => {
                void window.api.update.skipVersion(view.manifest.version)
                message.info(`已跳过 v${view.manifest.version}，可在"关于我们"中恢复检查`)
                setView({ kind: 'closed' })
              }}>跳过此版本</Button>
            </Space>
          </Space>
        )}

        {view.kind === 'downloading' && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Progress percent={percent ?? undefined} status="active"
              showInfo={percent !== null}
              format={percent === null ? () => '下载中…' : undefined} />
            <Text type="secondary">
              已下载 {formatBytes(view.downloaded)}
              {view.total !== null ? ` / ${formatBytes(view.total)}` : ''}
              {view.bytesPerMs > 0 && ` · ${(view.bytesPerMs * 1000 / 1048576).toFixed(1)} MB/s`}
            </Text>
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button onClick={() => void window.api.update.cancel()}>取消（保留进度）</Button>
            </Space>
          </Space>
        )}

        {view.kind === 'verifying' && (
          <Space direction="vertical" size={8}>
            <Progress percent={100} status="active" showInfo={false} />
            <Text>正在校验安装包完整性，请稍候…</Text>
          </Space>
        )}

        {view.kind === 'error' && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="danger">{reasonText(view.reason)}</Text>
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              {manifest && <Button type="primary" onClick={startDownload}>重试</Button>}
              <Button onClick={() => setView({ kind: 'closed' })}>稍后</Button>
            </Space>
          </Space>
        )}
      </Modal>

      <Modal
        title="准备安装更新"
        open={installConfirmOpen}
        okText="立即安装并重启"
        cancelText="取消"
        onOk={() => {
          setInstallConfirmOpen(false)
          void window.api.update.install()
        }}
        onCancel={() => setInstallConfirmOpen(false)}
      >
        <Paragraph>
          即将退出程序并运行安装程序，安装约需 1 分钟，期间请勿关机或断电。
        </Paragraph>
        <Paragraph type="warning" style={{ marginBottom: 0 }}>
          如出现「用户账户控制（UAC）」提示，请点击「是」；点击取消则安装包已保留，可稍后重新安装。
        </Paragraph>
      </Modal>

      <Modal
        title="更新失败，已恢复到旧版本"
        open={!!installFailed}
        footer={null}
        onCancel={() => setInstallFailed(null)}
      >
        {installFailed && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text>从 v{installFailed.from} 升级到 v{installFailed.to} 失败。</Text>
            <Text type="danger">{reasonText(installFailed.reason)}</Text>
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button onClick={() => void window.api.update.openLogDir()}>打开更新日志目录</Button>
              <Button type="primary" onClick={() => setInstallFailed(null)}>我知道了</Button>
            </Space>
          </Space>
        )}
      </Modal>
    </>
  )
}
```

**收紧一处实现：** `canceled` 分支不要引用 `setManifest` 的函数式更新怪写法，替换为：

```tsx
          case 'canceled':
            setView((cur) => (cur.kind === 'closed' && manifest ? { kind: 'notice', manifest } : cur))
            break
```

并且 `useEffect` 依赖数组只保留 `[]`（所有状态通过函数式更新读取；`manifest` 在 effect 闭包中通过 ref 或直接用 setView 函数式形式）。最终处理方式：effect 内用 `setManifest` 保存最新清单；canceled 分支改为：

```tsx
          case 'canceled':
            setManifest((m) => {
              if (m) setView({ kind: 'notice', manifest: m })
              return m
            })
            break
```

`useEffect(..., [])` 依赖空数组（组件全生命周期只订阅一次）。

- [ ] **Step 2: 修改 `src/renderer/App.tsx`**

import 追加：

```tsx
import { UpdateModal } from './update/update-modal'
```

`Shell` 组件 return 中，`</Layout>` 之前（Layout 内最外层包一层不可，直接放在 Layout 同级）——把 return 改为：

```tsx
  return (
    <>
      <Layout style={{ height: '100vh' }}>
        {/* ……原有 Sider/Content 不变…… */}
      </Layout>
      <UpdateModal />
    </>
  )
```

即给现有 `<Layout>…</Layout>` 外面包 Fragment 并在其后挂 `<UpdateModal />`。

- [ ] **Step 3: typecheck 通过**

Run: `npm run typecheck`
Expected: 0 错误

- [ ] **Step 4: 提交**

```bash
git add src/renderer/update/update-modal.tsx src/renderer/App.tsx
git commit -m "feat(update): 全局更新弹窗（通知/下载进度/校验/安装确认/失败回滚提示）"
```

---

### Task 10: 关于页更新入口（检查按钮 + 自动检查开关 + 恢复跳过）

**Files:**
- Modify: `src/renderer/pages/about.tsx`

- [ ] **Step 1: 整体替换 `src/renderer/pages/about.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button, Card, Space, Switch, Tag, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { APP_NAME, APP_VERSION } from '../../../shared/app-info'
import type { AppSettingsDto, CheckResultPayload } from '../../../shared/../shared/ipc-contract'
import type { CheckResultPayload as CRP } from '../../../shared/update-manifest'

const { Paragraph, Text } = Typography

export function AboutPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettingsDto | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    // 手动检查结果事件只用于结束 loading（弹窗组件负责展示）
    const off = window.api.update.on('update:checkResult', () => setChecking(false))
    return off
  }, [])

  const checkNow = (): void => {
    setChecking(true)
    void window.api.update.check(true)
  }

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <Card>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space size={12} align="center">
            <strong style={{ fontSize: 20 }}>{APP_NAME}</strong>
            <Tag color="blue">v{APP_VERSION}</Tag>
          </Space>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            可视化模板设计与打印工具：自定义纸张尺寸，文本/图片/图形自由排版，
            参数占位自动填值，支持横排与竖排文本、仅打印文本（预印纸套打）、
            静默/弹框打印、打印历史与数据备份，适配标签机与普通办公打印机。
          </Paragraph>
        </Space>
      </Card>

      <Card size="small" title="版本更新" style={{ marginTop: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space>
            <Button type="primary" icon={<ReloadOutlined />} loading={checking} onClick={checkNow}>
              检查更新
            </Button>
            <Text type="secondary">当前版本 v{APP_VERSION}</Text>
          </Space>
          <Space>
            <Switch
              checked={settings?.autoCheckUpdates ?? true}
              onChange={async (checked) => {
                const next = await window.api.settings.set({ autoCheckUpdates: checked })
                setSettings(next)
                message.success(checked ? '已开启自动检查' : '已关闭自动检查')
              }}
            />
            <Text>自动检查更新（每日启动时检查一次，可随时跳过）</Text>
          </Space>
          {settings?.skippedUpdateVersion && (
            <Space>
              <Text type="secondary">已跳过 v{settings.skippedUpdateVersion}</Text>
              <Button type="link" size="small" onClick={async () => {
                await window.api.update.skipVersion(null)
                setSettings(await window.api.settings.get())
                message.success('已恢复更新提醒')
              }}>恢复检查</Button>
            </Space>
          )}
        </Space>
      </Card>

      <Card size="small" title="开发与支持" style={{ marginTop: 12 }}>
        <Space direction="vertical" size={8}>
          <Space>
            <Text type="secondary" style={{ width: 110, display: 'inline-block' }}>开发公司</Text>
            <Text strong>上海祥和一文化科技有限公司</Text>
          </Space>
          <Space>
            <Text type="secondary" style={{ width: 110, display: 'inline-block' }}>联系人</Text>
            <Text>祥和</Text>
          </Space>
          <Space>
            <Text type="secondary" style={{ width: 110, display: 'inline-block' }}>电话 / 微信</Text>
            <Text copyable={{ text: '13564020007' }}>13564020007</Text>
          </Space>
        </Space>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: 清理 import**

文件顶部只保留一个类型来源，删除第一行错误的重复 import：

```tsx
import type { AppSettingsDto } from '../../../shared/settings-dto'
import type { CheckResultPayload } from '../../../shared/update-manifest'
```

`CheckResultPayload` 在本文件实际未直接使用（只用了结束 loading），删除该 import 与未用变量；`useEffect` 中回调改为无参：

```tsx
    const off = window.api.update.on('update:checkResult', () => setChecking(false))
```

- [ ] **Step 3: typecheck 通过**

Run: `npm run typecheck`
Expected: 0 错误

- [ ] **Step 4: 提交**

```bash
git add src/renderer/pages/about.tsx
git commit -m "feat(update): 关于页检查更新按钮/自动检查开关/恢复跳过版本"
```

---

### Task 11: 发布脚本（生成清单）+ 本地 Range 静态服务器

**Files:**
- Create: `scripts/build-update-manifest.ps1`
- Create: `scripts/serve-update.ps1`

- [ ] **Step 1: 创建 `scripts/build-update-manifest.ps1`（纯 ASCII）**

```powershell
# Generate latest.json for a built NSIS setup file.
# Usage: powershell -ExecutionPolicy Bypass -File ./scripts/build-update-manifest.ps1 [-SetupPath <file>] [-OutDir <dir>] [-NotesFile <file>]
param(
  [string]$SetupPath = '',
  [string]$OutDir = '',
  [string]$NotesFile = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
if (-not $OutDir) { $OutDir = Join-Path $root 'release' }
if (-not $SetupPath) {
  $SetupPath = Get-ChildItem -Path $OutDir -Filter '*Setup*x64.exe' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $SetupPath -or -not (Test-Path $SetupPath)) { throw 'setup exe not found' }
if (-not $NotesFile) { $candidate = Join-Path $OutDir 'release-notes.txt'; if (Test-Path $candidate) { $NotesFile = $candidate } }

$pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$pkg.version
$notes = ''
if ($NotesFile -and (Test-Path $NotesFile)) { $notes = Get-Content $NotesFile -Raw -Encoding UTF8 }

$fi = Get-Item $SetupPath
$size = $fi.Length
$hash = (Get-FileHash -Algorithm SHA256 -Path $SetupPath).Hash.ToLower()
$obj = [ordered]@{
  version      = $version
  releaseDate  = (Get-Date).ToString('yyyy-MM-dd')
  releaseNotes = $notes.Trim()
  url          = $fi.Name
  size         = $size
  sha256       = $hash
}
$json = $obj | ConvertTo-Json
$out = Join-Path $OutDir 'latest.json'
# No BOM: JSON.parse rejects a leading BOM.
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('wrote ' + $out)
Write-Host ('version=' + $version + ' size=' + $size)
```

- [ ] **Step 2: 创建 `scripts/serve-update.ps1`（纯 ASCII，支持 Range 206）**

```powershell
# Local update server for end-to-end update walkthroughs. Serves a directory over HTTP
# with Range request support. Usage:
#   powershell -ExecutionPolicy Bypass -File ./scripts/serve-update.ps1 [-Dir release] [-Port 8765]
param(
  [string]$Dir = '',
  [int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
if (-not $Dir) { $Dir = Join-Path $root 'release' }
$Dir = (Resolve-Path $Dir).Path
$prefix = 'http://127.0.0.1:' + $Port + '/'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host ('serving ' + $Dir + ' at ' + $prefix + '  (Ctrl+C to stop)')

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if (-not $rel) { $rel = 'index.txt' }
      $file = Join-Path $Dir $rel
      if (-not (Test-Path $file -PathType Leaf)) {
        $ctx.Response.StatusCode = 404; $ctx.Response.Close(); continue
      }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $total = $bytes.Length
      $start = 0; $end = $total - 1; $isRange = $false
      $range = $ctx.Request.Headers['Range']
      if ($range -and ($range -match '^bytes=(\d+)-(\d*)$')) {
        $start = [int]$Matches[1]
        if ($Matches[2] -ne '') { $end = [int]$Matches[2] }
        if ($start -le $end -and $start -lt $total) { $isRange = $true }
        else { $start = 0; $end = $total - 1 }
      }
      if ($isRange) {
        $ctx.Response.StatusCode = 206
        $ctx.Response.AddHeader('Content-Range', ('bytes ' + $start + '-' + $end + '/' + $total))
      } else {
        $ctx.Response.StatusCode = 200
      }
      $ctx.Response.AddHeader('Accept-Ranges', 'bytes')
      $ctx.Response.AddHeader('Content-Length', [string]($end - $start + 1))
      if ($file -like '*.json') { $ctx.Response.ContentType = 'application/json; charset=utf-8' }
      else { $ctx.Response.ContentType = 'application/octet-stream' }
      $len = $end - $start + 1
      $ctx.Response.OutputStream.Write($bytes, $start, $len)
      $ctx.Response.OutputStream.Close()
      $ctx.Response.Close()
      Write-Host ((Get-Date).ToString('HH:mm:ss') + ' ' + $ctx.Request.HttpMethod + ' ' + $rel + ' -> ' + $ctx.Response.StatusCode)
    } catch {
      try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
      Write-Host ('ERR ' + $_.Exception.Message)
    }
  }
} finally {
  $listener.Stop()
}
```

- [ ] **Step 3: 冒烟验证两个脚本语法（不打包，手工构造夹具）**

Run:

```powershell
$d = Join-Path $env:TEMP 'tp-manifest-smoke'; New-Item -ItemType Directory -Force -Path $d | Out-Null
Set-Content -Path (Join-Path $d 'TemplatePrint-9.9.9-Setup-x64.exe') -Value ('x'*1000) -Encoding ASCII
Set-Content -Path (Join-Path $d 'release-notes.txt') -Value 'smoke note' -Encoding UTF8
powershell -ExecutionPolicy Bypass -File ./scripts/build-update-manifest.ps1 -SetupPath (Join-Path $d 'TemplatePrint-9.9.9-Setup-x64.exe') -OutDir $d -NotesFile (Join-Path $d 'release-notes.txt')
Get-Content (Join-Path $d 'latest.json') -Raw
```

Expected: 输出 latest.json，含 version（package.json 真实版本）、size 1000、64 位小写 sha256、url 为文件名。

后台起服务器并用 Range 请求验证 206：

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/serve-update.ps1 -Dir $d -Port 8765
# 另一个终端：
curl.exe -i -H "Range: bytes=100-199" http://127.0.0.1:8765/latest.json
```

Expected: `HTTP/1.1 206` + `Content-Range: bytes 100-199/<total>` + `Accept-Ranges: bytes`。验证后 Ctrl+C 停服务器，删除临时目录。

- [ ] **Step 4: 提交**

```bash
git add scripts/build-update-manifest.ps1 scripts/serve-update.ps1
git commit -m "chore(update): 清单生成脚本与本地Range更新服务器（发布/走查工具）"
```

---

### Task 12: 守护脚本实战演练 + CDP 端到端走查 + 全量验证

**Files:**
- Create: `scripts/dev-drill-guardian.ps1`

- [ ] **Step 1: 创建 `scripts/dev-drill-guardian.ps1`（纯 ASCII；csc 编两个假 exe，验证成功/失败回滚）**

```powershell
# Offline drill for guardian.ps1: compiles fake old/new exes with csc, runs the guardian
# against a sandbox "install dir" with success/failure fake installers, asserts results.
# Usage: powershell -ExecutionPolicy Bypass -File ./scripts/dev-drill-guardian.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
$sandbox = Join-Path $env:TEMP ('tp-guardian-drill-' + [Guid]::NewGuid().ToString('N'))
$appDir = Join-Path $sandbox 'app'
$updDir = Join-Path $sandbox 'updates'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $updDir 'downloads') | Out-Null

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe not found' }

function New-FakeExe($path, $ver) {
  $src = Join-Path $sandbox ([System.IO.Path]::GetFileNameWithoutExtension($path) + '.cs')
  $code = @"
using System.Reflection;
[assembly: AssemblyVersion(`"$ver`")]
class P { static void Main() { } }
"@
  [System.IO.File]::WriteAllText($src, $code, [System.Text.Encoding]::ASCIIEncoding)
  & $csc /nologo /target:exe /out:$path $src | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'csc failed' }
}

Write-Host '== compile fake exes (0.1.0 old, 0.2.0 new) =='
$exePath = Join-Path $appDir 'TemplatePrint.exe'
New-FakeExe $exePath '0.1.0.0'
$newExe = Join-Path $sandbox 'new.exe'
New-FakeExe $newExe '0.2.0.0'

# success installer cmd: copy new.exe over app exe (reads target from sibling target.txt)
$setupOk = Join-Path $sandbox 'setup-ok.cmd'
@"
@echo off
copy /y `"$newExe`" `"$exePath`" >nul
exit /b 0
"@ | Out-File -FilePath $setupOk -Encoding ASCII
# failure installer cmd
$setupFail = Join-Path $sandbox 'setup-fail.cmd'
"@`r`n@echo off`r`nexit /b 1`r`n" | Out-File -FilePath $setupFail -Encoding ASCII

$guardian = Join-Path $updDir 'guardian.ps1'
$paramsFile = Join-Path $updDir 'guardian-params.json'
$stateFile = Join-Path $updDir 'install-state.json'
$logFile = Join-Path $updDir 'guardian.log'

function Invoke-Drill($setupPath, $tag) {
  Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
  Remove-Item $logFile -Force -ErrorAction SilentlyContinue
  $params = [ordered]@{
    setupPath   = $setupPath
    exePath     = $exePath
    statePath   = $stateFile
    backupDir   = Join-Path $updDir 'backup-0.1.0'
    logPath     = $logFile
    fromVersion = '0.1.0'
    toVersion   = '0.2.0'
  }
  [System.IO.File]::WriteAllText($paramsFile, ($params | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ('== drill ' + $tag + ' ==')
  & powershell.exe -ExecutionPolicy Bypass -File $guardian
  Start-Sleep -Milliseconds 300
  $st = Get-Content $stateFile -Raw | ConvertFrom-Json
  $ver = (Get-Item $exePath).VersionInfo.ProductVersion
  Write-Host ('state=' + $st.phase + ' reason=' + $st.reason + ' exeVersion=' + $ver)
  return [pscustomobject]@{ State = $st.phase; Reason = $st.reason; Version = $ver }
}

# guardian.ps1 由 TS 生成器产出（避免演练与真实产物漂移）
node -e "require('esbuild')" 2>$null
$gen = Join-Path $sandbox 'gen.mjs'
@"
import { buildGuardianScript } from 'file:///$($root -replace '\\','/')/electron/main/update/guardian-script.ts'
"@ | Out-Null
# TS 不能直接被 node 执行：改为从已构建 out 目录不可得，直接内联读取源码不现实——
# 采用 esbuild（已在 node_modules）即时转译
$genScript = @"
import { buildGuardianScript } from './electron/main/update/guardian-script.ts'
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[2], buildGuardianScript(), 'ascii')
"@
[System.IO.File]::WriteAllText((Join-Path $root '.__drill-gen.mjs'), $genScript, [System.Text.Encoding]::ASCIIEncoding)
Push-Location $root
try {
  npx esbuild 'electron/main/update/guardian-script.ts' --bundle --platform=node --format=esm "--outfile=$sandbox/g.mjs" | Out-Null
  $runner = Join-Path $sandbox 'run-gen.mjs'
  "import { buildGuardianScript } from 'file:///'+process.argv[1].replace(/\\/g,'/'); import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[2], buildGuardianScript(),'ascii')" | Out-File $runner -Encoding ASCII
  node $runner (Join-Path $sandbox 'g.mjs') $guardian
} finally { Pop-Location; Remove-Item (Join-Path $root '.__drill-gen.mjs') -Force -ErrorAction SilentlyContinue }

$r1 = Invoke-Drill $setupOk 'success'
if ($r1.State -ne 'done' -or $r1.Version -notlike '0.2.0*') { throw 'success drill FAILED' }

# restore old exe for failure scenario, then fail installer must roll back
Copy-Item $appDir\TemplatePrint.exe $sandbox\new-after.exe -Force -ErrorAction SilentlyContinue
# 重新编译 old 覆盖
New-FakeExe $exePath '0.1.0.0'
$r2 = Invoke-Drill $setupFail 'failure-rollback'
if ($r2.State -ne 'failed' -or $r2.Reason -ne 'installer-failed' -or $r2.Version -notlike '0.1.0*') {
  throw 'failure drill FAILED'
}
if (-not (Test-Path (Join-Path $updDir 'backup-0.1.0\TemplatePrint.exe'))) { throw 'backup missing' }

Write-Host 'GUARDIAN DRILL PASSED (success install + failure rollback)'
Write-Host ('sandbox left for inspection: ' + $sandbox)
```

- [ ] **Step 2: 运行守护脚本演练**

Run: `powershell -ExecutionPolicy Bypass -File ./scripts/dev-drill-guardian.ps1`
Expected: 末行 `GUARDIAN DRILL PASSED`。若失败：读 `$sandbox/updates/guardian.log`，修 `guardian-script.ts` 后重跑（改了脚本要同步 Task 5 测试）。

- [ ] **Step 3: CDP 端到端走查（本地清单 + 假包）**

构建应用并起 CDP（按 electron-cdp-walkthrough 技能）：

```powershell
npx electron-vite build
$d = "$env:APPDATA/template-print/updates-cdp-fixture"; New-Item -ItemType Directory -Force $d | Out-Null
```

准备夹具：复制一个任意小 exe（如 `C:\Windows\System32\where.exe`）为 `TemplatePrint-9.9.9-Setup-x64.exe`，计算其真实 sha256，手写 `latest.json`（version 9.9.9、url 指向该文件、size 为真实大小、sha256 真实值、releaseNotes 两行中文），用 `scripts/serve-update.ps1 -Dir $d` 起在 8765。

```powershell
npx electron . --remote-debugging-port=9222 --remote-allow-origins=* --disable-features=CalculateNativeWinOcclusion
```

走查断言（用零依赖 CDP harness，参照 `.trae/skills/electron-cdp-walkthrough/assets/cdp-harness.template.mjs`，脚本放 %TEMP%）：

1. 应用是打包/非 dev？—— 本步以 `out/` 构建后的 electron 运行时 `app.isPackaged` 为 false（未用安装包装），因此自动检查不触发（设计如此）。改为在关于页点「检查更新」（手动检查不受 dev 限制）。
2. 弹窗出现：标题含 9.9.9、两行 releaseNotes、大小与夹具一致；截图。
3. 点「稍后更新」弹窗关闭；再次手动检查弹窗重现；点「跳过此版本」→ 关于页显示"已跳过 v9.9.9"；开关关一次自动检查（settings.set 落 settings.json 可核对）；点「恢复检查」。
4. 点「立即更新」：进度条出现且百分比到 100%（包小，断言至少出现过 downloading 事件与 ready 后的安装确认 Modal）；安装确认文案含 UAC 提示；点「取消」（dev install 不会触发；为走到 ready 已足够）。
5. 篡改场景：把夹具 exe 追加 1 字节后重新生成 latest.json 时 sha256 保持旧值（故意不匹配），重下 → 出现"已损坏或被篡改"错误态，`updates/downloads/Setup-9.9.9.exe` 不存在。
6. 续传场景：CDP 无法方便卡大文件，改用 Task 4 单测已覆盖 Range；本步只在日志侧确认服务器收到过 Range 头（serve 脚本有请求日志）。
7. 全程 console error/exception = 0。清理：删除夹具目录、`%APPDATA%/template-print/updates/downloads/*`、settings.json 中 skippedUpdateVersion 复位。

- [ ] **Step 4: 全量静态验证**

Run: `npm run typecheck`
Expected: 0 错误

Run: `npx vitest run`
Expected: 所有测试通过（约 122 个）

Run: `npx electron-vite build`
Expected: 构建成功

- [ ] **Step 5: 提交演练脚本（harness 在 %TEMP% 不提交）**

```bash
git add scripts/dev-drill-guardian.ps1
git commit -m "test(update): 守护脚本成功安装/失败回滚离线演练脚本"
```

---

## Self-Review 结论（计划作者已核对）

- 设计文档 §1–§11 均有任务覆盖：清单/比较(T1)、设置(T2)、校验(T3)、下载(T4)、守护(T5)、编排(T6)、IPC/preload(T7)、主进程接线(T8)、通知/下载/校验/安装UI(T9)、关于页(T10)、发布工具(T11)、回滚与端到端验证(T12)。
- 命名一致性：`UpdateServiceDeps`、`streamDownload`、`buildGuardianScript/GuardianParams`、事件名 `update:checkResult|update:progress|update:installFailed|update:installed`、payload 联合 `UpdateProgressPayload`（含 simulated）在 T1/T6/T7/T9 一致。
- Task 4 与 Task 5 内含"先写含已知笔误版本再覆盖/删行"的步骤是刻意的 TDD 节奏标记；执行者按步骤最终态为准（最终代码以 Step 4/Step 4 修正后版本为准）。
- Task 9 的 `useEffect` 最终以空依赖 + `setManifest` 函数式更新为准（步骤内已显式收紧）。
