# 模板参数改造实施计划：参数即文本占位符（{{名称}}）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参数不再是画布元素，而是仅在文本中以 `{{参数名称}}` 引用的占位符；参数只有一个"参数名称"（模板内唯一，允许中文）；打印时按名称求值替换。

**Architecture:** 模型层 content.version 升到 2：删除 ParamElement 元素类型，ParamDef 的 id/key/label 三字段合并为 `name`。提供 v1→v2 读时迁移（content JSON 中的 param 元素转成含 `{{名称}}` 的文本元素；关系表参数列 id/key/label 重建为 name；打印历史快照连同 paramValues 的键一起迁移）。渲染层对文本做 token 分段插值。

**Tech Stack:** 同现状（Electron/React/AntD/Drizzle/better-sqlite3/Vitest），无新依赖。Node 24 + npm。测试 `npx vitest run`；tsc `npm run typecheck`；ABI `npm run bin:node`/`bin:electron`。

**语义约定：**

- 参数名称：trim 后 1–30 字符，不含 `{`、`}`、换行；模板内唯一。允许中文、字母、数字、空格、常见标点。
- token 语法：`{{名称}}`，括号内侧空白忽略（`{{ 姓名 }}` 等价 `{{姓名}}`）；正则 `/\{\{\s*([^{}]+?)\s*\}\}/g`。
- 文本引用了不存在的参数 → 替换为空串（不阻止编辑/保存，避免"先写字后建参数"被卡死）。
- 必填校验仍按参数定义执行（无论该参数是否被文本引用）。
- 空值横线：参数 printOnEmpty='line' 时，该 token 渲染为下划线片段。

---

## 文件结构

```
print-core/template-model.ts                 修改：删 ParamElement；ParamDef 单字段 name；version=2
print-core/migrate.ts                        新增：v1→v2 文档/参数值迁移（纯函数）
print-core/param-evaluator.ts                修改：按 name 求值；token 正则放开中文
print-core/render-print-document.ts          修改：文本 token 分段插值；删 param 分支
db/schema.ts                                 修改：templateParams 去 id/key/label，加 name，PK(template_id,name)
db/migrate.ts                                修改：幂等重建 template_params 表
db/repositories/template-repo.ts             修改：新列读写 + hydrate 过 migrateDocument
db/repositories/job-repo.ts                  修改：快照+paramValues 迁移
electron/main/services/template-service.ts   修改：tplx 导入过 migrateDocument
electron/main/services/seed-service.ts       修改：内置模板改为文本 token 形态
src/renderer/store/designer-store.ts         修改：removeParam 简化；新增 renameParam
src/renderer/designer/param-manager.tsx      重写：单一参数名称、不插图、改名联动 token
src/renderer/designer/element-library.tsx    修改：提示文案
src/renderer/designer/canvas.tsx             修改：删 param 渲染分支
src/renderer/designer/property-panel.tsx     修改：删参数元素块；文本属性加"插入参数"
src/renderer/pages/print.tsx                 修改：表单按 name
tests/print-core/migrate.test.ts             新增
tests/print-core/{template-model,param-evaluator,render-print-document,end-to-end-document}.test.ts 修改
tests/db/repositories.test.ts                修改：参数新结构
tests/renderer/designer-store.test.ts        修改
tests/main/seed-service.test.ts              修改
```

---

## Task 1: 模型 v2 + v1→v2 迁移纯函数（TDD）

**Files:**

- Modify: `print-core/template-model.ts`
- Create: `print-core/migrate.ts`, `tests/print-core/migrate.test.ts`

- [ ] **Step 1: 新模型**

`print-core/template-model.ts` 修改点：

1. `CONTENT_VERSION = 2`。
2. 删除 `ParamElementSchema`；ElementSchema 的 discriminatedUnion 只保留 Text/Image/Shape。
3. ParamDefSchema 与工厂替换为：

```ts
export const ParamDefSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '参数名称不能为空')
    .max(30, '参数名称最长 30 字符')
    .refine((n) => !/[{}]/.test(n) && !/[\r\n]/.test(n), '参数名称不能包含 { } 或换行'),
  type: ParamTypeSchema,
  required: z.boolean().default(true),
  defaultValue: z.string().default(''),
  dateFormat: z.string().default('yyyy-MM-dd'),
  maxLength: z.number().int().positive().nullable().default(null),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  decimals: z.number().int().min(0).max(6).default(2),
  thousandsSeparator: z.boolean().default(false),
  printOnEmpty: z.enum(['blank', 'line']).default('blank'),
  order: z.number().int().default(0)
})
export type ParamDef = z.infer<typeof ParamDefSchema>
```

4. superRefine 中唯一性改为 name，删除 paramId 引用检查：

```ts
    const seen = new Set<string>()
    doc.params.forEach((p, i) => {
      if (seen.has(p.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['params', i, 'name'], message: `参数名称重复: ${p.name}` })
      }
      seen.add(p.name)
    })
```

5. createParamDef 改为：

```ts
export function createParamDef(
  input: Pick<ParamDef, 'name' | 'type'> & Partial<ParamDef>
): ParamDef {
  return ParamDefSchema.parse({
    name: input.name,
    type: input.type,
    required: true,
    defaultValue: '',
    dateFormat: 'yyyy-MM-dd',
    maxLength: null,
    min: null,
    max: null,
    decimals: 2,
    thousandsSeparator: false,
    printOnEmpty: 'blank',
    order: 0,
    ...input
  })
}
```

createElement/createTemplate 不变（createElement 入参 ElementType 自动收窄为 text/image/shape）。

- [ ] **Step 2: 迁移纯函数（先写测试）**

`tests/print-core/migrate.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { migrateDocument, migrateParamValues } from '../../print-core/migrate'
import { TemplateDocumentSchema } from '../../print-core/template-model'

const v1 = () => ({
  id: 't1', name: '旧模板', category: '',
  paper: { widthMm: 40, heightMm: 30 },
  content: { elements: [
    { id: 'e1', x: 1, y: 1, w: 10, h: 5, rotation: 0, locked: false, zIndex: 0, type: 'text',
      props: { text: '姓名：', fontFamily: 'Arial', fontSizeMm: 4, bold: false, italic: false, align: 'left', color: '#000', lineHeight: 1.2 } },
    { id: 'e2', x: 1, y: 10, w: 20, h: 6, rotation: 0, locked: false, zIndex: 1, type: 'param',
      props: { paramId: 'p_name', fontFamily: 'Arial', fontSizeMm: 4, bold: true, align: 'left', color: '#000', autoFit: true } }
  ] },
  params: [
    { id: 'p_name', key: 'p_name', label: '姓名', type: 'text', required: true, defaultValue: '',
      dateFormat: 'yyyy-MM-dd', maxLength: null, min: null, max: null, decimals: 2,
      thousandsSeparator: false, printOnEmpty: 'blank', order: 0 }
  ],
  printMode: 'silent', printerName: null, isBuiltin: false, version: 1,
  createdAt: 1, updatedAt: 2
})

describe('migrateDocument', () => {
  it('v1：param 元素转 {{名称}} 文本；参数 id/key/label 合并为 name；version=2', () => {
    const doc = TemplateDocumentSchema.parse(migrateDocument(v1()))
    expect(doc.version).toBe(2)
    expect(doc.params[0].name).toBe('姓名')
    expect('id' in doc.params[0]).toBe(false)
    const pe = doc.content.elements[1]
    expect(pe.type).toBe('text')
    if (pe.type === 'text') expect(pe.props.text).toBe('{{姓名}}')
  })

  it('label 为空时回退 key；重名自动加序号', () => {
    const raw = v1()
    raw.params = [
      { ...raw.params[0], id: 'a', key: 'a', label: '日期' },
      { ...raw.params[0], id: 'b', key: 'b', label: '日期' },
      { ...raw.params[0], id: 'c', key: 'c', label: '' }
    ]
    const doc = TemplateDocumentSchema.parse(migrateDocument(raw))
    expect(doc.params.map((p) => p.name)).toEqual(['日期', '日期2', 'c'])
  })

  it('v2 文档原样返回', () => {
    const v2 = TemplateDocumentSchema.parse(migrateDocument(v1()))
    expect(migrateDocument(v2)).toBe(v2)
  })
})

describe('migrateParamValues', () => {
  it('v1 快照的参数值按键→名称重映射；v2 原样', () => {
    const raw = v1()
    expect(migrateParamValues(raw, { p_name: '张三' })).toEqual({ 姓名: '张三' })
    const v2 = TemplateDocumentSchema.parse(migrateDocument(raw))
    expect(migrateParamValues(v2, { 姓名: '李四' })).toEqual({ 姓名: '李四' })
  })
})
```

`print-core/migrate.ts`：

```ts
/**
 * v1 → v2 读时迁移（幂等）：
 * - ParamDef 的 id/key/label 合并为 name（优先 label，空则 key，模板内重名加序号）
 * - type:'param' 元素转为含 {{名称}} 的 text 元素
 * - version 置 2
 * 非对象/已是 v2 的输入原样返回。
 */

interface V1ParamDef {
  id?: string
  key?: string
  label?: string
  [k: string]: unknown
}
interface V1Element {
  type?: string
  id?: string
  x?: number
  y?: number
  w?: number
  h?: number
  rotation?: number
  locked?: boolean
  zIndex?: number
  props?: Record<string, unknown>
  [k: string]: unknown
}

/** 从 v1 参数数组构造 name，并返回 name 列表与 key→name 映射 */
function buildNames(params: V1ParamDef[]): { names: Record<string, unknown>[]; map: Map<string, string> } {
  const used = new Set<string>()
  const map = new Map<string, string>()
  const names = params.map((p) => {
    let name = String(p.label ?? '').trim() || String(p.key ?? '').trim() || '参数'
    if (used.has(name)) {
      let n = 2
      while (used.has(`${name}${n}`)) n += 1
      name = `${name}${n}`
    }
    used.add(name)
    map.set(String(p.key ?? ''), name)
    const { id: _id, key: _key, label: _label, ...rest } = p
    return { name, ...rest }
  })
  return { names, map }
}

export function migrateDocument(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as { version?: number; params?: V1ParamDef[]; content?: { elements?: V1Element[] } }
  if (r.version === 2) return raw

  const params = Array.isArray(r.params) ? r.params : []
  const { names, map } = buildNames(params)

  const elements = (Array.isArray(r.content?.elements) ? r.content!.elements : []).map((el) => {
    if (el.type !== 'param') return el
    const props = el.props ?? {}
    const name = map.get(String(props.paramId ?? '')) ?? String(props.paramId ?? '')
    return {
      id: el.id, x: el.x, y: el.y, w: el.w, h: el.h,
      rotation: el.rotation ?? 0, locked: el.locked ?? false, zIndex: el.zIndex ?? 0,
      type: 'text',
      props: {
        text: `{{${name}}}`,
        fontFamily: props.fontFamily ?? 'Microsoft YaHei',
        fontSizeMm: props.fontSizeMm ?? 5,
        bold: props.bold ?? false,
        italic: false,
        align: props.align ?? 'left',
        color: props.color ?? '#000000',
        lineHeight: 1.2
      }
    }
  })

  return { ...r, version: 2, params: names, content: { elements } }
}

/** v1 打印历史的 paramValues 以 key 为键，迁移到以 name 为键；v2 原样返回 */
export function migrateParamValues(
  rawSnapshot: unknown,
  values: Record<string, string>
): Record<string, string> {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') return values
  const r = rawSnapshot as { version?: number; params?: V1ParamDef[] }
  if (r.version === 2) return values
  const params = Array.isArray(r.params) ? r.params : []
  const used = new Set<string>()
  const keyToName = new Map<string, string>()
  for (const p of params) {
    let name = String(p.label ?? '').trim() || String(p.key ?? '').trim() || '参数'
    if (used.has(name)) {
      let n = 2
      while (used.has(`${name}${n}`)) n += 1
      name = `${name}${n}`
    }
    used.add(name)
    keyToName.set(String(p.key ?? ''), name)
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) out[keyToName.get(k) ?? k] = v
  return out
}
```

Run: `npx vitest run tests/print-core/migrate.test.ts` → 4/4 通过（先红：模块不存在）。

- [ ] **Step 3: 验证与提交**

此时 print-core 其余文件/仓库/渲染端仍引用旧类型，tsc 会红——本任务只要求迁移测试与模型自洽（migrate.test 单独跑过）。暂不提交，与 Task 2 完成后一起提交（或本步可先提交，接受 tsc 暂红不利于子代理衔接，故**合并到 Task 2 末尾提交**）。

---

## Task 2: 求值/渲染按 name 插值 + 仓储与表结构迁移（TDD）

**Files:**

- Modify: `print-core/param-evaluator.ts`, `print-core/render-print-document.ts`, `db/schema.ts`, `db/migrate.ts`, `db/repositories/template-repo.ts`, `db/repositories/job-repo.ts`, `electron/main/services/template-service.ts`
- Modify tests: `tests/print-core/param-evaluator.test.ts`, `render-print-document.test.ts`, `template-model.test.ts`, `end-to-end-document.test.ts`, `tests/db/repositories.test.ts`

- [ ] **Step 1: param-evaluator**

- `evaluateParams` 中 `input[def.name]`、errors push `def.name`、`out[def.name]`。
- interpolate 正则与注释替换：

```ts
/** 替换文本中的 {{参数名称}}（名称允许中文等任意非大括号字符）；未定义名称替换为空串 */
export function interpolate(expr: string, values: Record<string, string>): string {
  return expr.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => values[name.trim()] ?? '')
}
```

- [ ] **Step 2: 文本 token 分段渲染**

`render-print-document.ts`：删除 `case 'param'`；text 分支改为分段渲染：

```ts
function renderTextHtml(p: { text: string; fontFamily: string; fontSizeMm: number; bold: boolean; italic: boolean; align: string; color: string; lineHeight: number }, values: Record<string, string>): string {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(p.text))) {
    parts.push(esc(p.text.slice(last, m.index)))
    const v = values[m[1].trim()] ?? ''
    parts.push(
      v === EMPTY_LINE_TOKEN
        ? '<span style="display:inline-block;min-width:15mm;border-bottom:0.3mm solid #000">&nbsp;</span>'
        : esc(v)
    )
    last = m.index + m[0].length
  }
  parts.push(esc(p.text.slice(last)))
  return `<div style="font-family:'${esc(p.fontFamily)}';font-size:${p.fontSizeMm}mm;` +
    `font-weight:${p.bold ? 'bold' : 'normal'};font-style:${p.italic ? 'italic' : 'normal'};` +
    `text-align:${p.align};color:${p.color};line-height:${p.lineHeight};` +
    `white-space:pre-wrap;word-break:break-word;overflow:hidden">${parts.join('')}</div>`
}
```

text case：

```ts
    case 'text':
      return `<div style="${style}">${renderTextHtml(el.props, values)}</div>`
```

（外层定位 div 不再重复字体样式；内层负责排版。geoStyle 保持 position/尺寸/旋转。）

- [ ] **Step 3: 更新 print-core 测试（TDD）**

按下述映射改既有测试（先读各文件再改，保持断言语义）：

- `param-evaluator.test.ts`：def 构造从 `{id:'name',key:'name',label:'姓名',type:'text',...}` 改为 `createParamDef({ name: '姓名', type: 'text' })`；input/errors/输出键全部用名称；新增 interpolate 用例：

```ts
it('interpolate 支持中文 token、忽略括号内空白、未知名为空', () => {
  expect(interpolate('你好{{ 姓名 }}，金额￥{{金额}}', { 姓名: '张三', 金额: '88.00' })).toBe('你好张三，金额￥88.00')
  expect(interpolate('{{未知}}x', {})).toBe('x')
})
```

- `render-print-document.test.ts`：删除 param 元素用例，新增：

```ts
it('文本中的 {{名称}} 被替换并做 HTML 转义', () => {
  const doc = baseDoc([
    createElement('text', { text: '姓名：{{姓名}}' }, { x: 1, y: 1, w: 60, h: 8 })
  ])
  const html = renderPrintDocument(doc, { 姓名: '<b>张三</b>' }, {})
  expect(html).toContain('姓名：&lt;b&gt;张三&lt;/b&gt;')
})
it('空值横线 token 渲染为下划线片段', () => {
  const doc = baseDoc([createElement('text', { text: '日期：{{日期}}' }, { x: 1, y: 1, w: 60, h: 8 })])
  const html = renderPrintDocument(doc, { 日期: EMPTY_LINE_TOKEN }, {})
  expect(html).toContain('border-bottom:0.3mm solid #000')
})
```

- `template-model.test.ts`：参数唯一性用例改 name；删除 ParamElement 构造/引用校验用例，新增：

```ts
it('参数名称模板内唯一；含大括号非法', () => {
  const d = createTemplate('t', 'x', { widthMm: 40, heightMm: 30 })
  d.params.push(createParamDef({ name: '姓名', type: 'text' }))
  d.params.push(createParamDef({ name: '姓名', type: 'text', order: 1 }))
  expect(TemplateDocumentSchema.safeParse(d).success).toBe(false)
  expect(() => createParamDef({ name: '坏{名称', type: 'text' })).toThrow()
})
```

- `end-to-end-document.test.ts`：把 param 元素替换为带 token 的 text；def 用 name；断言最终 HTML 含求值文本、不含 '{{'。

Run: `npx vitest run tests/print-core` → 全绿。

- [ ] **Step 4: DB schema 与迁移**

`db/schema.ts` 的 templateParams 替换为：

```ts
// 参数名称在单模板内唯一，主键 (template_id, name)
export const templateParams = sqliteTable('template_params', {
  templateId: text('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  required: integer('required', { mode: 'boolean' }).notNull().default(true),
  defaultValue: text('default_value').notNull().default(''),
  dateFormat: text('date_format').notNull().default('yyyy-MM-dd'),
  maxLength: integer('max_length'),
  min: integer('min'),
  max: integer('max'),
  decimals: integer('decimals').notNull().default(2),
  thousandsSeparator: integer('thousands_separator', { mode: 'boolean' }).notNull().default(false),
  printOnEmpty: text('print_on_empty').notNull().default('blank'),
  order: integer('sort_order').notNull().default(0)
}, (table) => ({
  pk: primaryKey({ columns: [table.templateId, table.name] })
}))
```

`db/migrate.ts`：DDL 中 CREATE TABLE template_params 的定义同步改为新结构（无 id/key/label、有 name、PK(template_id,name)，对新库生效；旧库因 IF NOT EXISTS 跳过、由 ③ 重建）。幂等的旧表重建函数 `migrateParamsTable`（在 exec(DDL) **之后**执行，顺序见本 Step 末尾冻结方案）：

```ts
function migrateParamsTable(client: DbClient): void {
  const cols = client.sqlite.prepare("PRAGMA table_info(template_params)").all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'name')) return
  // 旧表（含 key/label）→ 新表；label 同模板内重复时回退 key
  client.sqlite.exec(`
    CREATE TABLE template_params_v2 (
      template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      name TEXT NOT NULL, type TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1, default_value TEXT NOT NULL DEFAULT '',
      date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd', max_length INTEGER, min INTEGER, max INTEGER,
      decimals INTEGER NOT NULL DEFAULT 2, thousands_separator INTEGER NOT NULL DEFAULT 0,
      print_on_empty TEXT NOT NULL DEFAULT 'blank', sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (template_id, name)
    );
    INSERT INTO template_params_v2(template_id,name,type,required,default_value,date_format,
      max_length,min,max,decimals,thousands_separator,print_on_empty,sort_order)
    SELECT template_id,
      CASE
        WHEN COALESCE(label,'') = '' THEN key
        WHEN label IN (SELECT label FROM template_params q WHERE q.template_id = p.template_id GROUP BY label HAVING COUNT(*) > 1) THEN key
        ELSE label
      END,
      type,required,default_value,date_format,max_length,min,max,decimals,thousands_separator,print_on_empty,sort_order
    FROM template_params p;
    DROP TABLE template_params;
    ALTER TABLE template_params_v2 RENAME TO template_params;
    CREATE INDEX IF NOT EXISTS idx_params_template ON template_params(template_id);
  `)
}
```

**迁移总策略（冻结）：启动时一次性升级，仓储层此后只面对 v2。** 顺序至关重要——先趁旧关系表还保留 key/label 时升级文档 JSON（param 元素需要 paramId=key→名称映射），再重建关系表：

```ts
export function runMigrations(client: DbClient): void {
  upgradeDocumentsToV2(client)   // ① 旧库：文档/历史快照升级为 v2（需要旧 key/label）
  client.sqlite.exec(DDL)        // ② 新库建表（全部 IF NOT EXISTS；旧库不受影响）
  migrateParamsTable(client)     // ③ 旧库：template_params 由 id/key/label 重建为 name
}
```

`db/migrate.ts` 顶部：

```ts
import type { DbClient } from './client'
import { migrateDocument, migrateParamValues } from '../print-core/migrate'
```

① 文档升级（幂等：旧表存在且仍含 key 列时才执行）：

```ts
function upgradeDocumentsToV2(client: DbClient): void {
  const cols = client.sqlite.prepare("PRAGMA table_info(template_params)").all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'name')) return // 新库或已升级

  const tRows = client.sqlite.prepare('SELECT * FROM templates').all() as Record<string, unknown>[]
  const updT = client.sqlite.prepare('UPDATE templates SET content = ?, version = 2 WHERE id = ?')
  for (const r of tRows) {
    if (Number(r.version) >= 2) continue
    const pRows = client.sqlite
      .prepare('SELECT * FROM template_params WHERE template_id = ?')
      .all(r.id) as Record<string, unknown>[]
    const raw = { ...r, content: JSON.parse(String(r.content)), params: pRows }
    const migrated = migrateDocument(raw) as { content: unknown }
    updT.run(JSON.stringify(migrated.content), r.id)
  }

  const jRows = client.sqlite.prepare('SELECT id, template_snapshot, param_values FROM print_jobs').all() as
    { id: string; template_snapshot: string; param_values: string }[]
  const updJ = client.sqlite.prepare('UPDATE print_jobs SET template_snapshot = ?, param_values = ? WHERE id = ?')
  for (const j of jRows) {
    let snap: unknown = null
    try { snap = JSON.parse(j.template_snapshot) } catch { snap = null }
    if (snap && (snap as { version?: number }).version !== 2) {
      let values: Record<string, string> = {}
      try { values = JSON.parse(j.param_values) as Record<string, string> } catch { values = {} }
      updJ.run(JSON.stringify(migrateDocument(snap)), JSON.stringify(migrateParamValues(snap, values)), j.id)
    }
  }
}
```

说明：drizzle 的 json 模式列在裸 better-sqlite3 SQL 中就是 TEXT，故手动 JSON.parse/stringify。历史快照自身已含 params 数组（key/label），migrateDocument/migrateParamValues 不依赖数据库。③ 的关系表重建即本步上方 `migrateParamsTable` 的 SQL。

- [ ] **Step 5: 仓储接入**

`db/repositories/template-repo.ts`：

- ParamRow 改为 `{ templateId: string; name: string; type: string; required: number|boolean; defaultValue: string; dateFormat: string; maxLength: number|null; min: number|null; max: number|null; decimals: number; thousandsSeparator: number|boolean; printOnEmpty: 'blank'|'line'; order: number }`（Drizzle 返回 camelCase）。
- upsert 的 insert 改为：

```ts
        tx.insert(templateParams).values({
          templateId: doc.id, name: p.name, type: p.type,
          required: p.required, defaultValue: p.defaultValue, dateFormat: p.dateFormat,
          maxLength: p.maxLength, min: p.min, max: p.max, decimals: p.decimals,
          thousandsSeparator: p.thousandsSeparator, printOnEmpty: p.printOnEmpty, order: p.order
        }).run()
```

- hydrate 直接组装 v2（启动迁移已保证库内为 v2，不调 migrateDocument）：

```ts
  private hydrate(row: TemplateRow, params: ParamRow[]): TemplateDocument {
    return TemplateDocumentSchema.parse({
      id: row.id, name: row.name, category: row.category, paper: row.paper,
      content: row.content, printMode: row.printMode, printerName: row.printerName,
      isBuiltin: !!row.isBuiltin, version: 2,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      params: params
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((pr) => ({
          name: pr.name, type: pr.type, required: !!pr.required, defaultValue: pr.defaultValue,
          dateFormat: pr.dateFormat, maxLength: pr.maxLength, min: pr.min, max: pr.max,
          decimals: pr.decimals, thousandsSeparator: !!pr.thousandsSeparator,
          printOnEmpty: pr.printOnEmpty, order: pr.order
        }))
    })
  }
```

- [ ] **Step 6: job-repo 与 tplx 导入**

`job-repo.ts`：hydrate 直接 `TemplateDocumentSchema.parse(row.templateSnapshot)`（升级后库内全是 v2；新写入也是 v2）。paramValues 直接用。

`template-service.ts` importFromFile：`TemplateDocumentSchema.parse(migrateDocument(parsed))`（import migrateDocument）。

- [ ] **Step 7: repositories 测试更新**

`tests/db/repositories.test.ts`：sample() 与各用例中 ParamDef 字面量去掉 id/key/label 改 `name`；如有 param 元素改为含 token 的 text。TemplateRepository 的参数读写断言改 name（如按 name 查询/插入往返）。新增一个迁移用例：

```ts
it('旧 v1 库升级后：参数表为 name 列、content 中 param 元素变文本 token', () => {
  // 手工构造旧表结构并插入 v1 数据，再 runMigrations，断言：
  // 1) template_params 新结构含 name='姓名'；2) 模板 hydrate 后元素为 text 且 text='{{姓名}}'，version=2
})
```

实现要点：用 createDb 建临时文件后，`sqlite.exec` 拼出旧 DDL（含 key/label 与 version=1），INSERT 一条模板（content 含 param 元素）+ 参数行，再 runMigrations，然后用 TemplateRepository 读取断言。旧 DDL 可从 git 历史或 db/migrate.ts 改造前形态复制（在测试内联）。

Run: `npx vitest run` → 全绿。

- [ ] **Step 8: 验证与提交**

此时渲染端仍引用旧字段（tsc 红）属预期，Task 3/4 修复。本步先确保 `npx vitest run` 全绿（测试文件已全部更新）。提交：

```bash
git add print-core db electron tests
git commit -m "refactor(model): 参数改为文本占位符 {{名称}}（content v2，含 v1 数据一次性升级）"
```

---

## Task 3: 设计器适配

**Files:** store/designer-store.ts、designer/{param-manager,element-library,canvas,property-panel}.tsx

- [ ] **Step 1: store**

- 删除 mutate 中关于 param 元素的注释（64–65 行），改为普通说明。
- removeParam 简化：

```ts
  removeParam(name: string) {
    get().mutate((d) => {
      d.params = d.params.filter((p) => p.name !== name)
    })
  },
```

- 新增 renameParam（改名同时替换全部文本 token，与参数替换在同一次 mutate 内）：

```ts
  renameParam(oldName: string, def: ParamDef) {
    get().mutate((d) => {
      const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, 'g')
      for (const el of d.content.elements) {
        if (el.type === 'text' && el.props.text.includes('{{')) el.props.text = el.props.text.replace(re, `{{${def.name}}}`)
      }
      const i = d.params.findIndex((p) => p.name === oldName)
      if (i >= 0) d.params[i] = def
      else d.params.push({ ...def, order: d.params.length })
    })
  },
```

接口声明同步：`removeParam(name: string): void`、`renameParam(oldName: string, def: ParamDef): void`。

- [ ] **Step 2: param-manager 重写**

完整替换 `src/renderer/designer/param-manager.tsx`：

```tsx
import { useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useDesignerStore } from '../store/designer-store'
import { createParamDef, type ParamDef, type ParamType } from '../../../print-core/template-model'

const TYPE_LABEL: Record<ParamType, string> = {
  text: '单行文本', textarea: '多行文本', date: '日期', number: '数字/金额'
}

function uniqueName(docParams: ParamDef[], base: string, exclude?: string): string {
  const used = new Set(docParams.filter((p) => p.name !== exclude).map((p) => p.name))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}${n}`)) n += 1
  return `${base}${n}`
}

export function ParamManager({ onCommitted }: { onCommitted: () => void }): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const addOrUpdateParam = useDesignerStore((s) => s.addOrUpdateParam)
  const renameParam = useDesignerStore((s) => s.renameParam)
  const removeParam = useDesignerStore((s) => s.removeParam)
  const [editing, setEditing] = useState<{ def: ParamDef; isNew: boolean } | null>(null)

  function openNew(): void {
    const name = uniqueName(doc.params, `参数${doc.params.length + 1}`)
    setEditing({ def: createParamDef({ name, type: 'text' }), isNew: true })
  }

  function commit(def: ParamDef, oldName: string, isNew: boolean): void {
    const name = def.name.trim()
    if (!name || /[{}]/.test(name) || /[\r\n]/.test(name)) return
    const finalDef = createParamDef({ ...def, name })
    if (doc.params.some((p) => p.name === name && p.name !== oldName)) return
    if (isNew) addOrUpdateParam(finalDef)
    else renameParam(oldName, finalDef)
    onCommitted()
    setEditing(null)
  }

  return (
    <div>
      <Button size="small" type="dashed" icon={<PlusOutlined />} block onClick={openNew}>添加参数</Button>
      <div style={{ opacity: 0.55, fontSize: 12, margin: '6px 0' }}>
        参数不直接上画布；在文本中用 {'{{参数名称}}'} 引用。
      </div>
      <Table size="small" rowKey="name" pagination={false} style={{ marginTop: 8 }}
        dataSource={[...doc.params].sort((a, b) => a.order - b.order)}
        columns={[
          { title: '参数名称', dataIndex: 'name' },
          { title: '类型', render: (_, r: ParamDef) => TYPE_LABEL[r.type] },
          {
            title: '操作', width: 90,
            render: (_, r: ParamDef) => (
              <Space size="small">
                <a onClick={() => setEditing({ def: r, isNew: false })}>编辑</a>
                <Popconfirm title={`删除参数“${r.name}”？文本中未替换的 {{${r.name}}} 打印时将留空`}
                  onConfirm={() => { removeParam(r.name); onCommitted() }}
                  okText="删除" cancelText="取消">
                  <a style={{ color: '#cf1322' }}>删</a>
                </Popconfirm>
              </Space>
            )
          }
        ]} />
      {editing && (
        <ParamEditModal def={editing.def} isNew={editing.isNew}
          otherNames={doc.params.filter((p) => p.name !== editing.def.name).map((p) => p.name)}
          onCancel={() => setEditing(null)}
          onOk={(def) => commit(def, editing.def.name, editing.isNew)} />
      )}
    </div>
  )
}

function ParamEditModal({ def, isNew, otherNames, onOk, onCancel }: {
  def: ParamDef
  isNew: boolean
  otherNames: string[]
  onOk: (v: ParamDef) => void
  onCancel: () => void
}): JSX.Element {
  const [f, setF] = useState<ParamDef>(def)
  const nameDup = otherNames.includes(f.name.trim())
  const nameBad = !f.name.trim() || /[{}]/.test(f.name) || /[\r\n]/.test(f.name)
  return (
    <Modal open title={isNew ? '添加参数' : '编辑参数'} onCancel={onCancel}
      okButtonProps={{ disabled: nameDup || nameBad }}
      onOk={() => onOk(f)} okText="确定" cancelText="取消">
      <Form layout="vertical" size="small">
        <Form.Item label="参数名称（模板内唯一，可中文；文本中以 {{名称}} 引用）" required
          validateStatus={nameDup || nameBad ? 'error' : ''}
          help={nameDup ? '该名称已存在' : nameBad ? '名称不能为空且不能包含 { }' : undefined}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Form.Item>
        <Form.Item label="类型">
          <Select value={f.type} onChange={(v) => setF({ ...f, type: v })}
            options={(Object.keys(TYPE_LABEL) as ParamType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        </Form.Item>
        <Form.Item label="必填">
          <Switch checked={f.required} onChange={(v) => setF({ ...f, required: v })} />
        </Form.Item>
        <Form.Item label="默认值（日期类型填 today 表示默认当天）">
          <Input value={f.defaultValue} onChange={(e) => setF({ ...f, defaultValue: e.target.value })} />
        </Form.Item>
        {f.type === 'date' && (
          <Form.Item label="日期格式">
            <Select value={f.dateFormat} onChange={(v) => setF({ ...f, dateFormat: v })}
              options={['yyyy-MM-dd', 'yyyy/MM/dd', 'yyyy年M月d日'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
        )}
        {f.type === 'number' && (
          <Form.Item label="数字格式">
            <Space>
              <span>小数位</span>
              <InputNumber min={0} max={6} value={f.decimals} onChange={(v) => setF({ ...f, decimals: v ?? 0 })} />
              <span>千分位</span>
              <Switch checked={f.thousandsSeparator} onChange={(v) => setF({ ...f, thousandsSeparator: v })} />
            </Space>
          </Form.Item>
        )}
        <Form.Item label="值为空时">
          <Select value={f.printOnEmpty} onChange={(v) => setF({ ...f, printOnEmpty: v })}
            options={[{ value: 'blank', label: '留空白' }, { value: 'line', label: '打印占位横线' }]} />
        </Form.Item>
        {!isNew && <div style={{ color: '#999', fontSize: 12 }}>改名会同步替换文本中已引用的 {'{名称}'}。</div>}
      </Form>
    </Modal>
  )
}
```

- [ ] **Step 3: element-library / canvas / property-panel**

element-library.tsx：删除 createElement 之外无用 import 无；把第 49–51 行提示替换为：

```tsx
        <div style={{ opacity: 0.55, fontSize: 12, margin: '6px 0' }}>
          参数在右栏"参数定义"中维护，文本中用 {'{{参数名称}}'} 引用
        </div>
```

canvas.tsx：删除第 93–99 行 `else if (el.type === 'param')` 整段（KText 的 param 分支），其余不动。

property-panel.tsx：删除第 67 行起的 `{el.type === 'param' && (...)}` 整块；在文本属性区（el.type === 'text' 的属性控件内）加"插入参数"：

```tsx
{el.type === 'text' && doc.params.length > 0 && (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>插入参数到文本末尾</div>
    <Select size="small" style={{ width: '100%' }} placeholder="选择参数"
      options={doc.params.map((p) => ({ value: p.name, label: `{{${p.name}}}` }))}
      onChange={(name) => {
        if (!name) return
        const cur = el.type === 'text' ? el.props.text : ''
        updateProps(el.id, { text: `${cur}${cur && !/\s$/.test(cur) ? ' ' : ''}{{${name}}}` })
      }} />
  </div>
)}
```

（先读该文件确认 updateProps 在作用域内可用——现有文本控件即用它。）

- [ ] **Step 4: 验证与提交**

`npm run typecheck` 0 错误；`npx electron-vite build` 成功；`npx vitest run` 全绿。

```bash
git add src
git commit -m "feat(designer): 参数改为命名占位符（不上画布，文本插入 {{名称}}，改名联动）"
```

---

## Task 4: 打印填写页按 name

**Files:** `src/renderer/pages/print.tsx`

- [ ] **Step 1: 替换键引用**

- 第 70 行 `init[p.key]` → `init[p.name]`。
- 第 109 行 `function setValue(key: string, ...)` 可保留参数名 key（局部变量，语义为字段名）；调用处 116/124/133/137 的 `p.key` 全部改 `p.name`。
- 第 114 行 `values[p.key]` → `values[p.name]`。
- 第 259–261 行：label 用 `p.name + (p.required ? ' *' : '')`；`errors.includes(p.key)` 两处 → `p.name`。

- [ ] **Step 2: 验证与提交**

tsc 0；build；测试全绿。

```bash
git add src/renderer/pages/print.tsx
git commit -m "feat(print): 参数填写表单按参数名称取值与校验"
```

---

## Task 5: 内置模板与剩余测试适配

**Files:** `electron/main/services/seed-service.ts`、`tests/main/seed-service.test.ts`、`tests/renderer/designer-store.test.ts`、`tests/main/tplx-roundtrip.test.ts`（仅在需要时）

- [ ] **Step 1: 内置模板改为文本 token**

seed-service.ts：

- 删除 `param(...)` 工厂（不再有 param 元素）；保留 geo/t/rect。
- createParamDef 单参调用改 name：
  - cert：`createParamDef({ name: '姓名', type: 'text', required: true, order: 0 })`、`createParamDef({ name: '日期', type: 'date', required: false, defaultValue: 'today', order: 1 })`。
  - receipt：`{ name: '商品/客户', type: 'text', order: 0 }`、`{ name: '金额', type: 'number', thousandsSeparator: true, order: 1 }`。
  - label：`{ name: '品名', type: 'text', required: true, order: 0 }`、`{ name: '价格', type: 'number', decimals: 2, order: 1 }`。
- 元素：把原 param(...) 调用替换为 t(...) 文本，布局可适当调整：
  - cert：`t('l_name', 35, 130, 140, 8, 2, { text: '兹证明 {{姓名}} 同志：' })`；`t('l_date', 110, 250, 80, 8, 2, { text: '{{日期}}' })`（其余元素保留：外框、标题、"在工作中表现优异…"行去掉原文中不含 token 的段落可保留）。
  - receipt：`t('p_name', 5, 22, 70, 6, 2, { text: '商品：{{商品/客户}}' })`、`t('p_amt', 5, 32, 70, 6, 2, { text: '金额：￥{{金额}}' })`。
  - label：`t('p_name', 2, 3, 36, 8, 2, { text: '品名：{{品名}}', fontSizeMm: 4.5 })`、`t('p_price', 2, 16, 36, 8, 2, { text: '价格：￥{{价格}}', fontSizeMm: 5 })`。
- SEED_VERSION 改为 `'m3-v2-params'`（触发已有内置模板重新播种：seedIfNeeded 发现版本不同→按固定 id upsert 覆盖旧内置模板；用户自建模板不受影响）。

- [ ] **Step 2: seed 测试**

`tests/main/seed-service.test.ts`：

- 规格断言 params keys 改 names：`['姓名','日期']`；receipt `['商品/客户','金额']`；label `['品名','价格']`。
- 元素断言改为含 token 的文本：如 receipt 规格中存在 text 元素 `props.text` 包含 `{{商品/客户}}`，不存在 type==='param'。
- 幂等用例不变（插 3/再跑 0）。

- [ ] **Step 3: designer-store 与 tplx 测试**

- `tests/renderer/designer-store.test.ts`：把 param 元素/addOrUpdateParam 相关用例改为新模型（addOrUpdateParam 用 name；新增 renameParam 用例：改名后文本 token 同步）：

```ts
it('renameParam 改名并同步文本 token', () => {
  // 建文档：一个参数"姓名" + 文本 "你好{{姓名}}"
  // renameParam('姓名', createParamDef({ name: '收件人', type: 'text' }))
  // 断言 params 名称为收件人；文本为 "你好{{收件人}}"
})
it('removeParam 仅删除定义，不动文本元素', () => { /* 文本保留，token 渲染时为空 */ })
```

- `tplx-roundtrip.test.ts`：未用 param 元素则不动；若 createParamDef 出现则改 name。

- [ ] **Step 4: 全量验证与提交**

`npx vitest run`（全绿）、tsc 0、build。

```bash
git add electron tests
git commit -m "refactor(seed): 内置示例改为文本 token 参数；参数相关测试迁移到 v2"
```

---

## Task 6: 全量回归、CDP 走查、文档与打包

- [ ] **Step 1: 自动化回归**

`npm run bin:node` → `npx vitest run`（全绿）→ `npm run typecheck` 0 → `npm run bin:electron` → `npx electron-vite build`。

- [ ] **Step 2: CDP 走查要点**

1. 用户既有"测试"模板（v1）打开正常：原 param 占位变为 `{{名称}}` 文本，参数表单按名称显示，打印预览正确替换；
2. 新建模板：添加参数"收件人"（不上画布）；添加文本"您好{{收件人}}"（右栏插入参数或双击手输）；打印页填写后预览替换；
3. 改名"收件人"→"客户名"后文本 token 同步；重名被禁止；
4. 内置三模板升级为 token 形态（SEED_VERSION 变化后覆盖）；
5. 打印历史旧记录（v1 快照）打开重打正常，参数值不丢；
6. 全应用零 console 异常。

- [ ] **Step 3: 文档与记忆**

更新设计文档 §4 元素模型（删 param 元素）、参数定义（单 name）、§7.1 求值（token 语法/正则）、数据模型表 template_params；项目记忆记录 v2 迁移。

- [ ] **Step 4: 打包**

`npm run dist`；切回 node ABI。

---

## 自查记录

- 需求三条映射：①参数不上画布 → Task 1 删元素类型 + Task 3 管理器不插图/canvas 删分支；②名称与标识融合 → ParamDef.name 单字段，关系表 name 列，PK(template_id,name)；③文本 {{名称}} 引用 → Task 2 分段插值 + Task 3 插入参数 UI。
- 数据安全：v1 升级在 runMigrations 内一次性完成（templates.content/version、print_jobs 快照与参数值、template_params 重建），迁移有 TDD 纯函数测试 + 仓储级旧库升级测试；幂等（以表列名/version 判定）。
- 不做：token 存在性强校验（未知名渲染为空）、token 富文本/样式片段、参数拖拽上画布。
