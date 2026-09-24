# 仅打印文本（预印纸套打）设计

日期：2026-09-24
状态：已确认（方案 A：HTML 生成时结构性省略非文本元素）

## 1. 背景与目标

部分用户使用**已预印图形背景的纸张**（证书、票据、价签等），模板中只需要叠加文字内容。
需要一个「仅打印文本」选项：启用时打印输出只包含文本元素，不输出任何图片与图形
（矩形/椭圆/直线/边框）。预览必须与实际打印一致。

决策（用户确认）：

1. **按模板记忆**：作为模板文档字段随模板保存，复用打印页现有的"打印后保存到原模板/另存为/不保存"流程；历史重打沿用打印时的快照。
2. **默认勾选**：所有模板读入时默认 `true`（含 3 个内置示例与全部存量模板）；需要完整打印的模板取消勾选一次并保存即永久恢复。

非目标（YAGNI）：

- 不做全局设置（不进"打印机设置"页、不进 AppSettings）。
- 不在设计器中放置该开关（与 printMode 一致，属打印侧选项，设计器画布始终显示全部元素）。
- 不增加历史列表的相关筛选/列。
- 不做逐元素"是否打印"的细粒度控制；非文本元素只有"全输出/全不输出"两态。

## 2. 数据模型

### 2.1 文档字段

`print-core/template-model.ts` 的 `TemplateDocumentSchema` 顶层新增（与 `printMode` 同级）：

```ts
textOnly: z.boolean().default(true)
```

- 类型 `TemplateDocument` 同步获得 `textOnly: boolean`。
- `createTemplate()` 工厂显式写入 `textOnly: true`。
- **不提升 `content.version`**：该字段是文档顶层字段而非 content 内结构，
  zod 在读出缺字段的旧文档/旧历史快照时自动补 `true`，无需 `print-core/migrate.ts` 的版本迁移。
- 复制模板（duplicate）、`.tplx` 导入导出随整文档 JSON 自然携带；
  旧 `.tplx` 文件缺字段时经 `migrateDocument` + `TemplateDocumentSchema.parse` 默认 `true`。

### 2.2 数据库

`templates` 表新增列：

```sql
text_only INTEGER NOT NULL DEFAULT 1
```

- drizzle `db/schema.ts` templates 表加 `textOnly: integer('text_only', { mode: 'boolean' }).notNull().default(true)`。
- `db/migrate.ts`：
  - 建表 DDL 中直接包含新列（新库）。
  - 新增幂等迁移步骤：`PRAGMA table_info(templates)` 检查无 `text_only` 列时
    `ALTER TABLE templates ADD COLUMN text_only INTEGER NOT NULL DEFAULT 1`（旧库存量行自动为 1）。
  - 步骤位置：在 `DDL` 建表之后执行（与既有迁移同一 `runMigrations` 顺序内追加，不影响 v2/v3 既有顺序）。
- `db/repositories/template-repo.ts`：
  - `TemplateRow` 加 `textOnly: number | boolean`；
  - `upsert()` row 写入 `textOnly: doc.textOnly`；
  - `hydrate()` raw 带 `textOnly: !!row.textOnly`（zod 兜底仍在）。
- `print_jobs` **不加列**：`template_snapshot` JSON 已含完整文档（含 textOnly），
  重打与缩略图按快照渲染即可。

## 3. 打印核心（方案 A：生成时省略）

`print-core/render-print-document.ts`：

- `renderPrintDocument(doc, values, assetUrls)` 内在按 zIndex 排序前过滤：

```ts
const elements = doc.textOnly
  ? doc.content.elements.filter((el) => el.type === 'text')
  : doc.content.elements
```

- 文本路径（横排/竖排、token 插值、字体、加粗/斜体/下划线、对齐、行高、裁剪）不变。
- 因为图片/图形节点根本不生成：
  - 不会输出 `<img>`，也就不依赖任何 asset URL；
  - 不会输出矩形/椭圆/直线（含内置模板边框）。
- `RenderOptions`（assetUrls 扁平 Record）签名不变。

`electron/main/services/print-service.ts`：

- 渲染调用不变（字段经 doc 传入），HTML、实际打印、缩略图三处共用同一纯函数输出，天然一致。
- 打印前"图片资产必须存在"校验增加条件：`doc.textOnly === true` 时跳过图片元素的资产存在性检查
  （图片不输出，缺资产不应阻止仅文本打印）。
- `assetFileUrls()` 可照旧计算（无图片元素时自然为空 Record），无需特判。
- 写入历史的 `templateSnapshot` 为携带 textOnly 的完整工作副本（含全部元素定义，只是本次不渲染），
  保证日后取消勾选仍可恢复完整打印。

## 4. 渲染端 UI（打印页）

文件：`src/renderer/pages/print.tsx`。

- 新增 state `const [textOnly, setTextOnly] = useState(true)`，在文档加载 effect 中
  `setTextOnly(loaded.textOnly ?? true)`（与 printMode 初始化同处）。
- 左侧控制面板，在"静默直打"开关所在的 Space 内新增：

  > Switch「仅打印文本」（默认开）

  下方一行浅色说明文案：只输出文字，不打印图片/图形/边框，适合已预印底图的纸张。
- 预览：`previewHtml` 的 useMemo 依赖中以工作副本 `{...doc, textOnly}` 替代 doc，
  开关切换即时重渲染 iframe，所见即所得。
- 提交：`submitNow()` 中 `working: TemplateDocument = { ...doc!, printMode: mode, printerName, textOnly }`；
  随 `api.print.submit` 发出。
- 保存回流：现有"打印成功且相对基线有改动 → 保存到原模板/另存为新模板/不保存"弹窗无需新增逻辑——
  `baselineRef` 持有打开时的 textOnly，切换开关即构成改动，走既有保存决策；
  `saveOverwrite` 保存 working 即完成按模板记忆。
- "调整版式"往返设计器：`editLayout()` 放入 sessionDraft 的文档改为携带当前开关状态的工作副本
  `{ ...doc, printMode: mode, printerName, textOnly }`（现状只放原始 doc，开关改动会在往返后丢失，
  本次顺带修正为工作副本）；设计器不展示该开关但 store 的 mutate 基于同文档克隆，不删字段；
  返回打印页后从 sessionDraft 载入，开关状态保留。
- IPC 契约：`SubmitPrintInput.template: TemplateDocument` 已携带新字段，
  **shared/ipc-contract.ts 无结构改动**。

## 5. 边界与正确性

- textOnly=true 且模板无任何文本元素：输出空白页（合法，等同全元素都被过滤）；不报错。
- textOnly=true 时图片资产文件丢失：允许打印（跳过校验）。
- 仅文本模式下 token 未定义仍替换为空串、`printOnEmpty:line` 仍输出下划线占位——行为与完整模式一致。
- 横/竖排文本的裁剪与字体行为与现状一致（不涉及本次改动）。
- 内置模板 textOnly 默认 true 后首次打印无边框，属预期；取消勾选并保存后永久恢复完整打印。
- 历史旧快照缺 textOnly 字段：zod 解析默认 true——旧记录重打变为仅文本。
  这是用户已确认的统一规则的一部分；旧缩略图文件保持历史原样不重绘。

## 6. 测试策略

### 6.1 自动化（vitest）

- `tests/print-core/template-model.test.ts`：
  - `createTemplate()` 产出 textOnly=true；
  - zod 解析缺字段文档默认 true；显式 false 被保留。
- `tests/print-core/render-print-document.test.ts`：
  - textOnly=true（默认）：含 image+shape+text 的文档渲染结果无 `<img`、无 `border:`/`ellipse`/`border-top` 形状输出，文本与 token 插值正常；
  - textOnly=false：图片/图形/文本全部输出（回归现有行为）；
  - textOnly=true 时渲染不依赖 assetUrls（传空对象不抛错、无 src 泄漏）。
- `tests/print-core/migrate.test.ts`：旧版本文档经 migrateDocument+parse 后 textOnly=true。
- `tests/db/repositories.test.ts`：upsert 带 textOnly=false 的文档后读回为 false；
  缺字段的旧结构文档读回为 true。
- `tests/print-core/end-to-end-document.test.ts`：补一条仅文本打印 HTML 不含非文本元素的断言。

### 6.2 门禁与实测

- `npx vitest run` 全绿；`npm run typecheck` 0；`npx electron-vite build` 成功。
- 用项目技能 `electron-cdp-walkthrough` 对真实应用走查：
  1. 打开含图形/图片的模板进打印页，「仅打印文本」默认开：预览 iframe 中无图形边框/图片，仅文本；
  2. 关闭开关：边框/图片即时出现，重开即时消失；
  3. 仅文本模式下执行打印提交（mock/真实打印机均可，至少校验 submit 成功且无资产校验拦截）；
  4. 打印后保存到原模板，重进打印页开关保持关闭/开启状态；
  5. 历史重打携带快照中的 textOnly；
  6. 全程零 console 异常；走查模板 `__CDP_*` 前后双清，不动"测试"与 builtin-* 数据。

## 7. 受影响文件清单

- `print-core/template-model.ts`：字段 + 工厂。
- `print-core/render-print-document.ts`：元素过滤。
- `electron/main/services/print-service.ts`：仅文本跳过图片资产校验。
- `db/schema.ts`、`db/migrate.ts`、`db/repositories/template-repo.ts`：列与读写。
- `src/renderer/pages/print.tsx`：开关、预览工作副本、提交/保存携带。
- 测试：template-model / render-print-document / migrate / repositories / end-to-end-document。
- 无 IPC 契约改动、无设置页改动、无设计器改动。
