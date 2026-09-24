# 模板打印程序 M3（打磨）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 历史组合筛选增强、失败任务一键直接重发、历史清理（手动+按保留期自动）、数据库自动备份、内置示例模板、自定义纸张静默直打引导。

**Architecture:** 沿用 M1/M2 分层。新增 AppSettings 业务字段与 `settings:get/set` IPC（白名单）作为清理/备份/种子/纸张提示的共同基础；JobRepository 增加状态/打印机过滤与删除；BackupService 用 better-sqlite3 原生 backup API；SeedService 在首次启动幂等插入内置模板；纸张提示由渲染端在静默直打前按标准尺寸白名单拦截。

**Tech Stack:** 同 M2（Electron 31 / React 18 / AntD 5 / Drizzle 0.33 / better-sqlite3 12 / Vitest），无新增第三方依赖。Node 24 + npm；测试 `npm test`，tsc `npm run typecheck`；ABI 切换 `npm run bin:node`/`npm run bin:electron`。

**明确不做（沿用 2026-09-23 决策）：条码/二维码生成器。**

**继承事实：**

- settings.ts 现有 AppSettings 仅 `{ defaultPrinterName }`，loadSettings 以 DEFAULTS 浅合并，旧 settings.json 自动获得新字段默认值。
- JobRepository.list 已支持 templateId/from/to/keyword；status 列合法值 success/failed/cancelled。
- 历史页 reprint 已把快照+参数送入打印页（fromHistory=true）。
- PrintService.submit 对历史快照中已删除的图片资产会抛错（渲染端 catch 提示）。
- main/index.ts whenReady 是启动钩子；paths() 提供 dataDir/dbFile。
- 测试在 tests/ 下镜像目录；临时 DB 用 tmpdir（参照 tests/db/repositories.test.ts）。

---

## 文件结构（M3 新增/修改）

```
electron/main/settings.ts                    修改：AppSettings 扩字段 + patchSettings/业务键白名单
electron/main/services/
  settings-service.ts                        新增：get/patch IPC（白名单）
  history-service.ts                         修改：cleanup（删记录+缩略图）、retentionDays 启动清理
  backup-service.ts                          新增：backupNow/prune/每日自动备份
  seed-service.ts                            新增：内置示例模板幂等播种
electron/main/ipc/index.ts                   修改：Services 扩展与新 handler
electron/main/index.ts                       修改：装配 + 启动清理/备份/种子
shared/ipc-contract.ts                       修改：settings/jobs.cleanup/backup 通道与类型
electron/preload/index.ts                    修改：白名单
db/repositories/job-repo.ts                  修改：statuses/printerName 过滤、deleteOlderThan/deleteAll
shared/paper-presets.ts                      修改：STANDARD_DRIVER_SIZES 标准驱动尺寸白名单
src/renderer/pages/history.tsx               修改：状态多选/打印机下拉/重置/计数 + 直接重发
src/renderer/pages/settings.tsx              修改：历史清理卡片 + 数据备份卡片
src/renderer/pages/print.tsx                 修改：自定义纸张静默直打引导
tests/main/settings.test.ts                  修改：patchSettings 白名单测试
tests/db/repositories.test.ts                修改：组合过滤/删除测试
tests/main/backup-service.test.ts            新增：备份与保留份数
tests/main/seed-service.test.ts              新增：播种规格与幂等
```

---

## Task 1: AppSettings 扩展与 settings:get/set IPC

**Files:**

- Modify: `electron/main/settings.ts`, `shared/ipc-contract.ts`, `electron/preload/index.ts`
- Create: `electron/main/services/settings-service.ts`
- Modify: `electron/main/ipc/index.ts`, `electron/main/index.ts`
- Test: `tests/main/settings.test.ts`

- [ ] **Step 1: 扩展 AppSettings（带默认值与业务键白名单）**

`electron/main/settings.ts` 整体替换为：

```ts
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

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
}

const DEFAULTS: AppSettings = {
  defaultPrinterName: null,
  seededTemplatesVersion: null,
  historyRetentionDays: null,
  lastBackupAt: null,
  paperHintsConfirmed: []
}

/** 渲染端允许通过 settings:set 修改的业务键（defaultPrinterName 走专用通道） */
export const SETTABLE_KEYS = [
  'historyRetentionDays',
  'paperHintsConfirmed'
] as const
export type SettableKey = (typeof SETTABLE_KEYS)[number]

export function loadSettings(dataDir: string): AppSettings {
  try {
    const raw = readFileSync(join(dataDir, 'settings.json'), 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(dataDir: string, s: AppSettings): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(s, null, 2), 'utf-8')
}

/**
 * 合并渲染端提交的部分字段；仅允许白名单键，且做基本类型校验。
 * 返回合并后的完整设置（调用方负责落盘）。
 */
export function patchSettings(current: AppSettings, patch: Record<string, unknown>): AppSettings {
  const next: AppSettings = { ...current }
  for (const key of SETTABLE_KEYS) {
    if (!(key in patch)) continue
    const v = patch[key]
    if (key === 'historyRetentionDays') {
      if (v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        next.historyRetentionDays = v === 0 ? null : (v as number)
      }
    } else if (key === 'paperHintsConfirmed') {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        next.paperHintsConfirmed = v as string[]
      }
    }
  }
  return next
}
```

注意：`seededTemplatesVersion` 与 `lastBackupAt` 只由主进程内部写（SeedService/BackupService 直接 saveSettings），不进 SETTABLE_KEYS。

- [ ] **Step 2: 契约与 preload**

`shared/ipc-contract.ts` IPC 常量加：

```ts
settingsGet: 'settings:get',
settingsSet: 'settings:set',
```

为避免与主进程 settings.ts（含 node fs）耦合，DTO 类型在 shared 侧新建 `shared/settings-dto.ts`：

```ts
export interface AppSettingsDto {
  defaultPrinterName: string | null
  seededTemplatesVersion: string | null
  historyRetentionDays: number | null
  lastBackupAt: number | null
  paperHintsConfirmed: string[]
}
export type SettingsPatch = Partial<Pick<AppSettingsDto, 'historyRetentionDays' | 'paperHintsConfirmed'>>
```

ipc-contract.ts 顶部 import：

```ts
import type { AppSettingsDto, SettingsPatch } from './settings-dto'
```

Api 接口加（thumbUrl 之前的位置）：

```ts
settings: {
  get(): Promise<AppSettingsDto>
  set(patch: SettingsPatch): Promise<AppSettingsDto>
}
```

preload 加：

```ts
settings: {
  get: () => ipcRenderer.invoke(IPC.settingsGet),
  set: (patch: unknown) => ipcRenderer.invoke(IPC.settingsSet, patch)
}
```

- [ ] **Step 3: SettingsService + IPC**

`electron/main/services/settings-service.ts`：

```ts
import { ipcMain } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import type { AppSettingsDto, SettingsPatch } from '../../../shared/settings-dto'
import { loadSettings, saveSettings, patchSettings, type AppSettings } from '../settings'
import type { Services } from '../ipc'

export class SettingsService {
  constructor(private dataDir: string) {}
  get(): AppSettings {
    return loadSettings(this.dataDir)
  }
  set(patch: SettingsPatch): AppSettings {
    const next = patchSettings(loadSettings(this.dataDir), patch as Record<string, unknown>)
    saveSettings(this.dataDir, next)
    return next
  }
}

export function registerSettingsHandlers(deps: Services): void {
  const svc = deps.settings
  ipcMain.removeHandler(IPC.settingsGet)
  ipcMain.handle(IPC.settingsGet, (): AppSettingsDto => svc.get())
  ipcMain.removeHandler(IPC.settingsSet)
  ipcMain.handle(IPC.settingsSet, (_e, patch: SettingsPatch): AppSettingsDto => svc.set(patch))
}
```

`electron/main/ipc/index.ts` 的 Services 加 `settings: SettingsService`；registerIpc 调 registerSettingsHandlers（PrinterService/HistoryService 等后续任务改为从 settings 读配置时复用 deps.settings）。

main/index.ts 装配：`const settingsSvc = new SettingsService(p.dataDir)`，传入 Services。

- [ ] **Step 4: 测试（TDD）**

在 `tests/main/settings.test.ts` 追加：

```ts
import { patchSettings, loadSettings, type AppSettings } from '../../electron/main/settings'

const base: AppSettings = {
  defaultPrinterName: 'p1',
  seededTemplatesVersion: null,
  historyRetentionDays: null,
  lastBackupAt: null,
  paperHintsConfirmed: []
}

describe('patchSettings', () => {
  it('允许修改保留天数（0 归一为 null）', () => {
    expect(patchSettings(base, { historyRetentionDays: 90 }).historyRetentionDays).toBe(90)
    expect(patchSettings(base, { historyRetentionDays: 0 }).historyRetentionDays).toBeNull()
    expect(patchSettings(base, { historyRetentionDays: -3 }).historyRetentionDays).toBeNull()
  })
  it('允许替换已确认提示列表', () => {
    const s = patchSettings(base, { paperHintsConfirmed: ['a|40x30'] })
    expect(s.paperHintsConfirmed).toEqual(['a|40x30'])
  })
  it('忽略白名单外键与非法类型', () => {
    const s = patchSettings(base, { defaultPrinterName: 'x', paperHintsConfirmed: [1, 2] } as never)
    expect(s.defaultPrinterName).toBe('p1')
    expect(s.paperHintsConfirmed).toEqual([])
  })
  it('旧 settings.json 缺字段时 loadSettings 补默认值', () => {
    const dir = join(tmpdir(), `tp-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultPrinterName: 'old' }))
    const s = loadSettings(dir)
    expect(s.defaultPrinterName).toBe('old')
    expect(s.paperHintsConfirmed).toEqual([])
    expect(s.historyRetentionDays).toBeNull()
  })
})
```

（文件顶部已有部分 import；补齐 join/tmpdir/mkdirSync/writeFileSync 与新 import；原有 3 个用例保留。）

Run: `npx vitest run tests/main/settings.test.ts` → 全绿。

- [ ] **Step 5: 验证与提交**

`npm run typecheck` 0 错误；`npx electron-vite build` 成功；`npx vitest run` 全绿。

```bash
git add electron shared tests
git commit -m "feat(settings): 应用设置扩字段与 settings:get/set 白名单 IPC"
```

---

## Task 2: 历史组合筛选增强（状态多选 + 打印机 + 重置 + 计数）

**Files:**

- Modify: `db/repositories/job-repo.ts`, `shared/ipc-contract.ts`, `electron/main/services/history-service.ts`
- Modify: `src/renderer/pages/history.tsx`
- Test: `tests/db/repositories.test.ts`

- [ ] **Step 1: JobFilter 扩展（TDD）**

job-repo.ts 的 JobFilter 加字段：

```ts
export interface JobFilter {
  templateId?: string
  from?: number
  to?: number
  keyword?: string
  statuses?: JobStatus[]
  printerName?: string
}
```

list 的 SQL 条件增加（import 增加 inArray）：

```ts
import { eq, gte, desc, and, inArray, type SQL } from 'drizzle-orm'
```

```ts
    if (filter.statuses && filter.statuses.length > 0) {
      conds.push(inArray(printJobs.status, filter.statuses as string[]))
    }
    if (filter.printerName) conds.push(eq(printJobs.printerName, filter.printerName))
```

在 tests/db/repositories.test.ts 的 describe('JobRepository') 中追加用例：

```ts
  it('list 支持状态多选与打印机过滤的组合', () => {
    const snap = sample('s1')
    const mk = (id: string, status: 'failed' | 'success' | 'cancelled', printer: string, ts: number) => ({
      id, templateId: 't1', templateNameSnapshot: '证书', templateSnapshot: snap,
      paramValues: { name: `X${id}` }, thumbPath: null, printerName: printer, copies: 1,
      printMode: 'silent' as const, status, errorMessage: status === 'failed' ? 'e' : null, createdAt: ts
    })
    jobs.insert(mk('j1', 'success', 'HP', 2000))
    jobs.insert(mk('j2', 'failed', 'HP', 1000))
    jobs.insert(mk('j3', 'cancelled', 'Epson', 3000))
    expect(jobs.list({ statuses: ['failed', 'cancelled'] }).map((j) => j.id).sort()).toEqual(['j2', 'j3'])
    expect(jobs.list({ printerName: 'HP' }).map((j) => j.id).sort()).toEqual(['j1', 'j2'])
    expect(jobs.list({ statuses: ['success'], printerName: 'HP' }).map((j) => j.id)).toEqual(['j1'])
  })
```

（snap 参数引用既有 sample('s1') 的返回；注意 sample 内参数 id=name='name' 已满足复合主键。）

Run: `npx vitest run tests/db/repositories.test.ts` → 全绿。

- [ ] **Step 2: 契约与 service 透传**

ipc-contract.ts 的 jobs.list filter 类型替换为共享类型。在 shared 新建（或直接内联到 ipc-contract）：

```ts
export interface JobListFilter {
  templateId?: string
  from?: number
  to?: number
  keyword?: string
  statuses?: ('success' | 'failed' | 'cancelled')[]
  printerName?: string
}
```

Api.jobs.list(filter?: JobListFilter)。history-service.ts 的 list 参数类型同步为 JobListFilter。

preload 无需改（已是 `(filter?: unknown)` 透传）。

- [ ] **Step 3: 历史页筛选 UI**

history.tsx 修改：

a. state 增加：

```tsx
const [statuses, setStatuses] = useState<string[]>([])
const [printerName, setPrinterName] = useState<string | undefined>(undefined)
const [printerOptions, setPrinterOptions] = useState<string[]>([])
```

b. 挂载时取一次全量记录用于聚合打印机选项（在既有 templates useEffect 旁）：

```tsx
useEffect(() => {
  void api.jobs.list({}).then((all) => {
    setPrinterOptions([...new Set(all.map((j) => j.printerName).filter(Boolean))].sort())
  })
}, [])
```

c. refresh 的 filter 加 statuses/printerName；依赖数组加两者。

```tsx
await api.jobs.list({ templateId, from: ..., to: ..., keyword: keyword || undefined,
  statuses: statuses.length ? (statuses as JobStatus[]) : undefined, printerName })
```

（JobStatus 从 db/repositories/job-repo import type。）

d. 筛选条增加状态多选、打印机下拉、重置按钮，并显示计数：

```tsx
<Select mode="multiple" allowClear placeholder="全部状态" style={{ minWidth: 150 }} maxTagCount="responsive"
  value={statuses} onChange={(v) => setStatuses(v)}
  options={[
    { value: 'success', label: '成功' },
    { value: 'failed', label: '失败' },
    { value: 'cancelled', label: '已取消' }
  ]} />
<Select allowClear placeholder="全部打印机" style={{ width: 170 }} value={printerName}
  onChange={(v) => setPrinterName(v)}
  options={printerOptions.map((n) => ({ value: n, label: n }))} />
<Button onClick={() => {
  setTemplateId(undefined); setRange(null); setKeyword(''); setStatuses([]); setPrinterName(undefined)
}}>重置</Button>
<span style={{ color: '#888' }}>共 {jobs.length} 条</span>
```

- [ ] **Step 4: 验证与提交**

`npx vitest run` 全绿；tsc 0；build 成功。

```bash
git add db shared electron src tests
git commit -m "feat(history): 状态多选/打印机组合筛选、重置与结果计数"
```

---

## Task 3: 失败任务一键直接重发

**Files:**

- Modify: `src/renderer/pages/history.tsx`

纯渲染端任务：失败行在"重打"（跳表单）之外增加"直接重发"（用原快照/参数/打印机/份数立即再提交一次）。

- [ ] **Step 1: 实现直接重发**

history.tsx 顶部 import 增加 Modal（已有 Button 等）：

```tsx
import { Button, DatePicker, Image, Input, Modal, Select, Space, Table, Tag, Tooltip, message } from 'antd'
```

组件内加：

```tsx
const [resending, setResending] = useState<string | null>(null)

async function resendNow(job: JobListItem): Promise<void> {
  setResending(job.id)
  try {
    const res = await api.print.submit({
      template: job.templateSnapshot,
      paramValues: job.paramValues,
      printerName: job.printerName,
      copies: job.copies,
      mode: job.printMode
    })
    if (res.status === 'success') message.success('已重新发送打印任务')
    else if (res.status === 'cancelled') message.info('已取消')
    else message.error(`仍然失败：${res.errorMessage ?? '未知错误'}`)
    await refresh()
  } catch (e) {
    message.error(`重发失败：${e instanceof Error ? e.message : String(e)}（可改用“重打”进入打印页调整）`)
  } finally {
    setResending(null)
  }
}
```

操作列改为：

```tsx
{
  title: '操作', width: 130,
  render: (_, r) => (
    <Space size={0}>
      {r.status === 'failed' && (
        <Button size="small" type="link" loading={resending === r.id}
          onClick={() => Modal.confirm({
            title: '直接重发此任务？',
            content: `将使用原参数发送到打印机“${r.printerName}”。如需修改参数或打印机，请用“重打”。`,
            okText: '直接重发', cancelText: '取消',
            onOk: () => resendNow(r)
          })}>直接重发</Button>
      )}
      <Button size="small" type="link" onClick={() => reprint(r)}>
        {r.status === 'failed' ? '重打（可修改）' : '重打'}
      </Button>
    </Space>
  )
}
```

- [ ] **Step 2: 验证与提交**

tsc 0；build 成功；`npx vitest run` 不回归。

```bash
git add src/renderer/pages/history.tsx
git commit -m "feat(history): 失败任务一键直接重发（保留可修改重打）"
```

---

## Task 4: 打印历史清理（手动 + 按保留期启动自动清理）

**Files:**

- Modify: `db/repositories/job-repo.ts`, `shared/ipc-contract.ts`, preload, `electron/main/services/history-service.ts`, `electron/main/ipc/index.ts`, `electron/main/index.ts`, `src/renderer/pages/settings.tsx`
- Test: `tests/db/repositories.test.ts`

- [ ] **Step 1: 仓储删除方法（TDD）**

job-repo.ts 加：

```ts
/** 删除指定时间之前（不含）的记录，返回被删行（供上层清理缩略图） */
deleteOlderThan(ts: number): JobRow[] {
  const rows = this.db.select().from(printJobs).where(lt(printJobs.createdAt, ts)).all() as unknown as JobRow[]
  this.db.delete(printJobs).where(lt(printJobs.createdAt, ts)).run()
  return rows
}

/** 清空全部记录，返回被删行 */
deleteAll(): JobRow[] {
  const rows = this.db.select().from(printJobs).all() as unknown as JobRow[]
  this.db.delete(printJobs).run()
  return rows
}

/** 计数 */
count(): number {
  return (this.db.select().from(printJobs).all() as unknown[]).length
}
```

drizzle import 加 `lt`。

测试追加：

```ts
  it('deleteOlderThan/deleteAll/count', () => {
    const snap = sample('s1')
    const mk = (id: string, ts: number) => ({
      id, templateId: 't1', templateNameSnapshot: '证书', templateSnapshot: snap,
      paramValues: {}, thumbPath: null, printerName: 'HP', copies: 1,
      printMode: 'silent' as const, status: 'success' as const, errorMessage: null, createdAt: ts
    })
    jobs.insert(mk('old', 1000)); jobs.insert(mk('new', 5000))
    const removed = jobs.deleteOlderThan(2000)
    expect(removed.map((r) => r.id)).toEqual(['old'])
    expect(jobs.count()).toBe(1)
    expect(jobs.deleteAll().length).toBe(1)
    expect(jobs.count()).toBe(0)
  })
```

- [ ] **Step 2: service cleanup + IPC**

shared/ipc-contract.ts：

```ts
jobsCleanup: 'jobs:cleanup',
jobsCount: 'jobs:count',
```

Api.jobs 加：

```ts
cleanup(input: { olderThanDays?: number }): Promise<{ deletedJobs: number; deletedThumbs: number }>
count(): Promise<number>
```

（olderThanDays 缺省/0 表示清空全部。）

history-service.ts 加（构造注入 settings：`constructor(private dataDir, private jobs: JobRepository, private settings: SettingsService)`）：

```ts
import { unlinkSync } from 'node:fs'
import type { SettingsService } from './settings-service'

cleanup(input: { olderThanDays?: number }): { deletedJobs: number; deletedThumbs: number } {
  const rows = input.olderThanDays && input.olderThanDays > 0
    ? this.jobs.deleteOlderThan(Date.now() - input.olderThanDays * 86_400_000)
    : this.jobs.deleteAll()
  let deletedThumbs = 0
  for (const r of rows) {
    if (r.thumbPath) {
      try { unlinkSync(this.thumbAbs(r.thumbPath)); deletedThumbs++ } catch { /* 已无文件 */ }
    }
  }
  return { deletedJobs: rows.length, deletedThumbs }
}

count(): number {
  return this.jobs.count()
}

/** 启动时按设置的保留天数清理；null/0 不清理 */
runScheduledCleanup(): { deletedJobs: number; deletedThumbs: number } | null {
  const days = this.settings.get().historyRetentionDays
  if (!days || days <= 0) return null
  return this.cleanup({ olderThanDays: days })
}

private thumbAbs(relOrAbs: string): string {
  return relOrAbs.includes(this.dataDir) ? relOrAbs : join(this.dataDir, relOrAbs)
}
```

把 thumbDataUrl 中的路径拼接改用 this.thumbAbs（DRY）。

handlers：

```ts
ipcMain.removeHandler(IPC.jobsCleanup)
ipcMain.handle(IPC.jobsCleanup, (_e, input: { olderThanDays?: number }) => svc.cleanup(input ?? {}))
ipcMain.removeHandler(IPC.jobsCount)
ipcMain.handle(IPC.jobsCount, () => svc.count())
```

preload jobs 对象加 cleanup/count。

main/index.ts：HistoryService 构造传入 settingsSvc（调整实例化顺序：settingsSvc 先于 history）；whenReady 内 registerIpc 后调用 `history.runScheduledCleanup()`。

- [ ] **Step 3: 设置页"打印历史"卡片**

settings.tsx 增加（独立 Card，放在打印机卡片标题区上方或下方）：

```tsx
function HistoryCard(): JSX.Element {
  const [count, setCount] = useState(0)
  const [days, setDays] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshCount = useCallback(() => { void api.jobs.count().then(setCount) }, [])
  useEffect(() => {
    refreshCount()
    void api.settings.get().then((s) => setDays(s.historyRetentionDays))
  }, [refreshCount])

  async function saveDays(v: number | null): Promise<void> {
    setDays(v)
    await api.settings.set({ historyRetentionDays: v })
    message.success('保留设置已保存；下次启动时自动清理')
  }
  async function doCleanup(olderThanDays?: number): Promise<void> {
    setBusy(true)
    try {
      const r = await api.jobs.cleanup({ olderThanDays })
      message.success(`已删除 ${r.deletedJobs} 条记录、${r.deletedThumbs} 张缩略图`)
      refreshCount()
    } finally { setBusy(false) }
  }

  return (
    <Card size="small" title="打印历史" style={{ marginBottom: 12 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <span style={{ color: '#666' }}>当前共 <b>{count}</b> 条打印记录</span>
        <Space wrap>
          <span>自动清理：</span>
          <Select size="small" style={{ width: 150 }} value={days ?? 0}
            onChange={(v) => void saveDays(v === 0 ? null : v)}
            options={[
              { value: 0, label: '不自动清理' },
              { value: 30, label: '保留 30 天' },
              { value: 90, label: '保留 90 天' },
              { value: 180, label: '保留 180 天' },
              { value: 365, label: '保留 1 年' }
            ]} />
        </Space>
        <Space wrap>
          <Button size="small" loading={busy}
            onClick={() => Modal.confirm({
              title: '清理 90 天前的记录？',
              content: '将同时删除对应的缩略图文件，此操作不可恢复。',
              okText: '清理', okButtonProps: { danger: true }, cancelText: '取消',
              onOk: () => doCleanup(90)
            })}>清理 90 天前</Button>
          <Button size="small" loading={busy}
            onClick={() => Modal.confirm({
              title: '清空全部打印历史？',
              content: '将删除所有记录与缩略图，此操作不可恢复。',
              okText: '全部清空', okButtonProps: { danger: true }, cancelText: '取消',
              onOk: () => doCleanup()
            })}>清空全部</Button>
        </Space>
      </Space>
    </Card>
  )
}
```

设置页顶部 import 补 Modal/Select/useCallback/useEffect/useState（useState/useEffect 已有）；在打印机标题区上方渲染 `<HistoryCard />`。

- [ ] **Step 4: 验证与提交**

`npx vitest run`（含新 repo 用例）；tsc 0；build。

```bash
git add db shared electron src tests
git commit -m "feat(history): 手动清理/按保留期启动自动清理并回收缩略图"
```

---

## Task 5: 数据库自动备份

**Files:**

- Create: `electron/main/services/backup-service.ts`
- Modify: `shared/ipc-contract.ts`, preload, `electron/main/ipc/index.ts`, `electron/main/index.ts`, `electron/main/app-paths.ts`, `src/renderer/pages/settings.tsx`
- Test: `tests/main/backup-service.test.ts`

- [ ] **Step 1: app-paths 增加 backupsDir**

```ts
mkdirSync(join(dataDir, 'backups'), { recursive: true })
// 返回对象加：
backupsDir: join(dataDir, 'backups')
```

- [ ] **Step 2: BackupService（TDD 纯保留逻辑 + 集成备份）**

`electron/main/services/backup-service.ts`：

```ts
import { ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { readdirSync, unlinkSync, existsSync } from 'node:fs'
import { IPC } from '../../../shared/ipc-contract'
import { loadSettings, saveSettings } from '../settings'
import type { DbClient } from '../../../db/client'
import type { Services } from '../ipc'

const KEEP = 7

/** 从备份文件名列表（backup-YYYYMMDD-HHmmss.db）选出应删除的旧文件（保留最新 keep 份） */
export function pickPruned(fileNames: string[], keep = KEEP): string[] {
  const sorted = fileNames
    .filter((f) => /^backup-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse() // 新→旧
  return sorted.slice(keep)
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export class BackupService {
  constructor(private dataDir: string, private backupsDir: string, private client: DbClient) {}

  /** 立即备份：better-sqlite3 原生在线备份，完成后按 KEEP 清理旧文件，返回新文件路径 */
  async backupNow(): Promise<string> {
    const file = join(this.backupsDir, `backup-${stamp(new Date())}.db`)
    await this.client.sqlite.backup(file)
    this.prune()
    return file
  }

  /** 同一天只自动备份一次；返回是否执行了备份 */
  async runDaily(): Promise<boolean> {
    const s = loadSettings(this.dataDir)
    const todayStart = new Date().setHours(0, 0, 0, 0)
    if (s.lastBackupAt && s.lastBackupAt >= todayStart) return false
    await this.backupNow()
    saveSettings(this.dataDir, { ...s, lastBackupAt: Date.now() })
    return true
  }

  openBackupsDir(): void {
    void shell.openPath(this.backupsDir)
  }

  private prune(): void {
    if (!existsSync(this.backupsDir)) return
    const files = readdirSync(this.backupsDir)
    for (const f of pickPruned(files, KEEP)) {
      try { unlinkSync(join(this.backupsDir, f)) } catch { /* ignore */ }
    }
  }
}

export function registerBackupHandlers(deps: Services): void {
  const svc = deps.backups
  ipcMain.removeHandler(IPC.backupRun)
  ipcMain.handle(IPC.backupRun, () => svc.backupNow())
  ipcMain.removeHandler(IPC.backupOpen)
  ipcMain.handle(IPC.backupOpen, () => svc.openBackupsDir())
}
```

`tests/main/backup-service.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { pickPruned } from '../../electron/main/services/backup-service'
import { createDb } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { BackupService } from '../../electron/main/services/backup-service'
import { loadSettings, saveSettings } from '../../electron/main/settings'

describe('pickPruned', () => {
  it('非备份文件忽略；超出保留份数的旧文件被选中', () => {
    const names = ['notabackup.db', 'backup-20260918-090000.db', 'backup-20260920-090000.db',
      'backup-20260922-090000.db', 'backup-20260923-090000.db', 'backup-20260924-090000.db',
      'backup-20260921-090000.db', 'backup-20260919-090000.db']
    expect(pickPruned(names, 5).sort()).toEqual(
      ['backup-20260918-090000.db', 'backup-20260919-090000.db', 'backup-20260920-090000.db'].sort()
    )
    expect(pickPruned(names, 5)).not.toContain('notabackup.db')
  })
})

describe('BackupService', () => {
  it('backupNow 生成可打开的 db 文件，runDaily 同一天只执行一次', async () => {
    const dataDir = join(tmpdir(), `tp-bak-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const backupsDir = join(dataDir, 'backups')
    mkdirSync(backupsDir, { recursive: true })
    const client = createDb(join(dataDir, 'app.db'))
    runMigrations(client)
    const svc = new BackupService(dataDir, backupsDir, client)
    const f1 = await svc.backupNow()
    expect(existsSync(f1)).toBe(true)
    saveSettings(dataDir, { ...loadSettings(dataDir), lastBackupAt: Date.now() })
    expect(await svc.runDaily()).toBe(false)
    saveSettings(dataDir, { ...loadSettings(dataDir), lastBackupAt: Date.now() - 2 * 86_400_000 })
    expect(await svc.runDaily()).toBe(true)
    client.sqlite.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
})
```

Run: `npx vitest run tests/main/backup-service.test.ts` → 全绿。

- [ ] **Step 3: 契约/装配/IPC**

ipc-contract 加常量与 Api：

```ts
backupRun: 'backup:run',
backupOpen: 'backup:open',
```

```ts
backups: {
  run(): Promise<string>
  openDir(): Promise<void>
}
```

Services 加 `backups: BackupService`；main/index.ts：`const backupsSvc = new BackupService(p.dataDir, p.backupsDir, client)`；registerIpc 注册；whenReady 末尾 `void backupsSvc.runDaily()`（不 await 阻塞窗口）。

preload：

```ts
backups: {
  run: () => ipcRenderer.invoke(IPC.backupRun),
  openDir: () => ipcRenderer.invoke(IPC.backupOpen)
}
```

- [ ] **Step 4: 设置页"数据备份"卡片**

settings.tsx 增加：

```tsx
function BackupCard(): JSX.Element {
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void api.settings.get().then((s) => setLastAt(s.lastBackupAt)) }, [])
  return (
    <Card size="small" title="数据备份" style={{ marginBottom: 12 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <span style={{ color: '#666' }}>
          上次自动备份：{lastAt ? dayjs(lastAt).format('YYYY-MM-DD HH:mm') : '尚未备份'}（每天首次启动自动备份，保留最近 7 份）
        </span>
        <Space>
          <Button size="small" type="primary" loading={busy} onClick={async () => {
            setBus(true)
            try {
              const f = await api.backups.run()
              message.success('备份完成：' + f.split(/[\\/]/).pop())
              setLastAt(Date.now())
            } finally { setBusy(false) }
          }}>立即备份</Button>
          <Button size="small" onClick={() => void api.backups.openDir()}>打开备份目录</Button>
        </Space>
      </Space>
    </Card>
  )
}
```

（dayjs 在该页需 import。）渲染于 HistoryCard 上方。

- [ ] **Step 5: 验证与提交**

`npx vitest run` 全绿；tsc 0；build。

```bash
git add electron shared src tests
git commit -m "feat(backup): 每日自动/立即数据库备份，保留最近 7 份"
```

---

## Task 6: 内置示例模板（首次启动播种）

**Files:**

- Create: `electron/main/services/seed-service.ts`
- Modify: `electron/main/index.ts`, `electron/main/ipc/index.ts`
- Test: `tests/main/seed-service.test.ts`

- [ ] **Step 1: 种子规格与服务（TDD）**

`electron/main/services/seed-service.ts`（完整最终代码，元素直接用普通对象工厂构造固定 id，不用 createElement——它会生成随机 id；createParamDef 是**单参数**函数，字段合并在一个对象里传入）：

```ts
import { createTemplate, createParamDef, TemplateDocumentSchema, type TemplateDocument, type TemplateElement } from '../../../print-core/template-model'
import { loadSettings, saveSettings } from '../settings'
import type { TemplateService } from './template-service'

/** 播种版本：内置模板内容变更时递增，触发重新幂等播种 */
export const SEED_VERSION = 'm3-v1'
/** 内置模板固定 id 前缀，便于幂等 */
export const SEED_PREFIX = 'builtin-'

const geo = (id: string, x: number, y: number, w: number, h: number, z: number) =>
  ({ id, x, y, w, h, rotation: 0, locked: false, zIndex: z })

function t(id: string, x: number, y: number, w: number, h: number, z: number,
  props: Record<string, unknown>): TemplateElement {
  return { type: 'text', ...geo(id, x, y, w, h, z), props } as TemplateElement
}
function param(id: string, x: number, y: number, w: number, h: number, z: number, key: string, fontSizeMm = 4): TemplateElement {
  return {
    type: 'param', ...geo(id, x, y, w, h, z),
    props: { paramId: key, fontFamily: 'Microsoft YaHei', fontSizeMm, bold: false, align: 'left', color: '#000000', autoFit: true }
  } as TemplateElement
}
function rect(id: string, x: number, y: number, w: number, h: number, z: number, strokeWidthMm = 0.3): TemplateElement {
  return {
    type: 'shape', ...geo(id, x, y, w, h, z),
    props: { shape: 'rect', strokeColor: '#000000', strokeWidthMm, fillColor: null }
  } as TemplateElement
}
```

种子文档（用固定 id，zod 校验保证结构合法）：

```ts
export function seedSpecs(): TemplateDocument[] {
  const now = Date.now()
  const base = createTemplate('', '', { widthMm: 210, heightMm: 297 })

  const cert: TemplateDocument = TemplateDocumentSchema.parse({
    ...base,
    id: SEED_PREFIX + 'cert',
    name: '示例 · A4 荣誉证书',
    category: '示例',
    paper: { widthMm: 210, heightMm: 297, orientation: 'portrait', marginMm: { t: 0, r: 0, b: 0, l: 0 } },
    params: [
      createParamDef({ key: 'name', label: '姓名', type: 'text', required: true, order: 0 }),
      createParamDef({ key: 'date', label: '日期', type: 'date', required: false, defaultValue: 'today', order: 1 })
    ],
    content: {
      elements: [
        rect('box', 10, 10, 190, 277, 0, 0.6),
        t('title', 30, 40, 150, 16, 2, { text: '荣 誉 证 书', fontSizeMm: 12, bold: true, align: 'center' }),
        t('line1', 30, 110, 150, 8, 2, { text: '兹证明', align: 'left' }),
        param('p_name', 60, 130, 90, 8, 2, 'name', 6),
        t('line2', 30, 160, 150, 8, 2, { text: '在工作中表现优异，特发此证，以资鼓励。' }),
        param('p_date', 110, 250, 80, 8, 2, 'date', 4)
      ]
    },
    createdAt: now, updatedAt: now
  })

  const receipt: TemplateDocument = TemplateDocumentSchema.parse({
    ...base,
    id: SEED_PREFIX + 'receipt',
    name: '示例 · 80mm 收银小票',
    category: '示例',
    paper: { widthMm: 80, heightMm: 200, orientation: 'portrait', marginMm: { t: 0, r: 0, b: 0, l: 0 } },
    params: [
      createParamDef({ key: 'name', label: '商品/客户', type: 'text', order: 0 }),
      createParamDef({ key: 'amount', label: '金额', type: 'number', thousandsSeparator: true, order: 1 })
    ],
    content: {
      elements: [
        rect('box', 2, 2, 76, 196, 0),
        t('title', 5, 6, 70, 8, 2, { text: '收银小票', fontSizeMm: 5, bold: true, align: 'center' }),
        param('p_name', 5, 22, 70, 6, 2, 'name'),
        param('p_amt', 5, 32, 70, 6, 2, 'amount'),
        t('tip', 5, 180, 70, 6, 2, { text: '谢谢惠顾', align: 'center', color: '#666666' })
      ]
    },
    createdAt: now, updatedAt: now
  })

  const label: TemplateDocument = TemplateDocumentSchema.parse({
    ...base,
    id: SEED_PREFIX + 'label',
    name: '示例 · 40×30 价签',
    category: '示例',
    paper: { widthMm: 40, heightMm: 30, orientation: 'portrait', marginMm: { t: 0, r: 0, b: 0, l: 0 } },
    params: [
      createParamDef({ key: 'name', label: '品名', type: 'text', required: true, order: 0 }),
      createParamDef({ key: 'price', label: '价格', type: 'number', decimals: 2, order: 1 })
    ],
    content: {
      elements: [
        rect('box', 1, 1, 38, 28, 0),
        param('p_name', 2, 3, 36, 8, 2, 'name', 4.5),
        param('p_price', 2, 16, 36, 8, 2, 'price', 5)
      ]
    },
    createdAt: now, updatedAt: now
  })

  return [cert, receipt, label]
}
```

服务（幂等：按固定 id 查重，已存在则跳过；记录 SEED_VERSION）：

```ts
export class SeedService {
  constructor(private dataDir: string, private templates: TemplateService) {}
  async seedIfNeeded(): Promise<{ inserted: string[] }> {
    const s = loadSettings(this.dataDir)
    if (s.seededTemplatesVersion === SEED_VERSION) return { inserted: [] }
    const inserted: string[] = []
    for (const doc of seedSpecs()) {
      if (!(await this.templates.get(doc.id))) {
        await this.templates.save(doc)
        inserted.push(doc.id)
      }
    }
    saveSettings(this.dataDir, { ...s, seededTemplatesVersion: SEED_VERSION })
    return { inserted }
  }
}
```

- [ ] **Step 2: 测试**

`tests/main/seed-service.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb, type DbClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { AssetRepository } from '../../db/repositories/asset-repo'
import { TemplateService } from '../../electron/main/services/template-service'
import { AssetService } from '../../electron/main/services/asset-service'
import { SeedService, SEED_VERSION, seedSpecs, SEED_PREFIX } from '../../electron/main/services/seed-service'

describe('seedSpecs / SeedService', () => {
  let dataDir: string
  let client: DbClient
  let svc: TemplateService
  beforeEach(() => {
    dataDir = join(tmpdir(), `tp-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dataDir, { recursive: true })
    client = createDb(join(tmpdir(), `db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`))
    runMigrations(client)
    svc = new TemplateService(new TemplateRepository(client.db), new AssetService(dataDir, new AssetRepository(client.db)))
  })
  afterEach(() => { client.sqlite.close(); rmSync(dataDir, { recursive: true, force: true }) })

  it('三个规格均通过 zod 校验且含预期 id/参数/尺寸', () => {
    const specs = seedSpecs()
    expect(specs.map((s) => s.id).sort()).toEqual([SEED_PREFIX + 'cert', SEED_PREFIX + 'label', SEED_PREFIX + 'receipt'].sort())
    expect(specs.find((s) => s.id === SEED_PREFIX + 'receipt')?.paper.widthMm).toBe(80)
    expect(specs.find((s) => s.id === SEED_PREFIX + 'cert')?.params.map((p) => p.key)).toEqual(['name', 'date'])
  })

  it('首次播种插入 3 个；第二次幂等不重复', async () => {
    const seed = new SeedService(dataDir, svc)
    const r1 = await seed.seedIfNeeded()
    expect(r1.inserted).toHaveLength(3)
    const r2 = await seed.seedIfNeeded()
    expect(r2.inserted).toHaveLength(0)
    const list = await svc.list({})
    expect(list.filter((t) => t.category === '示例')).toHaveLength(3)
    expect(SEED_VERSION).toBeTruthy()
  })
})
```

Run: `npx vitest run tests/main/seed-service.test.ts` → 全绿。

- [ ] **Step 3: 启动装配**

main/index.ts：实例化 SeedService(dataDir, templatesSvc)；在 runMigrations 与服务装配之后、createWindow 前后均可，**await 放在 whenReady 链内**：

```ts
await seeds.seedIfNeeded()
history.runScheduledCleanup()
void backups.runDaily()
```

（顺序：播种 → 清理 → 备份；三者互不依赖，清理/备份不 await。）Services 无需加 seeds（无 IPC）。

- [ ] **Step 4: 验证与提交**

`npx vitest run` 全绿；tsc 0；build。

```bash
git add electron tests
git commit -m "feat(seed): 首次启动内置 A4 证书/80mm 小票/40×30 价签示例模板"
```

---

## Task 7: 自定义纸张静默直打引导

**Files:**

- Modify: `shared/paper-presets.ts`, `src/renderer/pages/print.tsx`

纯渲染端，无 IPC 新增（确认记录走 Task 1 的 settings.set）。

- [ ] **Step 1: 标准驱动尺寸白名单**

`shared/paper-presets.ts` 追加：

```ts
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
```

- [ ] **Step 2: 打印页引导**

print.tsx：

a. import：

```tsx
import { isStandardDriverPaper, paperHintKey } from '../../../shared/paper-presets'
```

b. state 区加（组件顶部其他 state 附近）：

```tsx
const [paperHintOpen, setPaperHintOpen] = useState(false)
const [paperHintCtx, setPaperHintCtx] = useState<{ key: string; w: number; h: number } | null>(null)
const [confirmedPaperHints, setConfirmedPaperHints] = useState<string[]>([])
useEffect(() => { void api.settings.get().then((s) => setConfirmedPaperHints(s.paperHintsConfirmed)) }, [])
```

c. 把 doPrint 的提交段抽成内部函数 `submitNow()`：即现有从 `const working ...` 到函数末尾（含 submit 与保存决策/跳转）整段，包装成：

```tsx
async function submitNow(): Promise<void> {
  const working: TemplateDocument = { ...doc!, printMode: mode, printerName }
  // ...原有逻辑不变（doc! 非空由 doPrint 开头保证）
}
```

d. 在状态拦截之后、submitNow 之前插入纸张引导（仅静默模式）：

```tsx
    // 自定义纸张静默直打引导（弹框模式由用户在系统对话框自选纸张，不提示）
    if (mode === 'silent' && doc && !isStandardDriverPaper(doc.paper.widthMm, doc.paper.heightMm)) {
      const key = paperHintKey(printerName, doc.paper.widthMm, doc.paper.heightMm)
      if (!confirmedPaperHints.includes(key)) {
        const proceed = await new Promise<boolean>((resolve) => {
          setPaperHintCtx({ key, w: doc.paper.widthMm, h: doc.paper.heightMm })
          setPaperHintOpen(true)
          paperHintResolve.current = resolve
        })
        if (!proceed) return
      }
    }
    await submitNow()
```

doPrint 原末尾的直接提交逻辑全部移入 submitNow；doPrint 在两个拦截后只调用 submitNow（纸张引导不命中时直接 await submitNow）。

e. 增加 resolve ref 与确认/取消处理：

```tsx
const paperHintResolve = useRef<((v: boolean) => void) | null>(null)

async function confirmPaperHint(dontAsk: boolean): Promise<void> {
  if (!paperHintCtx) return
  if (dontAsk) {
    const next = [...confirmedPaperHints, paperHintCtx.key]
    setConfirmedPaperHints(next)
    await api.settings.set({ paperHintsConfirmed: next })
  }
  setPaperHintOpen(false)
  paperHintResolve.current?.(true)
  paperHintResolve.current = null
}
function cancelPaperHint(): void {
  setPaperHintOpen(false)
  paperHintResolve.current?.(false)
  paperHintResolve.current = null
}
```

import 补 useRef（useState/useEffect/useMemo 已有）。

f. JSX（与保存决策 Modal 并列）：

```tsx
<Modal open={paperHintOpen} title="自定义纸张输出提示" okText="仍要打印" cancelText="取消"
  onOk={() => void confirmPaperHint(false)} onCancel={cancelPaperHint}>
  <p>当前模板纸张为 <b>{paperHintCtx?.w}×{paperHintCtx?.h} mm</b>，将静默发送到打印机“{printerName}”。</p>
  <p>若实际输出尺寸或位置不对：</p>
  <ol style={{ paddingLeft: 20 }}>
    <li>在 Windows「设置 → 蓝牙和设备 → 打印机和扫描仪」选中该打印机，进入「打印服务器属性」，按上面的毫米尺寸新建表单；</li>
    <li>在打印机首选项中选用该表单；或改用“弹框打印”，在系统对话框中确认纸张。</li>
  </ol>
  <Checkbox checked={false} onChange={(e) => e.target.checked && void confirmPaperHint(true)}>
    本次仍要打印，且以后对此打印机+尺寸不再提示
  </Checkbox>
</Modal>
```

Checkbox 的"勾选即确认并继续"交互：onChange 勾选时直接 confirmPaperHint(true)（Modal 随之关闭并提交）。import 补 Checkbox。

- [ ] **Step 3: 验证与提交**

`npx vitest run`（shared 纯函数可顺手加单测：见 Step 4）；tsc 0；build。

Step 4（TDD，新建 `tests/shared/paper-presets.test.ts`）：

```ts
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
```

提交：

```bash
git add shared src tests
git commit -m "feat(print): 自定义尺寸静默直打纸张引导（可按打印机+尺寸记住）"
```

---

## Task 8: M3 全量回归、CDP 走查与安装包

- [ ] **Step 1: 自动化回归**

`npm run bin:node` → `npm test`（全部通过，M3 新增：settings 4、job 过滤/删除 2、backup 3、seed 2、paper 3 共 14 个新用例）→ `npm run typecheck` 0 错误 → `npm run bin:electron` → `npx electron-vite build`。

- [ ] **Step 2: CDP 走查（主代理执行）**

覆盖：

1. 首次启动后模板列表含 3 个"示例"模板；二次启动不重复；
2. 历史页：状态多选/打印机下拉/重置/计数生效；
3. 失败记录出现"直接重发"与"重打（可修改）"；
4. 设置页：历史计数正确；清理 90 天前/清空（在测试数据上）删除记录与 thumbs 文件；保留天数设置写入 settings.json；
5. 立即备份生成 backups/backup-*.db；"上次自动备份"更新；
6. 打印页：80mm 小票模板静默直打时弹纸张引导；勾选"不再提示"后本次提交且下次不再弹；A4 模板不弹；
7. 全应用零 console 异常。

- [ ] **Step 3: 打包**

`npm run dist`，确认 release 新安装包生成、app.asar.unpacked 含 better_sqlite3.node。切回 node ABI。更新设计文档/项目记忆的 M3 完成状态。

---

## 自查记录

| 设计文档 M3 条目 | 任务 |
|---|---|
| 历史多条件组合筛选增强 | 2 |
| 失败重试（一键直接重发） | 3（修改后重打 M1 已有） |
| 历史清理（手动 + N 天保留） | 4 |
| 数据库自动备份 | 5 |
| 内置示例模板 | 6 |
| 自定义纸张驱动引导（§7.5） | 7 |
| 回归走查与安装包 | 8 |
| AppSettings 基础设施（支撑清理/备份/种子/纸张提示） | 1 |

**排除项**：条码/二维码生成（已移出产品范围）、从备份恢复 UI（M3 只提供备份文件与目录入口，恢复可手动替换 app.db）、流水号/下拉/图片参数、多用户。
