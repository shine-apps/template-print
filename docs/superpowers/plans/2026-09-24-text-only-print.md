# 仅打印文本（预印纸套打）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 模板增加「仅打印文本」选项（按模板记忆、默认勾选），启用时打印/预览/缩略图只输出文本元素，不输出图片与图形，适配已预印底图的纸张。

**Architecture:** 方案 A——在纯函数 `renderPrintDocument` 生成 HTML 时直接过滤掉非文本元素，预览 iframe、主进程实际打印、打印缩略图共用同一输出天然一致；字段 `textOnly` 存模板文档顶层（zod 默认 true，不升 content.version），DB 加 `text_only` 列（新库 DDL + 旧库幂等 ALTER 默认 1），历史快照随 JSON 自然携带。

**Tech Stack:** Electron 44 + React 18 + Ant Design 5 + TypeScript + Drizzle/better-sqlite3 + zod + Vitest。

设计文档：`docs/superpowers/specs/2026-09-24-text-only-print-design.md`

---

## 文件结构

| 文件 | 责任 | 改动 |
|---|---|---|
| `print-core/template-model.ts` | 文档模型/工厂 | 顶层加 `textOnly`（默认 true） |
| `print-core/render-print-document.ts` | 打印 HTML 纯函数 | 按 textOnly 过滤元素 |
| `db/schema.ts` | drizzle 表定义 | templates 加 `text_only` |
| `db/migrate.ts` | 启动迁移 | DDL 加列 + 旧库幂等 ALTER |
| `db/repositories/template-repo.ts` | 模板读写 | row/upsert/hydrate 透传 |
| `electron/main/services/print-service.ts` | 打印编排 | 仅文本时跳过图片资产校验 |
| `src/renderer/pages/print.tsx` | 打印页 | 开关 + 预览/提交/往返携带 |
| `tests/print-core/template-model.test.ts` | 模型测试 | 默认值/显式值 |
| `tests/print-core/render-print-document.test.ts` | 渲染测试 | buildDoc 置 false + 新增仅文本用例 |
| `tests/print-core/end-to-end-document.test.ts` | 端到端测试 | 补仅文本断言 |
| `tests/db/repositories.test.ts` | 仓储/迁移测试 | 读写 + 旧库默认 true |
| `tests/main/tplx-roundtrip.test.ts` | tplx 测试 | 字段随导出导入保留 |

---

## Task 1: 模型 textOnly 字段

**Files:**
- Modify: `print-core/template-model.ts`（`TemplateDocumentSchema` 约 117-131 行、`createTemplate` 约 154-179 行）
- Test: `tests/print-core/template-model.test.ts`

- [x] **Step 1: 写失败测试**

在 `tests/print-core/template-model.test.ts` 的最后一个 `it(...)`（`'v3：direction 仅接受...'`）之后、describe 回调结束前追加：

```ts
  it('textOnly：createTemplate 默认 true；缺字段 zod 补 true；显式 false 保留', () => {
    expect(createTemplate('t1', 'x', { widthMm: 40, heightMm: 30 }).textOnly).toBe(true)

    const raw = JSON.parse(JSON.stringify(createTemplate('t2', 'x', { widthMm: 40, heightMm: 30 })))
    delete raw.textOnly
    expect(TemplateDocumentSchema.parse(raw).textOnly).toBe(true)

    const off = JSON.parse(JSON.stringify(raw))
    off.textOnly = false
    expect(TemplateDocumentSchema.parse(off).textOnly).toBe(false)
  })
```

- [x] **Step 2: 运行确认失败**

Run: `npx vitest run tests/print-core/template-model.test.ts`
Expected: FAIL，`createTemplate(...) .textOnly` 为 `undefined`（`expected undefined to be true`）。

- [x] **Step 3: schema 加字段**

在 `print-core/template-model.ts` 的 `TemplateDocumentSchema` 中，`printMode` 与 `printerName` 之间加一行：

```ts
    printMode: PrintModeSchema.default('silent'),
    textOnly: z.boolean().default(true),
    printerName: z.string().nullable().default(null),
```

- [x] **Step 4: 工厂加默认值**

在同一文件 `createTemplate()` 返回对象中，`printMode: 'silent',` 下一行加：

```ts
    printMode: 'silent',
    textOnly: true,
    printerName: null,
```

- [x] **Step 5: 运行确认通过**

Run: `npx vitest run tests/print-core/template-model.test.ts`
Expected: PASS（6 个测试全绿）。

- [x] **Step 6: 提交**

```bash
git add print-core/template-model.ts tests/print-core/template-model.test.ts
git commit -m "feat(model): TemplateDocument 增加 textOnly（默认仅打印文本）"
```

---

## Task 2: 打印 HTML 按 textOnly 过滤非文本元素

**Files:**
- Modify: `print-core/render-print-document.ts`（`renderPrintDocument` 约 116-123 行）
- Test: `tests/print-core/render-print-document.test.ts`、`tests/print-core/end-to-end-document.test.ts`

- [x] **Step 1: 写失败测试（仅文本输出）**

在 `tests/print-core/render-print-document.test.ts` 的 describe 回调内（最后一个 `it` 之后）追加：

```ts
  it('textOnly=true：仅输出文本，不输出图片/矩形/椭圆/直线，且不依赖 assetUrls', () => {
    const doc = buildDoc() // buildDoc 内显式 textOnly=false，这里翻回默认语义
    doc.textOnly = true
    const html = renderPrintDocument(doc, { 姓名: '张三' }, {})
    expect(html).toContain('荣誉证书')
    expect(html).toContain('姓名：张三')
    expect(html).not.toContain('{{姓名}}')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('file:///')
    expect(html).not.toContain('border:')          // 矩形/椭圆外框
    expect(html).not.toContain('border-top:')      // 直线
    expect(html).not.toContain('border-radius:50%') // 椭圆
  })

  it('textOnly=false：图片与图形完整输出（回归现有行为）', () => {
    const doc = buildDoc()
    expect(doc.textOnly).toBe(false)
    const html = renderPrintDocument(doc, { 姓名: '张三' }, { a1: 'file:///img/a1.png' })
    expect(html).toContain('<img')
    expect(html).toContain('file:///img/a1.png')
    expect(html).toContain('border:')
    expect(html).toContain('荣誉证书')
  })
```

在 `tests/print-core/end-to-end-document.test.ts` 的 `it(...)` 之后追加第二个用例：

```ts
  it('textOnly=true 时图形与图片不进 HTML；文本 token 正常', () => {
    const tpl = createTemplate('t', '小票', { widthMm: 80, heightMm: 200 })
    tpl.params.push(createParamDef({ name: '姓名', type: 'text' }))
    tpl.content.elements.push(
      createElement('shape', { shape: 'rect' }, { x: 1, y: 1, w: 78, h: 100 }),
      createElement('image', { assetId: 'a9' }, { x: 1, y: 120, w: 20, h: 20 }),
      createElement('text', { text: '客户：{{姓名}}' }, { x: 5, y: 20, w: 70, h: 6 })
    )
    const values = evaluateParams(tpl.params, { 姓名: '李四' })
    const html = renderPrintDocument(tpl, values, {}) // 新模板默认 textOnly=true
    expect(html).toContain('李四')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('border:')
  })
```

- [x] **Step 2: 运行确认失败**

Run: `npx vitest run tests/print-core/render-print-document.test.ts tests/print-core/end-to-end-document.test.ts`
Expected: FAIL——新用例的 HTML 仍含 `<img`/`border:`（过滤尚未实现）；同时原有 `'输出含毫米 @page...'` 等用例因 createTemplate 默认 true 也会失败（下一步一起修）。

- [x] **Step 3: 修 buildDoc 显式完整模式**

`tests/print-core/render-print-document.test.ts` 的 `buildDoc()` 在 `return tpl` 前加一行（该夹具的全部既有用例都断言完整输出）：

```ts
function buildDoc() {
  const tpl = createTemplate('t1', '证书', { widthMm: 210, heightMm: 297 })
  tpl.params.push(createParamDef({ name: '姓名', type: 'text' }))
  tpl.content.elements.push(
    createElement('text', { text: '荣誉证书', fontSizeMm: 10, bold: true, align: 'center' }, { x: 30, y: 20, w: 150, h: 14 }),
    createElement('text', { text: '姓名：{{姓名}}', fontSizeMm: 6 }, { x: 40, y: 80, w: 80, h: 8 }),
    createElement('shape', { shape: 'rect', strokeColor: '#000', strokeWidthMm: 0.5, fillColor: null }, { x: 10, y: 10, w: 190, h: 277 }),
    createElement('image', { assetId: 'a1', fit: 'contain', opacity: 1 }, { x: 150, y: 230, w: 30, h: 30 })
  )
  tpl.textOnly = false
  return tpl
}
```

- [x] **Step 4: 实现过滤**

在 `print-core/render-print-document.ts` 的 `renderPrintDocument` 中，把元素排序这一行：

```ts
  const sorted = [...doc.content.elements].sort((a, b) => a.zIndex - b.zIndex)
```

改为：

```ts
  // textOnly（预印纸套打）：图片/图形/边框节点不生成，预览/实打印/缩略图共用此输出
  const visibleElements = doc.textOnly
    ? doc.content.elements.filter((el) => el.type === 'text')
    : doc.content.elements
  const sorted = [...visibleElements].sort((a, b) => a.zIndex - b.zIndex)
```

- [x] **Step 5: 运行确认通过**

Run: `npx vitest run tests/print-core/`
Expected: PASS（print-core 目录全部用例绿，含新增 3 个）。

- [x] **Step 6: 提交**

```bash
git add print-core/render-print-document.ts tests/print-core/render-print-document.test.ts tests/print-core/end-to-end-document.test.ts
git commit -m "feat(print): textOnly 时仅渲染文本元素（图片/图形不进打印 HTML）"
```

---

## Task 3: DB text_only 列、迁移与仓储透传

**Files:**
- Modify: `db/schema.ts`（templates 表约 3-15 行）
- Modify: `db/migrate.ts`（DDL 约 4-11 行、`runMigrations` 约 111-115 行）
- Modify: `db/repositories/template-repo.ts`（`TemplateRow`、`upsert`、`hydrate`）
- Test: `tests/db/repositories.test.ts`、`tests/main/tplx-roundtrip.test.ts`

- [x] **Step 1: 写失败测试**

在 `tests/db/repositories.test.ts` 的 `describe('TemplateRepository', ...)` 内最后一个 `it` 之后追加：

```ts
  it('textOnly 持久化：显式 false 写读一致；缺省模板为 true', () => {
    const off = sample('t1'); off.textOnly = false
    repo.upsert(off)
    expect(repo.getById('t1')?.textOnly).toBe(false)

    repo.upsert(sample('t2'))
    expect(repo.getById('t2')?.textOnly).toBe(true)
  })
```

在同文件 `'v1 旧库一次性升级'` 用例中，`const cols = (...template_params)...` 断言附近追加对 templates 列与读回值的断言（放在 `expect(doc2.params...).toEqual(['姓名'])` 之后）：

```ts
      const tcols = (legacy.sqlite.prepare('PRAGMA table_info(templates)').all() as { name: string }[]).map((c) => c.name)
      expect(tcols).toContain('text_only')
      // 存量行迁移默认 text_only=1，经仓储读回为 true
      expect(r.getById('old1')?.textOnly).toBe(true)
```

在 `tests/main/tplx-roundtrip.test.ts` 现有用例末尾（`expect(dataUrl.startsWith(...))` 之后）追加：

```ts
    // textOnly 随 .tplx 导出导入保留
    const flag = await svc.get(tpl.id)
    flag!.textOnly = false
    await svc.save(flag!)
    const tplx2 = join(dataDir, 'out2.tplx')
    await svc.exportToFile(tpl.id, tplx2)
    const imported2 = await svc.importFromFile(tplx2)
    expect(imported2.textOnly).toBe(false)
```

- [x] **Step 2: 运行确认失败**

Run: `npx vitest run tests/db/repositories.test.ts tests/main/tplx-roundtrip.test.ts`
Expected: FAIL——`textOnly` 读写为 `undefined`（列不存在/未透传），旧库无 `text_only` 列。

- [x] **Step 3: drizzle schema 加列**

在 `db/schema.ts` 的 templates 表定义中，`version` 行之后加：

```ts
  version: integer('version').notNull().default(1),
  textOnly: integer('text_only', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
```

- [x] **Step 4: 建表 DDL 加列**

在 `db/migrate.ts` 的 `DDL` 常量中，templates 建表语句的 `version INTEGER NOT NULL DEFAULT 1,` 之后加一行：

```sql
  is_builtin INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  text_only INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
```

- [x] **Step 5: 旧库幂等 ALTER 迁移**

在 `db/migrate.ts` 的 `migrateParamsTable` 函数之后、`runMigrations` 之前新增：

```ts
/**
 * ④ templates 增加 text_only 列（幂等）。
 * 旧库 ALTER ADD COLUMN ... DEFAULT 1：存量模板一次性默认"仅打印文本"（用户已确认的统一规则）。
 */
function addTextOnlyColumn(client: DbClient): void {
  const cols = client.sqlite.prepare("PRAGMA table_info(templates)").all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'text_only')) return
  client.sqlite.exec('ALTER TABLE templates ADD COLUMN text_only INTEGER NOT NULL DEFAULT 1')
}
```

把 `runMigrations` 改为（在 DDL 建表之后、参数表重建之前执行）：

```ts
export function runMigrations(client: DbClient): void {
  upgradeDocumentsToV2(client)
  client.sqlite.exec(DDL)
  addTextOnlyColumn(client)
  migrateParamsTable(client)
}
```

- [x] **Step 6: 仓储透传字段**

在 `db/repositories/template-repo.ts` 做三处修改：

`TemplateRow` 接口加字段（`version: number` 之后）：

```ts
  isBuiltin: number | boolean
  version: number
  textOnly: number | boolean
  createdAt: number
```

`upsert()` 的 row 对象加（`version: doc.version,` 之后）：

```ts
        isBuiltin: doc.isBuiltin,
        version: doc.version,
        textOnly: doc.textOnly,
        createdAt: doc.createdAt,
```

`hydrate()` 的 raw 对象加（`isBuiltin: !!row.isBuiltin,` 之后；zod 仍会兜底）：

```ts
      isBuiltin: !!row.isBuiltin, version: row.version,
      textOnly: !!row.textOnly,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
```

- [x] **Step 7: 运行确认通过**

Run: `npx vitest run tests/db/repositories.test.ts tests/main/tplx-roundtrip.test.ts`
Expected: PASS（含新增 3 处断言；旧库升级用例仍绿）。

- [x] **Step 8: 提交**

```bash
git add db/schema.ts db/migrate.ts db/repositories/template-repo.ts tests/db/repositories.test.ts tests/main/tplx-roundtrip.test.ts
git commit -m "feat(db): templates 增加 text_only 列（旧库幂等迁移默认 1）并仓储透传"
```

---

## Task 4: 仅文本模式跳过图片资产存在性校验

**Files:**
- Modify: `electron/main/services/print-service.ts`（`submit` 约 75-80 行）

说明：`PrintService.submit` 直接 `new BrowserWindow` 编排真实打印，无法在单测中实例化，过滤本身已由 Task 2 纯函数测试覆盖；本任务只改一行编排条件，由 Task 6 的 typecheck 与 CDP 走查（仅文本模式提交不被缺资产拦截）验证。

- [x] **Step 1: 修改校验条件**

把 `electron/main/services/print-service.ts` 中的：

```ts
    // 打印前校验：图片资产必须存在
    for (const el of doc.content.elements) {
      if (el.type === 'image' && !this.assets.repo.get(el.props.assetId)) {
        throw new Error(`模板引用的图片不存在（元素 ${el.id}），请重新上传后再打印`)
      }
    }
```

改为：

```ts
    // 打印前校验：图片资产必须存在（仅打印文本时图片不输出，缺资产不应拦截）
    if (!doc.textOnly) {
      for (const el of doc.content.elements) {
        if (el.type === 'image' && !this.assets.repo.get(el.props.assetId)) {
          throw new Error(`模板引用的图片不存在（元素 ${el.id}），请重新上传后再打印`)
        }
      }
    }
```

- [x] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无输出（退出码 0）。

- [x] **Step 3: 提交**

```bash
git add electron/main/services/print-service.ts
git commit -m "fix(print): 仅打印文本时跳过图片资产存在性校验"
```

---

## Task 5: 打印页「仅打印文本」开关与状态接线

**Files:**
- Modify: `src/renderer/pages/print.tsx`

- [x] **Step 1: 加 state**

在 `src/renderer/pages/print.tsx` 中 `const [mode, setMode] = useState<'silent' | 'dialog'>('silent')` 下一行加：

```ts
  const [mode, setMode] = useState<'silent' | 'dialog'>('silent')
  const [textOnly, setTextOnly] = useState(true)
```

- [x] **Step 2: 载入文档时初始化**

在文档加载 effect 中 `setMode(loaded.printMode)` 下一行加：

```ts
      setPrinterName(loaded.printerName ?? defPrinter ?? prts.find((p) => p.isDefault)?.name ?? prts[0]?.name ?? '')
      setMode(loaded.printMode)
      setTextOnly(loaded.textOnly)
```

- [x] **Step 3: 预览用携带开关的工作副本**

把 `previewHtml` 的 useMemo：

```ts
  const previewHtml = useMemo(
    () => (doc ? renderPrintDocument(doc, evaluated, assetUrls) : ''),
    [doc, evaluated, assetUrls]
  )
```

改为：

```ts
  const previewHtml = useMemo(
    () => (doc ? renderPrintDocument({ ...doc, textOnly }, evaluated, assetUrls) : ''),
    [doc, textOnly, evaluated, assetUrls]
  )
```

- [x] **Step 4: “调整版式”往返保留开关（顺带修正 printMode 同样丢失的问题）**

把 `editLayout()`：

```ts
  function editLayout(): void {
    if (!doc) return
    sessionDraft.doc = doc
    sessionDraft.paramValues = values
    sessionDraft.returnToPrint = true
    sessionDraft.fromHistory = false
    sessionDraft.baselineJson = baselineRef.current
    nav('/designer')
  }
```

改为：

```ts
  function editLayout(): void {
    if (!doc) return
    // 携带打印侧开关的工作副本，避免往返设计器后选择丢失
    sessionDraft.doc = { ...doc, printMode: mode, printerName, textOnly }
    sessionDraft.paramValues = values
    sessionDraft.returnToPrint = true
    sessionDraft.fromHistory = false
    sessionDraft.baselineJson = baselineRef.current
    nav('/designer')
  }
```

- [x] **Step 5: 提交打印携带开关**

把 `submitNow()` 中：

```ts
    const working: TemplateDocument = { ...doc!, printMode: mode, printerName }
```

改为：

```ts
    const working: TemplateDocument = { ...doc!, printMode: mode, printerName, textOnly }
```

- [x] **Step 6: 加开关 UI**

把左侧面板中"静默直打/份数"的 Space 块：

```tsx
          <Space>
            <span>静默直打</span>
            <Switch checked={mode === 'silent'} onChange={(v) => setMode(v ? 'silent' : 'dialog')} />
            <span>份数</span>
            <InputNumber min={1} max={99} value={copies} onChange={(v) => setCopies(v ?? 1)} style={{ width: 70 }} />
          </Space>
```

改为（在同一 Space 内追加开关，下方加一行说明）：

```tsx
          <Space>
            <span>静默直打</span>
            <Switch checked={mode === 'silent'} onChange={(v) => setMode(v ? 'silent' : 'dialog')} />
            <span>份数</span>
            <InputNumber min={1} max={99} value={copies} onChange={(v) => setCopies(v ?? 1)} style={{ width: 70 }} />
          </Space>
          <Space>
            <span>仅打印文本</span>
            <Switch checked={textOnly} onChange={setTextOnly} />
          </Space>
          <div style={{ color: '#999', fontSize: 12, lineHeight: 1.4 }} >
            仅输出文字，不打印图片/图形/边框，适合已预印底图的纸张
          </div>
```

- [x] **Step 7: 类型检查与构建**

Run: `npm run typecheck`
Expected: 退出码 0。

Run: `npx electron-vite build`
Expected: 三个 bundle 全部 built 成功。

- [x] **Step 8: 提交**

```bash
git add src/renderer/pages/print.tsx
git commit -m "feat(print-ui): 打印页增加仅打印文本开关（预览联动/提交与往返携带）"
```

---

## Task 6: 全量回归、CDP 走查与打包（2026-09-24 完成）

执行结果：子代理驱动 Task 1-5（提交 046210d/b3a848c/05e412a/3a3e6b4/fed6f7e），主代理跑 Task 6。
vitest **91/91**（18 文件，新增 5 用例）、tsc 0；CDP 走查全项通过：内置证书默认仅文本无边框（开关 ON）、
关闭后矩形边框即时出现、重开消失；textOnly=false 经 api 持久化、打印页初态与"调整版式"往返后均保持关；
零 console 错误/异常；__CDP_TO 已清理，真实模板未动。安装包 `release\TemplatePrint Setup 0.1.0.exe`
121.73 MB（21:17），win32-x64 N-API prebuild 已入 asarUnpack。实际出纸效果留作人工终验。

- [x] **Step 1: 自动化门禁**

Run: `npx vitest run`
Expected: 全绿（18 个测试文件；在原 86 个基础上新增：模型 1、渲染 2、端到端 1、仓储 1、旧库迁移断言并入既有用例、tplx 1 处）。

Run: `npm run typecheck`
Expected: 0 错误。

- [x] **Step 2: 编写并运行 CDP 走查脚本**

按项目技能 `electron-cdp-walkthrough`：后台启动

```powershell
npx electron . --remote-debugging-port=9222 --remote-allow-origins=* --disable-features=CalculateNativeWinOcclusion
```

在仓库外临时目录（如 `%TEMP%/tp-cdp-to/`）新建 `harness.mjs`，内容如下（零依赖 Node 24 脚本；模板连接/driver 部分与技能模板一致，业务阶段如下）：

```js
// 仅打印文本 CDP 走查
// Phase A：内置证书（含矩形边框）打印页默认仅文本——iframe 无边框；
//          关闭开关边框出现，重开消失；
// Phase B：__CDP_TO 模板开关状态持久化（api 存取）；调整版式往返保留开关；
// Phase C：console 零异常；清理 __CDP_*，核对真实模板未动。
import { promises as fs } from 'node:fs'
import path from 'node:path'
const OUT = process.env.CDP_SHOT_DIR ?? './cdp-shots'
await fs.mkdir(OUT, { recursive: true })
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const wsUrl = targets.find((t) => t.type === 'page' && t.url.includes('index.html')).webSocketDebuggerUrl
const ws = new WebSocket(wsUrl)
let mid = 0
const pending = new Map()
const consoleErrors = [], exceptions = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (!m.id) {
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    if (m.method === 'Runtime.exceptionThrown')
      exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    return
  }
  const p = pending.get(m.id); pending.delete(m.id)
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++mid; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
})
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Runtime.enable'); await send('Page.enable'); await send('Page.bringToFront')
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('PAGE EXC: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
  return r.result.value
}
async function shot(n) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.join(OUT, n + '.png'), Buffer.from(data, 'base64'))
}
await ev(`(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const norm = (s) => (s || '').replace(/\\s+/g, '')
  const click = (el) => ['mousedown','mouseup','click'].forEach((t) =>
    el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })))
  window.__cdp = {
    sleep,
    async waitFor(fn, ms = 15000, label = '') {
      const t0 = Date.now(); let last
      while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v } catch (e) { last = e }; await sleep(120) }
      throw new Error('waitFor ' + label + (last ? ' ' + (last.message || last) : ''))
    },
    btn(text) { return [...document.querySelectorAll('button')].find((b) => norm(b.textContent).includes(norm(text)) && b.offsetParent !== null) },
    click
  }
})()`)

const report = {}
try {
  // Phase A：builtin-cert 含矩形边框，默认 textOnly=true
  await ev(`location.hash = '#/print/builtin-cert'`)
  const aDefault = await ev(`(async () => {
    const f = await window.__cdp.waitFor(() => {
      const x = document.querySelector('iframe[title="preview"]')
      return x && x.contentDocument && x.contentDocument.body.children.length ? x : null
    }, 20000, 'cert iframe')
    await window.__cdp.sleep(500)
    const html = f.contentDocument.body.innerHTML
    const switchEl = [...document.querySelectorAll('.ant-switch')].find((s) =>
      s.closest('.ant-space')?.textContent.includes('仅打印文本'))
    return {
      checked: switchEl.classList.contains('ant-switch-checked'),
      hasBorder: html.includes('border:'),
      hasText: html.includes('荣誉证书') || html.length > 200
    }
  })()`)
  await shot('a1-textonly-on')

  // 关闭开关
  const aOff = await ev(`(async () => {
    const switchEl = [...document.querySelectorAll('.ant-switch')].find((s) =>
      s.closest('.ant-space')?.textContent.includes('仅打印文本'))
    window.__cdp.click(switchEl)
    await window.__cdp.sleep(400)
    const f = document.querySelector('iframe[title="preview"]')
    return {
      checked: switchEl.classList.contains('ant-switch-checked'),
      hasBorder: f.contentDocument.body.innerHTML.includes('border:')
    }
  })()`)
  await shot('a2-textonly-off')

  // 重开
  const aOn = await ev(`(async () => {
    const switchEl = [...document.querySelectorAll('.ant-switch')].find((s) =>
      s.closest('.ant-space')?.textContent.includes('仅打印文本'))
    window.__cdp.click(switchEl)
    await window.__cdp.sleep(400)
    const f = document.querySelector('iframe[title="preview"]')
    return {
      checked: switchEl.classList.contains('ant-switch-checked'),
      hasBorder: f.contentDocument.body.innerHTML.includes('border:')
    }
  })()`)

  // Phase B：__CDP_TO 持久化（api 层）+ 调整版式往返（UI）
  const b = await ev(`(async () => {
    const t = await window.api.templates.create({ name: '__CDP_TO', widthMm: 100, heightMm: 60 })
    const d = await window.api.templates.get(t.id)
    d.content.elements.push(
      { id: 'bx', type: 'shape', x: 2, y: 2, w: 96, h: 56, rotation: 0, locked: false, zIndex: 0,
        props: { shape: 'rect', strokeColor: '#000000', strokeWidthMm: 0.3, fillColor: null } },
      { id: 'tx', type: 'text', x: 5, y: 5, w: 80, h: 8, rotation: 0, locked: false, zIndex: 1,
        props: { text: '套打文字', fontFamily: '', fontSizeMm: 5, bold: false, italic: false,
          align: 'left', color: '#000000', lineHeight: 1.2, underline: false, direction: 'horizontal' } }
    )
    d.textOnly = false
    await window.api.templates.save(d)
    const reread = await window.api.templates.get(t.id)
    return { id: t.id, persistedFalse: reread.textOnly === false }
  })()`)

  // 打开该模板打印页：开关应为关；点“调整版式”进设计器，再“完成，返回打印”，开关仍关
  await ev(`location.hash = '#/print/${b.id}'`)
  const bUi = await ev(`(async () => {
    await window.__cdp.waitFor(() => document.querySelector('iframe[title="preview"]'), 20000, 'to iframe')
    await window.__cdp.sleep(400)
    const sw = () => [...document.querySelectorAll('.ant-switch')].find((s) =>
      s.closest('.ant-space')?.textContent.includes('仅打印文本'))
    const before = sw().classList.contains('ant-switch-checked')
    window.__cdp.click(window.__cdp.btn('调整版式'))
    await window.__cdp.waitFor(() => window.__cdp.btn('完成，返回打印'), 10000, 'designer')
    await window.__cdp.sleep(300)
    window.__cdp.click(window.__cdp.btn('完成，返回打印'))
    await window.__cdp.waitFor(() => document.querySelector('iframe[title="preview"]'), 10000, 'back to print')
    await window.__cdp.sleep(400)
    const after = sw().classList.contains('ant-switch-checked')
    return { uncheckedBefore: before === false, uncheckedAfterRoundtrip: after === false }
  })()`)
  await shot('b1-roundtrip')
  report.phaseA = { defaultOn: aDefault, off: aOff, onAgain: aOn }
  report.phaseB = { ...b, ...bUi }

  // Phase C：清理
  report.cleanup = await ev(`(async () => {
    const all = await window.api.templates.list({})
    const victims = all.filter((t) => t.name.startsWith('__CDP_'))
    for (const t of victims) await window.api.templates.delete(t.id)
    return { deleted: victims.map((t) => t.name), remaining: (await window.api.templates.list({})).map((t) => t.name) }
  })()`)
} catch (e) {
  report.fatal = e.stack || String(e)
}
report.consoleErrors = consoleErrors
report.exceptions = exceptions
await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
ws.close()
process.exit(report.fatal || consoleErrors.length || exceptions.length ? 1 : 0)
```

Run: `node %TEMP%/tp-cdp-to/harness.mjs`
Expected（逐项核对 report）：

- `phaseA.defaultOn.checked === true` 且 `hasBorder === false`（内置证书默认仅文本，矩形边框不进 iframe）；
- `phaseA.off.checked === false` 且 `hasBorder === true`（关闭后边框即时出现）；
- `phaseA.onAgain.checked === true` 且 `hasBorder === false`（重开消失）；
- `phaseB.persistedFalse === true`、`uncheckedBefore === true`、`uncheckedAfterRoundtrip === true`；
- `cleanup.remaining` 恰为 4 个真实模板（测试 + 3 个 builtin），`deleted` 含 `__CDP_TO`；
- `consoleErrors=[]`、`exceptions=[]`、无 `fatal`。

人工查看截图 `a1-textonly-on.png`（无边框）与 `a2-textonly-off.png`（有边框）确认视觉一致。

- [x] **Step 3: 生产构建**

Run: `npx electron-vite build`
Expected: main/preload/renderer 三 bundle built 成功。

- [x] **Step 4: 打包**

Run: `npm run dist`
Expected: `DONE`，产物 `release\TemplatePrint Setup 0.1.0.exe`；
确认 `release\win-unpacked\resources\app.asar.unpacked\node_modules\better-sqlite3\prebuilds\win32-x64.node` 存在。

- [x] **Step 5: 收尾**

- 在本计划文件把各任务复选框勾掉；
- 更新项目记忆（M4/文本套打：字段、迁移默认值、实测结论）；
- 真实打印走查（实际出纸）留作人工终验：预印纸模板默认仅文本出纸无图形、取消勾选保存后再出纸完整。

---

## 自查记录

| Spec 条目 | 任务 |
|---|---|
| §2.1 textOnly 字段默认 true / 不升 content.version / 工厂 | 1 |
| §2.2 DB 列 + DDL + 旧库 ALTER 默认 1 + repo 透传 / jobs 不加列 | 3 |
| §2.2 tplx 与复制随 JSON 携带（旧文件 zod 默认 true） | 1（zod）、3（tplx 断言） |
| §3 渲染时过滤非文本元素；预览/打印/缩略图一致 | 2、5 |
| §3 仅文本跳过图片资产校验 | 4 |
| §3 历史快照携带完整元素定义（repo 未删元素） | 2（仅渲染过滤）、3（快照 JSON 无改动） |
| §4 打印页开关/说明文案/预览联动/提交携带/保存回流 | 5 |
| §4 调整版式往返保留（含 printMode 顺带修正） | 5 |
| §5 边界（无文本空白页、缺资产放行、token 行为不变、旧快照默认 true） | 1、2、3、4 |
| §6.1 自动化测试（模型/渲染/端到端/迁移仓储/tplx） | 1、2、3 |
| §6.2 门禁 + CDP 实测 6 项 + 双清红线 | 6 |
| 不做：全局设置/设计器开关/历史列/逐元素控制 | 全计划无相关改动 |
