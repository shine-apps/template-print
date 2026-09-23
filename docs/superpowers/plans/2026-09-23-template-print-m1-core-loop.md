# 模板打印程序 M1（核心闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可安装运行的 Windows 桌面应用：设计图文模板（文本/参数/图片/图形）、填参实时预览、静默直打或弹框打印、打印历史与重打、打印机枚举与测试页。

**Architecture:** Electron 三端（main / preload / renderer）+ React。渲染进程只做 UI，经类型安全 IPC 调主进程服务；纯逻辑核心 `print-core/`（zod 模型、参数求值、打印 HTML 文档）无 DOM 依赖可单测；Drizzle + better-sqlite3，SQL 收敛在 repositories；离屏隐藏窗口加载打印 HTML 后调 `webContents.print` 输出。

**Tech Stack:** Electron 31 / electron-vite 2 / React 18 / TypeScript 5 / Ant Design 5 / Zustand 4 / Konva 9 + react-konva 18 / Drizzle ORM 0.33 + better-sqlite3 11 / zod 3 / dayjs / Vitest 2 / electron-builder 25

**约定：**

- 包管理器用 Bun；命令同时给出 npm 等价形式。
- 所有几何单位内部一律毫米（mm），Chromium 纸张用微米（μm），字号内部存 mm、界面显示 pt。
- 每个任务结束都提交；提交命令中如本机 git 身份未配置，统一追加 `-c user.name=dev -c user.email=dev@local`。
- 本计划只含 M1；条码/二维码、旋转、吸附、导入导出、打印机状态检查属于 M2，不在本计划。
- 测试一律用 Node 运行：`npx vitest run [路径]`（Windows 版 Bun 不支持 better-sqlite3 等原生模块）。
- tsc 调用本地编译器：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（本机 npx 会误拉到全局 tsc 2.0.4）。

### 实施勘误（Task 2–5 落地后更新，后续任务以此为准）

1. `createParamDef(...)` 生成的参数定义 **id 等于 key**（即 `id: input.key`）。参数元素的 `paramId` 即参数 key；参数值始终按 key 存取。模板复制时 id 映射保持恒等即可。**编辑已有参数时 key 不可修改**（Task 15 的编辑弹窗中 key 输入框 disabled，避免画布引用悬空）。
2. `renderPrintDocument(doc, values, assetUrls)` 第三参为**扁平**的 `Record<assetId, url>`，不是 `{ assetUrls }` 包装。
3. 日期格式对外仍用 `yyyy/dd/d` 小写 token，`formatDate` 内部已做归一化，调用方无需处理。

---

## 文件结构总览

```
template-print/
├─ package.json  tsconfig.json  tsconfig.node.json  electron.vite.config.ts
├─ electron/
│  ├─ main/
│  │  ├─ index.ts                 应用/窗口生命周期
│  │  ├─ app-paths.ts             userData 目录与路径
│  │  ├─ settings.ts              settings.json（app 默认打印机等）
│  │  ├─ ipc/index.ts             注册全部 IPC
│  │  └─ services/
│  │     ├─ template-service.ts   ├─ asset-service.ts
│  │     ├─ print-service.ts      ├─ printer-service.ts
│  │     └─ history-service.ts
│  └─ preload/index.ts            contextBridge 暴露 window.api
├─ src/                           渲染进程
│  ├─ index.html
│  └─ renderer/
│     ├─ main.tsx  App.tsx
│     ├─ api.ts                   window.api 封装（类型来自 shared）
│     ├─ session-draft.ts         打印页↔设计器的工作副本中转
│     ├─ store/designer-store.ts  Zustand + undo/redo
│     ├─ pages/ templates.tsx designer.tsx print.tsx history.tsx settings.tsx
│     └─ designer/ element-library.tsx layers-panel.tsx canvas.tsx property-panel.tsx param-manager.tsx
├─ shared/
│  ├─ units.ts                    单位换算
│  ├─ paper-presets.ts            A4/A3/58mm/80mm/标签预设
│  └─ ipc-contract.ts             IPC 通道名 + Api 接口类型
├─ print-core/
│  ├─ template-model.ts           zod 模型/类型/工厂
│  ├─ param-evaluator.ts          参数求值与格式化
│  └─ render-print-document.ts    模板+参数+图片URL → 完整 HTML 文档
├─ db/
│  ├─ client.ts                   better-sqlite3 连接
│  ├─ schema.ts                   5 张表
│  ├─ migrate.ts                  启动时建表（幂等）
│  └─ repositories/ template-repo.ts asset-repo.ts job-repo.ts
└─ tests/                         Vitest（镜像 print-core/、db/ 结构）
```

---

## Task 1: 项目脚手架（electron-vite + React + AntD 空窗口跑通）

**Files:**

- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`
- Create: `electron/main/index.ts`, `electron/preload/index.ts`
- Create: `src/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`

- [ ] **Step 1: 写 package.json 与配置文件**

`package.json`：

```json
{
  "name": "template-print",
  "version": "0.1.0",
  "private": true,
  "description": "可视化模板设计与打印桌面程序",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "rebuild": "electron-builder install-app-deps",
    "dist": "electron-vite build && electron-builder --win nsis"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "drizzle-orm": "^0.33.0",
    "dayjs": "^1.11.13",
    "nanoid": "^3.3.7",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "antd": "^5.21.0",
    "@ant-design/icons": "^5.5.1",
    "zustand": "^4.5.5",
    "konva": "^9.3.16",
    "react-konva": "^18.2.10",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.16.5",
    "@types/better-sqlite3": "^7.6.11",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^31.4.0",
    "electron-builder": "^25.0.5",
    "electron-vite": "^2.3.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.6",
    "vitest": "^2.1.1"
  }
}
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["shared/*"], "@core/*": ["print-core/*"] },
    "types": ["node", "vite/client"]
  },
  "include": ["src", "electron", "shared", "print-core", "db", "tests",
    "electron.vite.config.ts", "vitest.config.ts"]
}
```

`electron.vite.config.ts`：

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: r('electron/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: r('electron/preload/index.ts') } } }
  },
  renderer: {
    root: r('src'),
    resolve: {
      alias: {
        '@shared': r('shared'),
        '@core': r('print-core')
      }
    },
    plugins: [react()],
    build: { rollupOptions: { input: { index: r('src/index.html') } } }
  }
})
```

`vitest.config.ts`（项目根）：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
})
```

> 测试全部使用相对路径导入（如 `../../shared/units`），无需别名。

- [ ] **Step 2: 写主进程/preload/渲染入口**

`electron/main/index.ts`：

```ts
import { app, BrowserWindow } from 'electron'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: 'placeholder-replaced-at-build',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // electron-vite dev 下由其注入 dev server URL；打包后加载文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile('placeholder-renderer')
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

> preload 与 loadFile 的占位字符串在 Task 7 替换为真实路径（`join(__dirname, '../preload/index.js')` 与 `join(__dirname, '../renderer/index.html')`）。脚手架阶段先用 electron-vite 文档的标准写法覆盖——Step 3 立即修正，因此本步结束后不要长时间停留在占位版。

`electron/preload/index.ts`：

```ts
// M1 首个可运行版本暂无白名单 API，Task 7 补全
export {}
```

`src/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>模板打印</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./renderer/main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`：

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/App.tsx`：

```tsx
import { ConfigProvider, Typography } from 'antd'
import zhCN from 'antd/locale/zh_CN'

export function App(): JSX.Element {
  return (
    <ConfigProvider locale={zhCN}>
      <div style={{ padding: 24 }}>
        <Typography.Title level={3}>模板打印 · M1 脚手架就绪</Typography.Title>
      </div>
    </ConfigProvider>
  )
}
```

- [ ] **Step 3: 立即修正主进程为 electron-vite 标准路径写法**

把 `electron/main/index.ts` 中 `webPreferences.preload` 与 `loadFile` 两处占位替换为：

```ts
import { join } from 'node:path'
// ...
preload: join(__dirname, '../preload/index.js'),
// ...
void win.loadFile(join(__dirname, '../renderer/index.html'))
```

- [ ] **Step 4: 安装依赖**

Run: `bun install`
（npm 等价：`npm install`）
Expected: 依赖安装成功；better-sqlite3 使用预编译二进制（Task 2–6 的 Vitest 在此形态下运行）。

> 原生模块 ABI 约定：Task 7 主进程首次加载 better-sqlite3 前才执行 `bun run rebuild`（编译为 Electron ABI）。若 rebuild 后需要再跑仓储测试而 Vitest 无法加载该模块，执行一次 `bun install` 恢复预编译二进制，dev/打包前再 rebuild。

- [ ] **Step 5: 运行开发模式验证**

Run: `bun run dev`
Expected: 弹出 1280×820 窗口，标题"模板打印"，页面显示"模板打印 · M1 脚手架就绪"。

- [ ] **Step 6: 类型检查并提交**

Run: `bun run typecheck`
Expected: 无错误。

```bash
git add package.json tsconfig.json electron.vite.config.ts vitest.config.ts electron src
git commit -m "chore: electron-vite + React + AntD 脚手架"
```

---

## Task 2: shared 单位换算与纸张预设（TDD）

**Files:**

- Create: `shared/units.ts`, `shared/paper-presets.ts`
- Test: `tests/shared/units.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/shared/units.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mmToPxAt96, pxToMmAt96, mmToMicron, ptToMm, mmToPt } from '../../shared/units'

describe('单位换算', () => {
  it('mm↔px 按 96dpi（1mm = 96/25.4 px）', () => {
    expect(mmToPxAt96(25.4)).toBeCloseTo(96, 6)
    expect(pxToMmAt96(96)).toBeCloseTo(25.4, 6)
  })
  it('mm → 微米', () => {
    expect(mmToMicron(40)).toBe(40000)
  })
  it('pt 与 mm 互转（1pt = 25.4/72 mm）', () => {
    expect(ptToMm(72)).toBeCloseTo(25.4, 6)
    expect(mmToPt(25.4)).toBeCloseTo(72, 6)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun run test -- tests/shared/units.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`shared/units.ts`：

```ts
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
```

`shared/paper-presets.ts`：

```ts
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
```

- [ ] **Step 4: 运行确认通过并提交**

Run: `bun run test -- tests/shared/units.test.ts` → PASS。

```bash
git add shared/units.ts shared/paper-presets.ts tests/shared/units.test.ts
git commit -m "feat(shared): 毫米/像素/微米/磅换算与纸张预设"
```

---

## Task 3: print-core 模板模型（zod）与工厂（TDD）

**Files:**

- Create: `print-core/template-model.ts`
- Test: `tests/print-core/template-model.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/print-core/template-model.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  TemplateDocumentSchema,
  createTemplate,
  createElement,
  createParamDef
} from '../../print-core/template-model'

describe('模板模型校验', () => {
  it('合法模板通过校验', () => {
    const tpl = createTemplate('t1', '测试', { widthMm: 210, heightMm: 297 })
    tpl.params.push(createParamDef({ key: 'name', label: '姓名', type: 'text' }))
    tpl.content.elements.push(
      createElement('text', { text: '标题' }, { x: 10, y: 10, w: 80, h: 10 }),
      createElement('param', { paramId: 'name' }, { x: 10, y: 30, w: 60, h: 8 })
    )
    expect(() => TemplateDocumentSchema.parse(tpl)).not.toThrow()
  })

  it('未知元素类型被拒绝', () => {
    const tpl = createTemplate('t2', '坏模板', { widthMm: 40, heightMm: 30 })
    const bad = JSON.parse(JSON.stringify(tpl))
    bad.content.elements.push({ id: 'x', type: 'video', x: 0, y: 0, w: 1, h: 1 })
    expect(() => TemplateDocumentSchema.parse(bad)).toThrow()
  })

  it('参数 key 重复被拒绝', () => {
    const tpl = createTemplate('t3', '参数重复', { widthMm: 40, heightMm: 30 })
    tpl.params.push(createParamDef({ key: 'date', label: '日期', type: 'date' }))
    tpl.params.push(createParamDef({ key: 'date', label: '日期2', type: 'date' }))
    expect(() => TemplateDocumentSchema.parse(tpl)).toThrow(/重复|unique/i)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun run test -- tests/print-core/template-model.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现模型**

`print-core/template-model.ts`：

```ts
import { z } from 'zod'

export const CONTENT_VERSION = 1

// ---------- 几何（单位 mm） ----------
const GeometrySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number().finite().default(0),
  locked: z.boolean().default(false),
  zIndex: z.number().int().default(0)
})
export type Geometry = z.infer<typeof GeometrySchema>

// ---------- 各元素 ----------
const BaseProps = z.object({})
export const TextElementSchema = Geometry.extend({
  id: z.string().min(1),
  type: z.literal('text'),
  props: z.object({
    text: z.string().default(''),
    fontFamily: z.string().default('Microsoft YaHei'),
    fontSizeMm: z.number().positive().default(5),
    bold: z.boolean().default(false),
    italic: z.boolean().default(false),
    align: z.enum(['left', 'center', 'right']).default('left'),
    color: z.string().default('#000000'),
    lineHeight: z.number().positive().default(1.2)
  })
})

export const ParamElementSchema = Geometry.extend({
  id: z.string().min(1),
  type: z.literal('param'),
  props: z.object({
    paramId: z.string().min(1),
    fontFamily: z.string().default('Microsoft YaHei'),
    fontSizeMm: z.number().positive().default(5),
    bold: z.boolean().default(false),
    align: z.enum(['left', 'center', 'right']).default('left'),
    color: z.string().default('#000000'),
    autoFit: z.boolean().default(true)
  })
})

export const ImageElementSchema = Geometry.extend({
  id: z.string().min(1),
  type: z.literal('image'),
  props: z.object({
    assetId: z.string().min(1),
    fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
    opacity: z.number().min(0).max(1).default(1)
  })
})

export const ShapeElementSchema = Geometry.extend({
  id: z.string().min(1),
  type: z.literal('shape'),
  props: z.object({
    shape: z.enum(['line', 'rect', 'ellipse']),
    strokeColor: z.string().default('#000000'),
    strokeWidthMm: z.number().min(0).default(0.3),
    fillColor: z.string().nullable().default(null)
  })
})

export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ParamElementSchema,
  ImageElementSchema,
  ShapeElementSchema
])
export type TemplateElement = z.infer<typeof ElementSchema>
export type ElementType = TemplateElement['type']

// ---------- 参数定义 ----------
export const ParamTypeSchema = z.enum(['text', 'textarea', 'date', 'number'])
export type ParamType = z.infer<typeof ParamTypeSchema>

export const ParamDefSchema = z.object({
  id: z.string().min(1),
  key: z
    .string()
    .min(1)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'key 必须以字母开头且仅含字母数字下划线'),
  label: z.string().min(1),
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

// ---------- 纸张与模板 ----------
export const PaperSchema = z.object({
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  marginMm: z
    .object({
      t: z.number().min(0).default(0),
      r: z.number().min(0).default(0),
      b: z.number().min(0).default(0),
      l: z.number().min(0).default(0)
    })
    .default({ t: 0, r: 0, b: 0, l: 0 })
})
export type Paper = z.infer<typeof PaperSchema>

export const ContentSchema = z.object({
  elements: z.array(ElementSchema).default([])
})

export const PrintModeSchema = z.enum(['silent', 'dialog'])
export type PrintMode = z.infer<typeof PrintModeSchema>

export const TemplateDocumentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().default(''),
    paper: PaperSchema,
    content: ContentSchema.default({ elements: [] }),
    params: z.array(ParamDefSchema).default([]),
    printMode: PrintModeSchema.default('silent'),
    printerName: z.string().nullable().default(null),
    isBuiltin: z.boolean().default(false),
    version: z.literal(CONTENT_VERSION).default(CONTENT_VERSION),
    createdAt: z.number(),
    updatedAt: z.number()
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>()
    doc.params.forEach((p, i) => {
      if (seen.has(p.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['params', i, 'key'],
          message: `参数 key 重复: ${p.key}`
        })
      }
      seen.add(p.key)
    })
    // param 元素引用的 paramId 必须存在
    doc.content.elements.forEach((el, i) => {
      if (el.type === 'param' && !doc.params.some((p) => p.id === el.props.paramId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['content', 'elements', i],
          message: `参数元素引用了不存在的参数: ${el.props.paramId}`
        })
      }
      if (el.type === 'image') {
        // assetId 存在性由业务层（AssetService）校验，模型层不查库
      }
    })
  })
export type TemplateDocument = z.infer<typeof TemplateDocumentSchema>

// ---------- 工厂 ----------
let seq = 0
export function localId(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 8)}`
}

export function createTemplate(
  id: string,
  name: string,
  paper: { widthMm: number; heightMm: number },
  now: number = Date.now()
): TemplateDocument {
  return {
    id,
    name,
    category: '',
    paper: {
      widthMm: paper.widthMm,
      heightMm: paper.heightMm,
      orientation: 'portrait',
      marginMm: { t: 0, r: 0, b: 0, l: 0 }
    },
    content: { elements: [] },
    params: [],
    printMode: 'silent',
    printerName: null,
    isBuiltin: false,
    version: CONTENT_VERSION,
    createdAt: now,
    updatedAt: now
  }
}

export function createElement(
  type: ElementType,
  props: Record<string, unknown>,
  geo: { x: number; y: number; w: number; h: number }
): TemplateElement {
  // 经 zod 解析补全默认值，保证返回完整元素
  return ElementSchema.parse({
    id: localId('el'),
    type,
    ...geo,
    rotation: 0,
    locked: false,
    zIndex: 0,
    props
  })
}

export function createParamDef(
  input: Pick<ParamDef, 'key' | 'label' | 'type'> & Partial<ParamDef>
): ParamDef {
  return ParamDefSchema.parse({
    id: localId('param'),
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

- [ ] **Step 4: 运行测试通过并提交**

Run: `bun run test -- tests/print-core/template-model.test.ts` → PASS。

```bash
git add print-core/template-model.ts tests/print-core/template-model.test.ts
git commit -m "feat(core): zod 模板/元素/参数模型与工厂"
```

---

## Task 4: print-core 参数求值与格式化（TDD）

**Files:**

- Create: `print-core/param-evaluator.ts`
- Test: `tests/print-core/param-evaluator.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/print-core/param-evaluator.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createParamDef } from '../../print-core/template-model'
import { evaluateParams, formatDate, formatNumber, applyEmpty } from '../../print-core/param-evaluator'

describe('参数求值', () => {
  it('日期按 dateFormat 格式化', () => {
    expect(formatDate('2026-09-03', 'yyyy年M月d日')).toBe('2026年9月3日')
  })
  it('数字千分位与小数位', () => {
    expect(formatNumber('1234567.5', 2, true)).toBe('1,234,567.50')
    expect(formatNumber('12.3', 0, false)).toBe('12')
  })
  it('空值：blank 返回空串；line 返回占位横线标记', () => {
    expect(applyEmpty('', 'blank')).toBe('')
    expect(applyEmpty('   ', 'line')).toBe('{{__EMPTY_LINE__}}')
  })
  it('evaluateParams 汇总各类型默认值与 today', () => {
    const defs = [
      createParamDef({ key: 'name', label: '姓名', type: 'text', defaultValue: '张三' }),
      createParamDef({ key: 'date', label: '日期', type: 'date', defaultValue: 'today' }),
      createParamDef({ key: 'amount', label: '金额', type: 'number', decimals: 2, thousandsSeparator: true })
    ]
    const out = evaluateParams(defs, { amount: '99.9' }, new Date(2026, 8, 23))
    expect(out.name).toBe('张三')
    expect(out.date).toBe('2026-09-23')
    expect(out.amount).toBe('99.90')
  })
  it('必填校验返回错误键集合', () => {
    const defs = [createParamDef({ key: 'name', label: '姓名', type: 'text', required: true })]
    const out = evaluateParams(defs, { name: '' }, new Date(2026, 8, 23))
    expect(out.__errors).toContain('name')
  })
})
```

- [ ] **Step 2: 运行确认失败** → `bun run test -- tests/print-core/param-evaluator.test.ts`，FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`print-core/param-evaluator.ts`：

```ts
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import type { ParamDef } from './template-model'

dayjs.extend(customParseFormat)

export const EMPTY_LINE_TOKEN = '{{__EMPTY_LINE__}}'

export type EvaluatedValues = Record<string, string> & { __errors?: string[] }

export function formatDate(raw: string, dateFormat: string): string {
  const d = dayjs(raw)
  return d.isValid() ? d.format(dateFormat) : raw
}

export function formatNumber(raw: string, decimals: number, sep: boolean): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  const fixed = n.toFixed(decimals)
  if (!sep) return fixed
  const [int, dec] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec ? `${grouped}.${dec}` : grouped
}

export function applyEmpty(raw: string, mode: 'blank' | 'line'): string {
  if (raw.trim() !== '') return raw
  return mode === 'line' ? EMPTY_LINE_TOKEN : ''
}

/**
 * 求全部参数的打印文本。
 * @param now 注入当前时间，便于测试
 */
export function evaluateParams(
  defs: ParamDef[],
  input: Record<string, string>,
  now: Date = new Date()
): EvaluatedValues {
  const out: EvaluatedValues = {}
  const errors: string[] = []

  for (const def of defs) {
    let raw = input[def.key]
    if (raw === undefined) {
      raw = def.defaultValue === 'today' && def.type === 'date'
        ? dayjs(now).format('YYYY-MM-DD')
        : def.defaultValue
    }

    if (raw.trim() === '' && def.required) errors.push(def.key)

    let value: string
    switch (def.type) {
      case 'date':
        value = raw.trim() === '' ? '' : formatDate(raw, def.dateFormat)
        break
      case 'number':
        value = raw.trim() === '' ? '' : formatNumber(raw, def.decimals, def.thousandsSeparator)
        break
      default:
        value = raw
    }
    out[def.key] = applyEmpty(value, def.printOnEmpty)
  }

  if (errors.length > 0) out.__errors = errors
  return out
}

/** 替换条码/文本表达式中的 {{key}}（M1 文本渲染不使用，预留给 M2，先放工具函数并测） */
export function interpolate(expr: string, values: Record<string, string>): string {
  return expr.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => values[key] ?? '')
}
```

> `customParseFormat` 插件随 dayjs 自带，无需额外依赖。

- [ ] **Step 4: 运行通过并提交**

Run: `bun run test -- tests/print-core/param-evaluator.test.ts` → PASS。

```bash
git add print-core/param-evaluator.ts tests/print-core/param-evaluator.test.ts
git commit -m "feat(core): 参数求值/日期数字格式化/必填校验"
```

---

## Task 5: print-core 打印 HTML 文档渲染（TDD）

**Files:**

- Create: `print-core/render-print-document.ts`
- Test: `tests/print-core/render-print-document.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/print-core/render-print-document.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createTemplate, createElement, createParamDef } from '../../print-core/template-model'
import { renderPrintDocument } from '../../print-core/render-print-document'

function buildDoc() {
  const tpl = createTemplate('t1', '证书', { widthMm: 210, heightMm: 297 })
  tpl.params.push(createParamDef({ key: 'name', label: '姓名', type: 'text' }))
  tpl.content.elements.push(
    createElement('text', { text: '荣誉证书', fontSizeMm: 10, bold: true, align: 'center' }, { x: 30, y: 20, w: 150, h: 14 }),
    createElement('param', { paramId: tpl.params[0].id }, { x: 40, y: 80, w: 80, h: 8 }),
    createElement('shape', { shape: 'rect', strokeColor: '#000', strokeWidthMm: 0.5, fillColor: null }, { x: 10, y: 10, w: 190, h: 277 }),
    createElement('image', { assetId: 'a1', fit: 'contain', opacity: 1 }, { x: 150, y: 230, w: 30, h: 30 })
  )
  return tpl
}

describe('renderPrintDocument', () => {
  it('输出含毫米 @page 与绝对定位元素', () => {
    const html = renderPrintDocument(buildDoc(), { name: '张三' }, { a1: 'file:///img/a1.png' })
    expect(html).toContain('@page')
    expect(html).toContain('size: 210mm 297mm')
    expect(html).toContain('position:absolute')
    expect(html).toContain('荣誉证书')
    expect(html).toContain('张三')
    expect(html).toContain('file:///img/a1.png')
    expect(html).toContain('print-color-adjust: exact')
  })

  it('空值横线元素渲染为下边框空 div', () => {
    const tpl = buildDoc()
    const html = renderPrintDocument(tpl, { name: '{{__EMPTY_LINE__}}' }, { a1: '' })
    expect(html).toContain('border-bottom:')
  })

  it('所有 HTML 特殊字符被转义', () => {
    const tpl = createTemplate('t2', 'x', { widthMm: 40, heightMm: 30 })
    tpl.content.elements.push(createElement('text', { text: '<b>&</b>' }, { x: 0, y: 0, w: 30, h: 5 }))
    const html = renderPrintDocument(tpl, {}, {})
    expect(html).toContain('&lt;b&gt;&amp;&lt;/b&gt;')
    expect(html).not.toContain('<b>&</b>')
  })
})
```

- [ ] **Step 2: 运行确认失败** → `bun run test -- tests/print-core/render-print-document.test.ts`，FAIL。

- [ ] **Step 3: 实现渲染器**

`print-core/render-print-document.ts`：

```ts
import type { TemplateDocument, TemplateElement } from './template-model'
import { EMPTY_LINE_TOKEN } from './param-evaluator'

export interface RenderOptions {
  /** assetId → 可在打印窗口/预览中访问的图片 URL（file:// 或 data:） */
  assetUrls: Record<string, string>
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function geoStyle(el: TemplateElement): string {
  return [
    `left:${el.x}mm`,
    `top:${el.y}mm`,
    `width:${el.w}mm`,
    `height:${el.h}mm`,
    el.rotation ? `transform:rotate(${el.rotation}deg)` : '',
    'position:absolute',
    'box-sizing:border-box'
  ]
    .filter(Boolean)
    .join(';')
}

function renderElement(el: TemplateElement, values: Record<string, string>, assetUrls: Record<string, string>): string {
  const style = geoStyle(el)
  switch (el.type) {
    case 'text': {
      const p = el.props
      return `<div style="${style};font-family:'${esc(p.fontFamily)}';font-size:${p.fontSizeMm}mm;` +
        `font-weight:${p.bold ? 'bold' : 'normal'};font-style:${p.italic ? 'italic' : 'normal'};` +
        `text-align:${p.align};color:${p.color};line-height:${p.lineHeight};` +
        `display:flex;align-items:flex-start;justify-content:${p.align === 'center' ? 'center' : p.align === 'right' ? 'flex-end' : 'flex-start'}">` +
        `${esc(p.text)}</div>`
    }
    case 'param': {
      const p = el.props
      const raw = values[p.paramId] ?? ''
      if (raw === EMPTY_LINE_TOKEN) {
        return `<div style="${style};border-bottom:0.3mm solid #000"></div>`
      }
      return `<div style="${style};font-family:'${esc(p.fontFamily)}';font-size:${p.fontSizeMm}mm;` +
        `font-weight:${p.bold ? 'bold' : 'normal'};text-align:${p.align};color:${p.color};` +
        `overflow:hidden;white-space:pre-wrap;word-break:break-word">${esc(raw)}</div>`
    }
    case 'image': {
      const p = el.props
      const src = assetUrls[p.assetId] ?? ''
      const objectFit = p.fit === 'fill' ? 'fill' : p.fit
      return `<div style="${style};overflow:hidden"><img src="${esc(src)}" ` +
        `style="width:100%;height:100%;object-fit:${objectFit};opacity:${p.opacity}" /></div>`
    }
    case 'shape': {
      const p = el.props
      if (p.shape === 'line') {
        return `<div style="${style};border-top:${p.strokeWidthMm}mm solid ${p.strokeColor};height:0;top:${el.y + el.h / 2}mm"></div>`
      }
      const radius = p.shape === 'ellipse' ? '50%' : '0'
      return `<div style="${style};border:${p.strokeWidthMm}mm solid ${p.strokeColor};` +
        `border-radius:${radius};background:${p.fillColor ?? 'transparent'}"></div>`
    }
  }
}

export function renderPrintDocument(
  doc: TemplateDocument,
  values: Record<string, string>,
  options: RenderOptions
): string {
  const { widthMm, heightMm } = doc.paper
  const sorted = [...doc.content.elements].sort((a, b) => a.zIndex - b.zIndex)
  const body = sorted.map((el) => renderElement(el, values, options.assetUrls)).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${widthMm}mm; height: ${heightMm}mm;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { overflow: visible; }
</style>
</head>
<body>
${body}
</body>
</html>`
}
```

- [ ] **Step 4: 运行通过并提交**

Run: `bun run test -- tests/print-core/render-print-document.test.ts` → PASS；再跑 `bun run test` 确认全绿。

```bash
git add print-core/render-print-document.ts tests/print-core/render-print-document.test.ts
git commit -m "feat(core): 毫米绝对定位打印 HTML 文档渲染器"
```

---

## Task 6: 数据库 schema、迁移与 repositories（TDD）

**Files:**

- Create: `db/client.ts`, `db/schema.ts`, `db/migrate.ts`
- Create: `db/repositories/template-repo.ts`, `db/repositories/asset-repo.ts`, `db/repositories/job-repo.ts`
- Test: `tests/db/repositories.test.ts`

- [ ] **Step 1: 写 schema 与 client**

`db/schema.ts`：

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull().default(''),
  paper: text('paper', { mode: 'json' }).notNull(),
  content: text('content', { mode: 'json' }).notNull(),
  printMode: text('print_mode').notNull().default('silent'),
  printerName: text('printer_name'),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const templateParams = sqliteTable('template_params', {
  id: text('id').primaryKey(),
  templateId: text('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
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
})

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  templateId: text('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  widthPx: integer('width_px').notNull(),
  heightPx: integer('height_px').notNull()
})

export const printJobs = sqliteTable('print_jobs', {
  id: text('id').primaryKey(),
  templateId: text('template_id'),
  templateNameSnapshot: text('template_name_snapshot').notNull(),
  templateSnapshot: text('template_snapshot', { mode: 'json' }).notNull(),
  paramValues: text('param_values', { mode: 'json' }).notNull(),
  thumbPath: text('thumb_path'),
  printerName: text('printer_name').notNull(),
  copies: integer('copies').notNull().default(1),
  printMode: text('print_mode').notNull(),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull()
})

export type TemplateRow = typeof templates.$inferSelect
export type JobRow = typeof printJobs.$inferSelect
```

`db/client.ts`：

```ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export function createDb(path: string) {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  return { sqlite, db }
}
export type DbClient = ReturnType<typeof createDb>
/** 仓储统一使用该类型，构造处无需任何 as 断言 */
export type DrizzleDb = DbClient['db']
```

`db/migrate.ts`（幂等建表，M1 不引入 drizzle-kit 迁移文件）：

```ts
import type { DbClient } from './client'

const DDL = `
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  paper TEXT NOT NULL, content TEXT NOT NULL,
  print_mode TEXT NOT NULL DEFAULT 'silent', printer_name TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS template_params (
  id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1, default_value TEXT NOT NULL DEFAULT '',
  date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd', max_length INTEGER, min INTEGER, max INTEGER,
  decimals INTEGER NOT NULL DEFAULT 2, thousands_separator INTEGER NOT NULL DEFAULT 0,
  print_on_empty TEXT NOT NULL DEFAULT 'blank', sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, width_px INTEGER NOT NULL, height_px INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY, template_id TEXT, template_name_snapshot TEXT NOT NULL,
  template_snapshot TEXT NOT NULL, param_values TEXT NOT NULL, thumb_path TEXT,
  printer_name TEXT NOT NULL, copies INTEGER NOT NULL DEFAULT 1, print_mode TEXT NOT NULL,
  status TEXT NOT NULL, error_message TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON print_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_params_template ON template_params(template_id);
CREATE INDEX IF NOT EXISTS idx_assets_template ON assets(template_id);
`

export function runMigrations(client: DbClient): void {
  client.sqlite.exec(DDL)
}
```

- [ ] **Step 2: 写失败测试（仓储集成测试）**

`tests/db/repositories.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb, type DbClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { JobRepository } from '../../db/repositories/job-repo'
import { createTemplate, createParamDef, createElement, type TemplateDocument } from '../../print-core/template-model'

let client: DbClient
let dbPath: string
let repo: TemplateRepository
let jobs: JobRepository

beforeEach(() => {
  dbPath = join(tmpdir(), `tp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  client = createDb(dbPath)
  runMigrations(client)
  repo = new TemplateRepository(client.db)
  jobs = new JobRepository(client.db)
})

afterEach(() => {
  client.sqlite.close()
  rmSync(dbPath, { force: true })
  rmSync(dbPath + '-wal', { force: true })
  rmSync(dbPath + '-shm', { force: true })
})

function sample(id: string): TemplateDocument {
  const tpl = createTemplate(id, '证书', { widthMm: 210, heightMm: 297 })
  tpl.category = '证书'
  tpl.params.push(createParamDef({ key: 'name', label: '姓名', type: 'text', order: 0 }))
  tpl.content.elements.push(createElement('text', { text: '标题' }, { x: 1, y: 1, w: 50, h: 8 }))
  return tpl
}

describe('TemplateRepository', () => {
  it('upsert 后能 get 回来且 JSON 字段结构一致', () => {
    repo.upsert(sample('t1'))
    const got = repo.getById('t1')
    expect(got?.name).toBe('证书')
    expect(got?.paper.widthMm).toBe(210)
    expect(got?.params[0].key).toBe('name')
    expect(got?.content.elements[0].type).toBe('text')
  })

  it('list 支持分类与名称关键字过滤', () => {
    const a = sample('a'); a.category = '证书'
    const b = sample('b'); b.name = '商品价签'; b.category = '标签'
    repo.upsert(a); repo.upsert(b)
    expect(repo.list({}).length).toBe(2)
    expect(repo.list({ category: '标签' })[0].id).toBe('b')
    expect(repo.list({ keyword: '证' })[0].id).toBe('a')
  })

  it('重复 upsert 更新而不新增，且参数整体替换', async () => {
    const t = sample('t1')
    repo.upsert(t)
    t.params.pop()
    t.params.push(createParamDef({ key: 'date', label: '日期', type: 'date' }))
    t.name = '证书2'
    repo.upsert(t)
    const got = repo.getById('t1')
    expect(got?.params.map((p) => p.key)).toEqual(['date'])
    expect(repo.list({}).length).toBe(1)
  })

  it('删除模板级联删除参数', () => {
    repo.upsert(sample('t1'))
    repo.remove('t1')
    expect(repo.getById('t1')).toBeNull()
    expect(client.sqlite.prepare('SELECT COUNT(*) c FROM template_params').get() as { c: number })
      .toMatchObject({ c: 0 })
  })
})

describe('JobRepository', () => {
  it('insert 与按条件查询（模板/时间/参数关键字）', () => {
    const snap = sample('t1')
    jobs.insert({
      id: 'j1', templateId: 't1', templateNameSnapshot: '证书',
      templateSnapshot: snap, paramValues: { name: '张三' }, thumbPath: null,
      printerName: 'HP', copies: 1, printMode: 'silent', status: 'success',
      errorMessage: null, createdAt: 1_700_000_000_000
    })
    jobs.insert({
      id: 'j2', templateId: 't1', templateNameSnapshot: '证书',
      templateSnapshot: snap, paramValues: { name: '李四' }, thumbPath: null,
      printerName: 'HP', copies: 1, printMode: 'silent', status: 'failed',
      errorMessage: 'offline', createdAt: 1_700_000_100_000
    })
    expect(jobs.list({}).length).toBe(2)
    expect(jobs.list({ keyword: '张三' })[0].id).toBe('j1')
    expect(jobs.list({ templateId: 't1' }).length).toBe(2)
    expect(jobs.list({ from: 1_700_000_050_000 })[0].id).toBe('j2')
  })
})
```

- [ ] **Step 3: 运行确认失败** → `bun run test -- tests/db/repositories.test.ts`，FAIL（仓储不存在）。

- [ ] **Step 4: 实现仓储**

`db/repositories/template-repo.ts`：

```ts
import { eq, like, and, desc, type SQL } from 'drizzle-orm'
import { templates, templateParams } from '../schema'
import type { DrizzleDb } from '../client'
import { TemplateDocumentSchema, ParamDefSchema, type TemplateDocument, type ParamDef } from '../../print-core/template-model'

interface TemplateRow {
  id: string
  name: string
  category: string
  paper: unknown
  content: unknown
  printMode: 'silent' | 'dialog'
  printerName: string | null
  isBuiltin: number | boolean
  version: number
  createdAt: number
  updatedAt: number
}

interface ParamRow {
  id: string
  key: string
  label: string
  type: string
  required: number | boolean
  defaultValue: string
  dateFormat: string
  maxLength: number | null
  min: number | null
  max: number | null
  decimals: number
  thousandsSeparator: number | boolean
  printOnEmpty: 'blank' | 'line'
  order: number
}

export interface TemplateListFilter {
  category?: string
  keyword?: string
}

export class TemplateRepository {
  constructor(private db: DrizzleDb) {}

  upsert(doc: TemplateDocument): void {
    this.db.transaction((tx) => {
      const exists = tx.select({ id: templates.id }).from(templates).where(eq(templates.id, doc.id)).all()
      const row = {
        id: doc.id,
        name: doc.name,
        category: doc.category,
        paper: doc.paper,
        content: doc.content,
        printMode: doc.printMode,
        printerName: doc.printerName,
        isBuiltin: doc.isBuiltin,
        version: doc.version,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      }
      if (exists.length) {
        tx.update(templates).set(row).where(eq(templates.id, doc.id)).run()
      } else {
        tx.insert(templates).values(row).run()
      }
      // 参数整体替换
      tx.delete(templateParams).where(eq(templateParams.templateId, doc.id)).run()
      for (const p of doc.params) {
        tx.insert(templateParams).values({
          id: p.id, templateId: doc.id, key: p.key, label: p.label, type: p.type,
          required: p.required, defaultValue: p.defaultValue, dateFormat: p.dateFormat,
          maxLength: p.maxLength, min: p.min, max: p.max, decimals: p.decimals,
          thousandsSeparator: p.thousandsSeparator, printOnEmpty: p.printOnEmpty, order: p.order
        }).run()
      }
    })
  }

  private hydrate(row: TemplateRow, params: ParamRow[]): TemplateDocument {
    // Drizzle 查询返回 JS 属性名（camelCase），JSON 模式列已自动反序列化
    return TemplateDocumentSchema.parse({
      id: row.id, name: row.name, category: row.category, paper: row.paper,
      content: row.content, printMode: row.printMode, printerName: row.printerName,
      isBuiltin: !!row.isBuiltin, version: row.version,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      params: params
        .map((pr) =>
          ParamDefSchema.parse({
            id: pr.id, key: pr.key, label: pr.label, type: pr.type,
            required: !!pr.required, defaultValue: pr.defaultValue, dateFormat: pr.dateFormat,
            maxLength: pr.maxLength, min: pr.min, max: pr.max, decimals: pr.decimals,
            thousandsSeparator: !!pr.thousandsSeparator, printOnEmpty: pr.printOnEmpty, order: pr.order
          })
        )
        .sort((a: ParamDef, b: ParamDef) => a.order - b.order)
    })
  }

  getById(id: string): TemplateDocument | null {
    const row = this.db.select().from(templates).where(eq(templates.id, id)).all()[0] as TemplateRow | undefined
    if (!row) return null
    const params = this.db.select().from(templateParams)
      .where(eq(templateParams.templateId, id)).all() as unknown as ParamRow[]
    return this.hydrate(row, params)
  }

  list(filter: TemplateListFilter): TemplateDocument[] {
    const conds: SQL[] = []
    if (filter.category) conds.push(eq(templates.category, filter.category))
    if (filter.keyword) conds.push(like(templates.name, `%${filter.keyword}%`))
    const rows = this.db
      .select()
      .from(templates)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(templates.updatedAt))
      .all() as unknown as TemplateRow[]
    return rows.map((row) => {
      const params = this.db.select().from(templateParams)
        .where(eq(templateParams.templateId, row.id)).all() as unknown as ParamRow[]
      return this.hydrate(row, params)
    })
  }

  categories(): string[] {
    const rows = this.db.selectDistinct({ c: templates.category }).from(templates).all() as { c: string }[]
    return rows.map((r) => r.c).filter(Boolean).sort()
  }

  remove(id: string): void {
    this.db.delete(templates).where(eq(templates.id, id)).run()
  }
}
```

`db/repositories/asset-repo.ts`：

```ts
import { eq } from 'drizzle-orm'
import { assets } from '../schema'
import type { DrizzleDb } from '../client'

export interface AssetRecord {
  id: string
  templateId: string
  filePath: string
  originalName: string
  mime: string
  sizeBytes: number
  widthPx: number
  heightPx: number
}

export class AssetRepository {
  constructor(private db: DrizzleDb) {}

  insert(rec: AssetRecord): void {
    this.db.insert(assets).values(rec).run()
  }
  listByTemplate(templateId: string): AssetRecord[] {
    return this.db.select().from(assets).where(eq(assets.templateId, templateId))
      .all() as unknown as AssetRecord[]
  }
  get(id: string): AssetRecord | null {
    const row = this.db.select().from(assets).where(eq(assets.id, id)).all()[0]
    return (row as AssetRecord | undefined) ?? null
  }
  removeByTemplate(templateId: string): AssetRecord[] {
    const old = this.listByTemplate(templateId)
    this.db.delete(assets).where(eq(assets.templateId, templateId)).run()
    return old
  }
}
```

`db/repositories/job-repo.ts`：

```ts
import { eq, gte, desc, and, type SQL } from 'drizzle-orm'
import { printJobs } from '../schema'
import type { DrizzleDb } from '../client'
import { TemplateDocumentSchema, type TemplateDocument } from '../../print-core/template-model'

export type JobStatus = 'success' | 'failed' | 'cancelled'

export interface NewJob {
  id: string
  templateId: string | null
  templateNameSnapshot: string
  templateSnapshot: TemplateDocument
  paramValues: Record<string, string>
  thumbPath: string | null
  printerName: string
  copies: number
  printMode: 'silent' | 'dialog'
  status: JobStatus
  errorMessage: string | null
  createdAt: number
}

export interface JobListItem extends Omit<NewJob, 'templateSnapshot'> {
  templateSnapshot: TemplateDocument
}

export interface JobFilter {
  templateId?: string
  from?: number
  to?: number
  keyword?: string
}

interface JobRow {
  id: string
  templateId: string | null
  templateNameSnapshot: string
  templateSnapshot: unknown
  paramValues: unknown
  thumbPath: string | null
  printerName: string
  copies: number
  printMode: 'silent' | 'dialog'
  status: JobStatus
  errorMessage: string | null
  createdAt: number
}

export class JobRepository {
  constructor(private db: DrizzleDb) {}

  insert(job: NewJob): void {
    this.db.insert(printJobs).values(job).run()
  }

  private hydrate(row: JobRow): JobListItem {
    return {
      id: row.id,
      templateId: row.templateId ?? null,
      templateNameSnapshot: row.templateNameSnapshot,
      templateSnapshot: TemplateDocumentSchema.parse(row.templateSnapshot),
      paramValues: row.paramValues as Record<string, string>,
      thumbPath: row.thumbPath ?? null,
      printerName: row.printerName,
      copies: row.copies,
      printMode: row.printMode,
      status: row.status,
      errorMessage: row.errorMessage ?? null,
      createdAt: row.createdAt
    }
  }

  getById(id: string): JobListItem | null {
    const row = this.db.select().from(printJobs).where(eq(printJobs.id, id)).all()[0] as JobRow | undefined
    return row ? this.hydrate(row) : null
  }

  list(filter: JobFilter): JobListItem[] {
    // SQL 层只过滤模板与起始时间（可走索引）；结束时间与关键字在 JS 层精确过滤，
    // 避免 JSON 文本 LIKE 的转义误差（M1 数据量小）。
    const conds: SQL[] = []
    if (filter.templateId) conds.push(eq(printJobs.templateId, filter.templateId))
    if (filter.from) conds.push(gte(printJobs.createdAt, filter.from))
    const rows = this.db
      .select()
      .from(printJobs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(printJobs.createdAt))
      .all() as unknown as JobRow[]
    let list = rows.map((r) => this.hydrate(r))
    if (filter.to) list = list.filter((j) => j.createdAt <= filter.to)
    if (filter.keyword) {
      const kw = filter.keyword
      list = list.filter(
        (j) =>
          j.templateNameSnapshot.includes(kw) ||
          Object.values(j.paramValues).some((v) => String(v).includes(kw))
      )
    }
    return list
  }
}
```

- [ ] **Step 5: 运行测试并提交**

Run: `bun run test -- tests/db/repositories.test.ts` → PASS；`bun run test` 全绿。

```bash
git add db tests/db
git commit -m "feat(db): schema/幂等迁移/模板-资产-历史仓储"
```

---

## Task 7: IPC 契约、preload 白名单与主进程装配

**Files:**

- Create: `shared/ipc-contract.ts`
- Modify: `electron/preload/index.ts`, `electron/main/index.ts`
- Create: `electron/main/app-paths.ts`, `electron/main/settings.ts`, `electron/main/ipc/index.ts`
- Test: `tests/main/settings.test.ts`

- [ ] **Step 1: 写 settings 测试**

`tests/main/settings.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSettings, saveSettings, type AppSettings } from '../../electron/main/settings'

let dir: string
beforeEach(() => {
  dir = join(tmpdir(), `tp-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
})

describe('settings.json', () => {
  it('文件不存在时返回默认值', () => {
    const s = loadSettings(dir)
    expect(s.defaultPrinterName).toBeNull()
  })
  it('保存后可重新读取', () => {
    const s: AppSettings = { defaultPrinterName: 'HP LaserJet' }
    saveSettings(dir, s)
    expect(loadSettings(dir).defaultPrinterName).toBe('HP LaserJet')
  })
  it('坏 JSON 回退默认值且不抛异常', () => {
    rmSync(dir, { recursive: true, force: true })
    const { mkdirSync, writeFileSync } = require('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), '{bad json')
    expect(loadSettings(dir).defaultPrinterName).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败** → `bun run test -- tests/main/settings.test.ts`，FAIL。

- [ ] **Step 3: 实现 app-paths 与 settings**

`electron/main/app-paths.ts`：

```ts
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

let dataDir = ''

export function paths() {
  if (!dataDir) {
    // app.getPath('userData') 在 app ready 前也可用于 setPath；此处直接取默认目录
    dataDir = app.getPath('userData')
    mkdirSync(join(dataDir, 'assets'), { recursive: true })
    mkdirSync(join(dataDir, 'thumbs'), { recursive: true })
    mkdirSync(join(dataDir, 'print-tmp'), { recursive: true })
  }
  return {
    dataDir,
    dbFile: join(dataDir, 'app.db'),
    settingsFile: join(dataDir, 'settings.json'),
    assetsDir: join(dataDir, 'assets'),
    thumbsDir: join(dataDir, 'thumbs'),
    printTmpDir: join(dataDir, 'print-tmp')
  }
}

/** 仅供测试注入目录 */
export function _setDataDirForTest(p: string): void {
  dataDir = p
}
```

`electron/main/settings.ts`：

```ts
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export interface AppSettings {
  defaultPrinterName: string | null
}

const DEFAULTS: AppSettings = { defaultPrinterName: null }

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
```

- [ ] **Step 4: 定义 IPC 契约**

`shared/ipc-contract.ts`：

```ts
import type { TemplateDocument } from '../print-core/template-model'
import type { JobListItem } from '../db/repositories/job-repo'

export interface PrinterInfoDto {
  name: string
  isDefault: boolean
}

export interface NewTemplateInput {
  name: string
  category?: string
  widthMm: number
  heightMm: number
}

export interface SubmitPrintInput {
  /** 工作副本：可能是已存模板（含 id）或历史快照（id 可空） */
  template: TemplateDocument
  paramValues: Record<string, string>
  printerName: string
  copies: number
  mode: 'silent' | 'dialog'
}

export interface SubmitPrintResult {
  jobId: string
  status: 'success' | 'failed' | 'cancelled'
  errorMessage: string | null
  thumbPath: string | null
}

export const IPC = {
  templatesList: 'templates:list',
  templatesGet: 'templates:get',
  templatesCreate: 'templates:create',
  templatesSave: 'templates:save',
  templatesDuplicate: 'templates:duplicate',
  templatesDelete: 'templates:delete',
  assetsImport: 'assets:import',
  assetsDataUrl: 'assets:data-url',
  assetsListUrls: 'assets:list-urls',
  printersList: 'printers:list',
  printersGetDefault: 'printers:get-default',
  printersSetDefault: 'printers:set-default',
  printersTestPage: 'printers:test-page',
  printSubmit: 'print:submit',
  jobsList: 'jobs:list',
  jobsGet: 'jobs:get',
  thumbFileUrl: 'thumb:file-url'
} as const

export interface Api {
  templates: {
    list(filter?: { category?: string; keyword?: string }): Promise<TemplateDocument[]>
    get(id: string): Promise<TemplateDocument | null>
    create(input: NewTemplateInput): Promise<TemplateDocument>
    save(doc: TemplateDocument): Promise<void>
    duplicate(id: string): Promise<TemplateDocument>
    delete(id: string): Promise<void>
  }
  assets: {
    import(input: { templateId: string; sourcePath: string }): Promise<{ assetId: string }>
    dataUrl(assetId: string): Promise<string>
    listUrls(templateId: string): Promise<Record<string, string>>
  }
  printers: {
    list(): Promise<PrinterInfoDto[]>
    getDefault(): Promise<string | null>
    setDefault(name: string): Promise<void>
    testPage(name: string): Promise<void>
  }
  print: {
    submit(input: SubmitPrintInput): Promise<SubmitPrintResult>
  }
  jobs: {
    list(filter?: { templateId?: string; from?: number; to?: number; keyword?: string }): Promise<JobListItem[]>
    get(id: string): Promise<JobListItem | null>
  }
  thumbUrl(path: string): Promise<string>
}

declare global {
  interface Window {
    api: Api
  }
}
```

> 注意：`shared` 被渲染端与 Vitest 引用；`import type ... from '../../db/...'` 是纯类型导入，不会把 better-sqlite3 带进渲染包。

- [ ] **Step 5: 写 IPC 注册与服务（本任务先装配空实现，后续任务补服务）**

先创建服务占位，下一批任务逐个填实。`electron/main/ipc/index.ts`：

```ts
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import { registerTemplateHandlers } from '../services/template-service'
import { registerAssetHandlers } from '../services/asset-service'
import { registerPrinterHandlers } from '../services/printer-service'
import { registerPrintHandlers } from '../services/print-service'
import { registerHistoryHandlers } from '../services/history-service'

export function registerIpc(mainWindow: BrowserWindow, deps: Services): void {
  registerTemplateHandlers(deps)
  registerAssetHandlers(deps)
  registerPrinterHandlers(deps, mainWindow)
  registerPrintHandlers(deps, mainWindow)
  registerHistoryHandlers(deps)
  ipcMain.removeHandler(IPC.thumbFileUrl)
}

export interface Services {
  // 在 Task 8/9/18/20/21 中填充具体依赖
}
```

本步骤结束时上述 5 个 service 文件先导出空注册函数：

```ts
// 每个 service 文件统一形态（以 template-service 为例）
import type { Services } from '../ipc'
export function registerTemplateHandlers(_deps: Services): void {}
```

- [ ] **Step 6: 装配主进程**

`electron/main/index.ts`（替换 Task 1 版本）：

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { paths } from './app-paths'
import { createDb } from '../../db/client'
import { runMigrations } from '../../db/migrate'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  const p = paths()
  const client = createDb(p.dbFile)
  runMigrations(client)
  // Task 8 起把 client 等依赖传入 registerIpc
  // registerIpc(createWindow(), {})
  const win = createWindow()
  void win
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`sandbox: false`：preload 需要 `require('electron')` 桥接 IPC（contextIsolation 仍为 true，安全边界保持）。

`electron/preload/index.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../../shared/ipc-contract'

const api = {
  templates: {
    list: (filter?: unknown) => ipcRenderer.invoke(IPC.templatesList, filter),
    get: (id: string) => ipcRenderer.invoke(IPC.templatesGet, id),
    create: (input: unknown) => ipcRenderer.invoke(IPC.templatesCreate, input),
    save: (doc: unknown) => ipcRenderer.invoke(IPC.templatesSave, doc),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.templatesDuplicate, id),
    delete: (id: string) => ipcRenderer.invoke(IPC.templatesDelete, id)
  },
  assets: {
    import: (input: unknown) => ipcRenderer.invoke(IPC.assetsImport, input),
    dataUrl: (id: string) => ipcRenderer.invoke(IPC.assetsDataUrl, id),
    listUrls: (templateId: string) => ipcRenderer.invoke(IPC.assetsListUrls, templateId)
  },
  printers: {
    list: () => ipcRenderer.invoke(IPC.printersList),
    getDefault: () => ipcRenderer.invoke(IPC.printersGetDefault),
    setDefault: (name: string) => ipcRenderer.invoke(IPC.printersSetDefault, name),
    testPage: (name: string) => ipcRenderer.invoke(IPC.printersTestPage, name)
  },
  print: {
    submit: (input: unknown) => ipcRenderer.invoke(IPC.printSubmit, input)
  },
  jobs: {
    list: (filter?: unknown) => ipcRenderer.invoke(IPC.jobsList, filter),
    get: (id: string) => ipcRenderer.invoke(IPC.jobsGet, id)
  },
  thumbUrl: (path: string) => ipcRenderer.invoke(IPC.thumbFileUrl, path)
}

contextBridge.exposeInMainWorld('api', api)
export type {}
```

- [ ] **Step 7: 测试、类型检查、运行验证并提交**

Run: `bun run test -- tests/main/settings.test.ts` → PASS。
Run: `bun run typecheck` → 无错误。
Run: `bun run rebuild`（首次把 better-sqlite3 编译为 Electron ABI；若该命令在 Bun 下异常，用 `npx electron-builder install-app-deps`）。
Run: `bun run dev` → 窗口正常打开，应用数据目录下生成 app.db（此时 UI 仍是脚手架页；`window.api` 白名单已挂载，业务通道在后续任务注册）。

```bash
git add shared/ipc-contract.ts electron tests/main
git commit -m "feat: IPC 契约/preload 白名单/主进程装配与 settings"
```

---

## Task 8: AssetService（图片导入、dataURL、清理）

**Files:**

- Create: `electron/main/services/asset-service.ts`（替换 Task 7 占位）
- Test: `tests/main/asset-service.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/main/asset-service.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb, type DbClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { AssetRepository } from '../../db/repositories/asset-repo'
import { AssetService } from '../../electron/main/services/asset-service'

// 1x1 PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

let dataDir: string
let client: DbClient
let svc: AssetService

beforeEach(() => {
  dataDir = join(tmpdir(), `tp-asset-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dataDir, 'assets'), { recursive: true })
  client = createDb(join(tmpdir(), `tp-asset-db-${Date.now()}.db`))
  runMigrations(client)
  svc = new AssetService(dataDir, new AssetRepository(client.db))
  mkdirSync(join(tmpdir(), 'srcimg'), { recursive: true })
})
afterEach(() => {
  client.sqlite.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('AssetService', () => {
  it('导入图片：复制文件、入库、返回 assetId 与尺寸', async () => {
    const src = join(tmpdir(), 'srcimg', `a-${Date.now()}.png`)
    writeFileSync(src, PNG_1X1)
    const { assetId } = await svc.importImage({ templateId: 't1', sourcePath: src })
    const rec = svc.repo.get(assetId)!
    expect(rec.widthPx).toBe(1)
    expect(rec.heightPx).toBe(1)
    expect(existsSync(join(dataDir, rec.filePath))).toBe(true)
    expect(await svc.toDataUrl(assetId)).toMatch(/^data:image\/png;base64,/)
  })

  it('删除模板资产：删库记录并删文件', async () => {
    const src = join(tmpdir(), 'srcimg', `b-${Date.now()}.png`)
    writeFileSync(src, PNG_1X1)
    const { assetId } = await svc.importImage({ templateId: 't1', sourcePath: src })
    const rec = svc.repo.get(assetId)!
    svc.purgeForTemplate('t1')
    expect(svc.repo.get(assetId)).toBeNull()
    expect(existsSync(join(dataDir, rec.filePath))).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL（服务不存在）。

- [ ] **Step 3: 实现 AssetService 与 IPC**

`electron/main/services/asset-service.ts`：

```ts
import { ipcMain } from 'electron'
import { join, extname } from 'node:path'
import { mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { IPC } from '../../../shared/ipc-contract'
import { AssetRepository } from '../../../db/repositories/asset-repo'
import type { Services } from '../ipc'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

/** 从 PNG/JPEG/GIF/BMP 文件头读取像素尺寸，无第三方依赖。 */
function readImageSize(path: string): { widthPx: number; heightPx: number } {
  const buf = readFileSync(path)
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { widthPx: buf.readUInt32BE(16), heightPx: buf.readUInt32BE(20) }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2
    while (o < buf.length) {
      if (buf[o] !== 0xff) break
      const marker = buf[o + 1]
      const len = buf.readUInt16BE(o + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { heightPx: buf.readUInt16BE(o + 5), widthPx: buf.readUInt16BE(o + 7) }
      }
      o += 2 + len
    }
  }
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { widthPx: buf.readUInt16LE(6), heightPx: buf.readUInt16LE(8) }
  }
  if (buf.subarray(0, 2).toString('ascii') === 'BM') {
    return { widthPx: buf.readInt32LE(18), heightPx: Math.abs(buf.readInt32LE(22)) }
  }
  throw new Error('不支持的图片格式（仅 png/jpg/gif/bmp）')
}

export class AssetService {
  constructor(
    private dataDir: string,
    readonly repo: AssetRepository
  ) {}

  async importImage(input: { templateId: string; sourcePath: string }): Promise<{ assetId: string }> {
    const ext = extname(input.sourcePath).toLowerCase()
    const mime = MIME[ext]
    if (!mime) throw new Error(`不支持的扩展名: ${ext}`)
    const { widthPx, heightPx } = readImageSize(input.sourcePath)
    const assetId = `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const relPath = join('assets', input.templateId, `${assetId}${ext}`)
    mkdirSync(join(this.dataDir, 'assets', input.templateId), { recursive: true })
    copyFileSync(input.sourcePath, join(this.dataDir, relPath))
    this.repo.insert({
      id: assetId,
      templateId: input.templateId,
      filePath: relPath,
      originalName: input.sourcePath.split(/[\\/]/).pop() ?? 'image',
      mime,
      sizeBytes: 0,
      widthPx,
      heightPx
    })
    return { assetId }
  }

  absolutePath(assetId: string): string {
    const rec = this.repo.get(assetId)
    if (!rec) throw new Error(`资产不存在: ${assetId}`)
    return join(this.dataDir, rec.filePath)
  }

  fileUrl(assetId: string): string {
    return pathToFileURL(this.absolutePath(assetId)).href
  }

  async toDataUrl(assetId: string): Promise<string> {
    const rec = this.repo.get(assetId)
    if (!rec) throw new Error(`资产不存在: ${assetId}`)
    const b64 = readFileSync(join(this.dataDir, rec.filePath)).toString('base64')
    return `data:${rec.mime};base64,${b64}`
  }

  async listDataUrls(templateId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const rec of this.repo.listByTemplate(templateId)) {
      out[rec.id] = await this.toDataUrl(rec.id)
    }
    return out
  }

  purgeForTemplate(templateId: string): void {
    for (const rec of this.repo.removeByTemplate(templateId)) {
      rmSync(join(this.dataDir, rec.filePath), { force: true })
    }
  }
}

export function registerAssetHandlers(deps: Services): void {
  if (!deps.assets) return
  const svc = deps.assets
  ipcMain.handle(IPC.assetsImport, (_e, input: { templateId: string; sourcePath: string }) =>
    svc.importImage(input)
  )
  ipcMain.handle(IPC.assetsDataUrl, (_e, id: string) => svc.toDataUrl(id))
  ipcMain.handle(IPC.assetsListUrls, (_e, templateId: string) => svc.listDataUrls(templateId))
}
```

同步把 `electron/main/ipc/index.ts` 的 `Services` 扩成：

```ts
import type { AssetService } from '../services/asset-service'
export interface Services {
  assets?: AssetService
}
```

- [ ] **Step 4: 测试通过并提交**

Run: `bun run test -- tests/main/asset-service.test.ts` → PASS。

```bash
git add electron/main/services/asset-service.ts electron/main/ipc/index.ts tests/main/asset-service.test.ts
git commit -m "feat: 图片资产导入/读取/清理服务"
```

---

## Task 9: TemplateService 与 IPC 实现

**Files:**

- Create: `electron/main/services/template-service.ts`（替换占位）
- Modify: `electron/main/ipc/index.ts`, `electron/main/index.ts`
- Test: `tests/main/template-service.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/main/template-service.test.ts`：

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

let dataDir: string
let client: DbClient
let svc: TemplateService

beforeEach(() => {
  dataDir = join(tmpdir(), `tp-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  client = createDb(join(tmpdir(), `tp-tpl-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`))
  runMigrations(client)
  svc = new TemplateService(
    new TemplateRepository(client.db),
    new AssetService(dataDir, new AssetRepository(client.db))
  )
})
afterEach(() => {
  client.sqlite.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('TemplateService', () => {
  it('create 落库并返回完整文档', async () => {
    const tpl = await svc.create({ name: '价签', widthMm: 40, heightMm: 30, category: '标签' })
    expect(tpl.paper.widthMm).toBe(40)
    expect((await svc.list({})).length).toBe(1)
  })
  it('duplicate 生成新 id 与“xxx 副本”名称，元素与参数一并复制并重新分配 id', async () => {
    const a = await svc.create({ name: '证书', widthMm: 210, heightMm: 297 })
    const copy = await svc.duplicate(a.id)
    expect(copy.id).not.toBe(a.id)
    expect(copy.name).toBe('证书 副本')
  })
  it('delete 删除模板（资产清理由 AssetService 承担，服务被调用不抛错）', async () => {
    const a = await svc.create({ name: 'x', widthMm: 40, heightMm: 30 })
    await svc.remove(a.id)
    expect(await svc.get(a.id)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

`electron/main/services/template-service.ts`：

```ts
import { ipcMain } from 'electron'
import { IPC, type NewTemplateInput } from '../../../shared/ipc-contract'
import {
  TemplateDocumentSchema,
  createTemplate,
  localId,
  type TemplateDocument
} from '../../../print-core/template-model'
import { TemplateRepository } from '../../../db/repositories/template-repo'
import type { AssetService } from './asset-service'
import type { Services } from '../ipc'

export class TemplateService {
  constructor(
    private repo: TemplateRepository,
    private assets: AssetService
  ) {}

  async list(filter?: { category?: string; keyword?: string }): Promise<TemplateDocument[]> {
    return this.repo.list(filter ?? {})
  }
  async get(id: string): Promise<TemplateDocument | null> {
    return this.repo.getById(id)
  }
  async create(input: NewTemplateInput): Promise<TemplateDocument> {
    const now = Date.now()
    const doc = createTemplate(localId('tpl'), input.name, { widthMm: input.widthMm, heightMm: input.heightMm }, now)
    doc.category = input.category ?? ''
    this.repo.upsert(doc)
    return doc
  }
  async save(doc: TemplateDocument): Promise<void> {
    const parsed = TemplateDocumentSchema.parse({ ...doc, updatedAt: Date.now() })
    this.repo.upsert(parsed)
  }
  async duplicate(id: string): Promise<TemplateDocument> {
    const src = this.repo.getById(id)
    if (!src) throw new Error('模板不存在')
    // 深拷贝并重新分配模板/元素/参数 id，参数元素重新指向新参数 id
    const paramIdMap = new Map<string, string>()
    const now = Date.now()
    const copy: TemplateDocument = TemplateDocumentSchema.parse({
      ...structuredClone(src),
      id: localId('tpl'),
      name: `${src.name} 副本`,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now
    })
    copy.params = copy.params.map((p) => {
      const nid = localId('param')
      paramIdMap.set(p.id, nid)
      return { ...p, id: nid }
    })
    copy.content.elements = copy.content.elements.map((el) =>
      el.type === 'param' ? { ...el, id: localId('el'), props: { ...el.props, paramId: paramIdMap.get(el.props.paramId)! } }
                       : { ...el, id: localId('el') }
    )
    // 图片资产在 M1 不复制文件（副本暂时不带图，用户可重新上传）
    copy.content.elements = copy.content.elements.filter((el) => el.type !== 'image')
    this.repo.upsert(copy)
    return copy
  }
  async remove(id: string): Promise<void> {
    this.assets.purgeForTemplate(id)
    this.repo.remove(id)
  }
}

export function registerTemplateHandlers(deps: Services): void {
  if (!deps.templates) return
  const svc = deps.templates
  ipcMain.handle(IPC.templatesList, (_e, filter) => svc.list(filter))
  ipcMain.handle(IPC.templatesGet, (_e, id: string) => svc.get(id))
  ipcMain.handle(IPC.templatesCreate, (_e, input: NewTemplateInput) => svc.create(input))
  ipcMain.handle(IPC.templatesSave, (_e, doc: TemplateDocument) => svc.save(doc))
  ipcMain.handle(IPC.templatesDuplicate, (_e, id: string) => svc.duplicate(id))
  ipcMain.handle(IPC.templatesDelete, (_e, id: string) => svc.remove(id))
}
```

`electron/main/ipc/index.ts` 中 `Services` 扩展为：

```ts
import type { AssetService } from '../services/asset-service'
import type { TemplateService } from '../services/template-service'
export interface Services {
  assets?: AssetService
  templates?: TemplateService
}
```

`electron/main/index.ts` 装配（替换 whenReady 内对应段）：

```ts
import { registerIpc } from './ipc'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { AssetRepository } from '../../db/repositories/asset-repo'
import { AssetService } from './services/asset-service'
import { TemplateService } from './services/template-service'
// ...
app.whenReady().then(() => {
  const p = paths()
  const client = createDb(p.dbFile)
  runMigrations(client)
  const assets = new AssetService(p.dataDir, new AssetRepository(client.db))
  const templates = new TemplateService(new TemplateRepository(client.db), assets)
  const win = createWindow()
  registerIpc(win, { assets, templates } as Services)
  // activate 回调保持不变
})
```

> 此时 `Services` 中 print/printers/history 为必填，Task 7 的 `Services` 已含可选字段演进；本任务装配对象只需包含当前已实现的两个服务，故用 `as Services` 过渡，Task 18 给出完整 `Services` 与完整装配后删除该断言。

- [ ] **Step 4: 测试、类型检查并提交**

Run: `bun run test` → 全绿；`bun run typecheck` → 通过。

```bash
git add electron tests/main/template-service.test.ts
git commit -m "feat: 模板服务 CRUD/复制/删除与 IPC"
```

---

## Task 10: 渲染端 API 封装、应用外壳与路由

**Files:**

- Create: `src/renderer/api.ts`, `src/renderer/App.tsx`（重写）
- Create: `src/renderer/pages/templates.tsx`, `designer.tsx`, `print.tsx`, `history.tsx`, `settings.tsx`（本任务均为占位页）

- [ ] **Step 1: 实现 api 封装**

`src/renderer/api.ts`：

```ts
import type { Api } from '../../shared/ipc-contract'

export const api: Api = window.api
```

- [ ] **Step 2: 重写 App 外壳（侧边导航 + HashRouter）**

`src/renderer/App.tsx`：

```tsx
import { ConfigProvider, Layout, Menu } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { TemplatesPage } from './pages/templates'
import { DesignerPage } from './pages/designer'
import { PrintPage } from './pages/print'
import { HistoryPage } from './pages/history'
import { SettingsPage } from './pages/settings'

const { Sider, Content } = Layout

function Shell(): JSX.Element {
  const nav = useNavigate()
  const loc = useLocation()
  const selected = loc.pathname.startsWith('/history') ? '/history'
    : loc.pathname.startsWith('/settings') ? '/settings'
    : '/templates'
  return (
    <Layout style={{ height: '100vh' }}>
      <Sider theme="dark" width={150}>
        <div style={{ color: '#fff', fontWeight: 700, textAlign: 'center', padding: '16px 0' }}>模板打印</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          onClick={(e) => nav(e.key)}
          items={[
            { key: '/templates', label: '模板列表' },
            { key: '/history', label: '打印历史' },
            { key: '/settings', label: '打印机设置' }
          ]}
        />
      </Sider>
      <Content style={{ background: '#f5f5f5' }}>
        <Routes>
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/designer/:id" element={<DesignerPage />} />
          <Route path="/designer" element={<DesignerPage />} />
          <Route path="/print/:id" element={<PrintPage />} />
          <Route path="/print" element={<PrintPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/templates" replace />} />
        </Routes>
      </Content>
    </Layout>
  )
}

export function App(): JSX.Element {
  return (
    <ConfigProvider locale={zhCN}>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ConfigProvider>
  )
}
```

- [ ] **Step 3: 五个页面占位**

每个页面统一形态，以 `src/renderer/pages/templates.tsx` 为例，其余四个同构改标题：

```tsx
export function TemplatesPage(): JSX.Element {
  return <div style={{ padding: 16 }}>模板列表（Task 11）</div>
}
```

`designer.tsx` / `print.tsx` / `history.tsx` / `settings.tsx` 分别导出 `DesignerPage` / `PrintPage` / `HistoryPage` / `SettingsPage`，正文为对应占位文字。

- [ ] **Step 4: 运行验证并提交**

Run: `bun run dev` → 左侧深色导航三项可切换，默认进模板列表，URL 为 `#/templates`。

```bash
git add src/renderer
git commit -m "feat(ui): 应用外壳/侧边导航/路由与 API 封装"
```

---

## Task 11: 模板列表页（卡片、新建向导、复制/重命名/删除）

**Files:**

- Create/Modify: `src/renderer/pages/templates.tsx`
- 无自动化测试（UI），以步骤 4 手工验收为准。

- [ ] **Step 1: 新建模板纸张向导组件（内联在同文件）**

写入 `src/renderer/pages/templates.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react'
import {
  Button, Card, Empty, Input, InputNumber, Modal, Select, Space, message, Dropdown
} from 'antd'
import { MoreOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { PAPER_PRESETS } from '../../../shared/paper-presets'
import type { TemplateDocument } from '../../../print-core/template-model'

function NewTemplateModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [presetId, setPresetId] = useState('a4')
  const [customW, setCustomW] = useState(100)
  const [customH, setCustomH] = useState(60)
  const [custom, setCustom] = useState(false)

  useEffect(() => {
    if (open) { setName(''); setPresetId('a4'); setCustom(false) }
  }, [open])

  async function submit(): Promise<void> {
    if (!name.trim()) { message.warning('请填写模板名称'); return }
    const preset = PAPER_PRESETS.find((p) => p.id === presetId)!
    const w = custom ? customW : preset.widthMm
    const h = custom ? customH : preset.heightMm
    if (w <= 0 || h <= 0) { message.warning('纸张尺寸无效'); return }
    const doc = await api.templates.create({ name: name.trim(), widthMm: w, heightMm: h })
    onCreated(doc.id)
  }

  return (
    <Modal title="新建模板" open={open} onOk={submit} onCancel={onClose} okText="创建并设计" cancelText="取消">
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div><div>模板名称</div><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：荣誉证书" /></div>
        <div>
          <div>纸张</div>
          <Select style={{ width: 200 }} value={custom ? '__custom__' : presetId}
            onChange={(v) => setCustom(v === '__custom__')}
            options={[...PAPER_PRESETS.map((p) => ({ value: p.id, label: `${p.name}（${p.widthMm}×${p.heightMm}mm）` })),
              { value: '__custom__', label: '自定义尺寸（毫米）' }]} />
        </div>
        {custom && (
          <Space>
            宽 <InputNumber min={5} max={2000} value={customW} onChange={(v) => setCustomW(v ?? 0)} addonAfter="mm" />
            高 <InputNumber min={5} max={2000} value={customH} onChange={(v) => setCustomH(v ?? 0)} addonAfter="mm" />
          </Space>
        )}
      </Space>
    </Modal>
  )
}
```

- [ ] **Step 2: 列表页主体**

追加到同文件：

```tsx
export function TemplatesPage(): JSX.Element {
  const nav = useNavigate()
  const [docs, setDocs] = useState<TemplateDocument[]>([])
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<string | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)
  const [renaming, setRenaming] = useState<TemplateDocument | null>(null)
  const [renameVal, setRenameVal] = useState('')

  async function refresh(): Promise<void> {
    setDocs(await api.templates.list({ category, keyword: keyword || undefined }))
  }
  useEffect(() => { void refresh() }, [category, keyword])

  const categories = useMemo(() => [...new Set(docs.map((d) => d.category).filter(Boolean))], [docs])

  async function onDelete(d: TemplateDocument): Promise<void> {
    await api.templates.delete(d.id)
    message.success('已删除')
    void refresh()
  }
  async function onDuplicate(d: TemplateDocument): Promise<void> {
    const copy = await api.templates.duplicate(d.id)
    message.success('已复制')
    nav(`/designer/${copy.id}`)
  }
  async function saveRename(): Promise<void> {
    if (!renaming || !renameVal.trim()) return
    await api.templates.save({ ...renaming, name: renameVal.trim() })
    setRenaming(null)
    void refresh()
  }

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="全部分类" style={{ width: 140 }} value={category} onChange={setCategory}
          options={categories.map((c) => ({ value: c, label: c }))} />
        <Input.Search placeholder="搜索模板名称" allowClear style={{ width: 220 }} value={keyword}
          onChange={(e) => setKeyword(e.target.value)} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建模板</Button>
      </Space>

      {docs.length === 0
        ? <Empty description="还没有模板，点“新建模板”开始" />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
            {docs.map((d) => {
              const ratio = d.paper.widthMm / d.paper.heightMm
              return (
                <Card key={d.id} size="small"
                  cover={
                    <div style={{ height: 140, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{
                        width: ratio >= 1 ? 90 : 90 * ratio,
                        height: ratio >= 1 ? 90 / ratio : 90,
                        background: '#fff', border: '1px solid #bbb', boxShadow: '0 1px 4px rgba(0,0,0,.15)',
                        position: 'relative'
                      }} />
                    </div>
                  }
                  actions={[
                    <a key="use" onClick={() => nav(`/print/${d.id}`)}>使用</a>,
                    <a key="edit" onClick={() => nav(`/designer/${d.id}`)}>编辑</a>,
                    <Dropdown key="more" menu={{ items: [
                      { key: 'dup', label: '复制', onClick: () => onDuplicate(d) },
                      { key: 'ren', label: '重命名', onClick: () => { setRenaming(d); setRenameVal(d.name) } },
                      { type: 'divider' },
                      { key: 'del', label: <Popconfirm title={`删除模板“${d.name}”？图片资源将一并删除，历史记录保留`} onConfirm={() => onDelete(d)} okText="删除" cancelText="取消"><span style={{ color: '#cf1322' }}>删除</span></Popconfirm> }
                    ] }}><MoreOutlined /></Dropdown>
                  ]}>
                  <Card.Meta title={d.name}
                    description={`${d.category || '未分类'} · ${d.paper.widthMm}×${d.paper.heightMm}mm · ${d.printMode === 'silent' ? '直打' : '弹框'}`} />
                </Card>
              )
            })}
          </div>
        )}

      <NewTemplateModal open={modalOpen} onClose={() => setModalOpen(false)}
        onCreated={(id) => { setModalOpen(false); nav(`/designer/${id}`) }} />

      <Modal title="重命名" open={!!renaming} onOk={saveRename} onCancel={() => setRenaming(null)}>
        <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onPressEnter={saveRename} />
      </Modal>
    </div>
  )
}
```

- [ ] **Step 3: 删除菜单项改用 Modal.confirm**

Popconfirm 嵌在 Dropdown 菜单内点击会立即触发确认气泡，交互异常。用以下实现替换"删除"菜单项（Step 1 的导入清单已不含 Popconfirm，无需再改导入）：

```tsx
{
  key: 'del',
  label: '删除',
  danger: true,
  onClick: () => Modal.confirm({
    title: `删除模板“${d.name}”？`,
    content: '图片资源将一并删除，已产生的打印历史保留。',
    okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
    onOk: () => onDelete(d)
  })
}
```

并从 import 中移除 `Popconfirm`（若未使用）。

- [ ] **Step 4: 手工验收**

Run: `bun run dev`，依次验证：

1. 新建模板 → 选 A4 → 创建后跳转到 `/designer/:id`（设计器空白，Task 12 起填充）。
2. 返回列表可见卡片，名称/尺寸/模式正确；刷新应用后数据仍在（验证 DB 落盘）。
3. 搜索框输入关键字即时过滤；分类下拉可用。
4. "⋯ → 重命名"改名后列表更新；"复制"进入新模板设计页（名称含"副本"）；"删除"二次确认后卡片消失。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/pages/templates.tsx
git commit -m "feat(ui): 模板列表卡片/纸张新建向导/重命名复制删除"
```

---

## Task 12: 设计器 Zustand store（含撤销/重做，TDD）

**Files:**

- Create: `src/renderer/store/designer-store.ts`, `src/renderer/session-draft.ts`
- Test: `tests/renderer/designer-store.test.ts`

`tests` 目前只含 `.test.ts`；store 是纯 TS 逻辑（不依赖 React），可直接在 Vitest（node 环境）测。

- [ ] **Step 1: 写失败测试**

`tests/renderer/designer-store.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDesignerStore } from '../../src/renderer/store/designer-store'
import { createTemplate, createElement, createParamDef } from '../../print-core/template-model'

function reset(): void {
  const tpl = createTemplate('t1', '测试', { widthMm: 210, heightMm: 297 })
  useDesignerStore.getState().load(tpl, 'template')
}

describe('designer store', () => {
  beforeEach(reset)

  it('addElement 后元素进入文档并被选中', () => {
    const el = createElement('text', { text: 'A' }, { x: 1, y: 1, w: 20, h: 8 })
    useDesignerStore.getState().addElement(el)
    const { doc, selectedId } = useDesignerStore.getState()
    expect(doc.content.elements.length).toBe(1)
    expect(selectedId).toBe(el.id)
  })

  it('updateGeometry 提交后可撤销/重做', () => {
    const el = createElement('text', {}, { x: 0, y: 0, w: 10, h: 5 })
    useDesignerStore.getState().addElement(el)
    useDesignerStore.getState().commit()
    useDesignerStore.getState().updateGeometry(el.id, { x: 50 })
    useDesignerStore.getState().commit()
    expect(useDesignerStore.getState().doc.content.elements[0].x).toBe(50)
    useDesignerStore.getState().undo()
    expect(useDesignerStore.getState().doc.content.elements[0].x).toBe(0)
    useDesignerStore.getState().redo()
    expect(useDesignerStore.getState().doc.content.elements[0].x).toBe(50)
  })

  it('removeElement 同时清理引用了该参数的 param 定义（由调用方传入联动逻辑）——store 只删元素', () => {
    const p = createParamDef({ key: 'name', label: '姓名', type: 'text' })
    const { doc } = useDesignerStore.getState()
    doc.params.push(p)
    const el = createElement('param', { paramId: p.id }, { x: 0, y: 0, w: 20, h: 6 })
    useDesignerStore.getState().addElement(el)
    useDesignerStore.getState().commit()
    useDesignerStore.getState().removeElement(el.id)
    useDesignerStore.getState().commit()
    expect(useDesignerStore.getState().doc.content.elements.length).toBe(0)
  })

  it('addOrUpdateParam 新增参数定义', () => {
    const p = createParamDef({ key: 'date', label: '日期', type: 'date' })
    useDesignerStore.getState().addOrUpdateParam(p)
    expect(useDesignerStore.getState().doc.params[0].key).toBe('date')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL（store 不存在）。

- [ ] **Step 3: 实现 store**

`src/renderer/session-draft.ts`（打印页↔设计器、历史重打的内存中转，模块级单例；SPA 内跨路由有效）：

```ts
import type { TemplateDocument } from '../../../print-core/template-model'

interface DraftSlot {
  /** 工作副本模板（调整版式返回 / 历史快照重打时使用） */
  doc: TemplateDocument | null
  /** 带回打印页的参数值（调整版式时保留已填内容；重打时回填历史值） */
  paramValues: Record<string, string> | null
  /** true=设计器“完成，返回打印”；false=普通模板编辑入口 */
  returnToPrint: boolean
  /** true=来源是历史重打，打印后不弹保存决策 */
  fromHistory: boolean
  /** 进入打印页时原始模板的 JSON 基线，用于 dirty 判定 */
  baselineJson: string | null
}

export const sessionDraft: DraftSlot = {
  doc: null,
  paramValues: null,
  returnToPrint: false,
  fromHistory: false,
  baselineJson: null
}

export function clearDraft(): void {
  sessionDraft.doc = null
  sessionDraft.paramValues = null
  sessionDraft.returnToPrint = false
  sessionDraft.fromHistory = false
  sessionDraft.baselineJson = null
}
```

`src/renderer/store/designer-store.ts`：

```ts
import { create } from 'zustand'
import {
  TemplateDocumentSchema,
  type TemplateDocument,
  type TemplateElement,
  type Geometry,
  type ParamDef
} from '../../../print-core/template-model'

type Mode = 'template' | 'print-session'

interface DesignerState {
  doc: TemplateDocument
  mode: Mode
  selectedId: string | null
  dirty: boolean
  past: TemplateDocument[]
  future: TemplateDocument[]
  load(doc: TemplateDocument, mode: Mode): void
  select(id: string | null): void
  mutate(fn: (d: TemplateDocument) => void): void
  commit(): void
  undo(): void
  redo(): void
  addElement(el: TemplateElement): void
  removeElement(id: string): void
  updateGeometry(id: string, patch: Partial<Pick<Geometry, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'locked' | 'zIndex'>>): void
  updateProps(id: string, patch: Record<string, unknown>): void
  addOrUpdateParam(p: ParamDef): void
  removeParam(id: string): void
  markSaved(): void
}

function clone(doc: TemplateDocument): TemplateDocument {
  return TemplateDocumentSchema.parse(structuredClone(doc))
}

// store 创建时需要一个初始文档；用一个惰性占位，load 前不允许操作
const placeholder = TemplateDocumentSchema.parse({
  id: '__init__', name: '', paper: { widthMm: 1, heightMm: 1 },
  content: { elements: [] }, params: [], createdAt: 0, updatedAt: 0
})

export const useDesignerStore = create<DesignerState>((set, get) => ({
  doc: placeholder,
  mode: 'template',
  selectedId: null,
  dirty: false,
  past: [],
  future: [],

  load(doc, mode) {
    set({ doc: clone(doc), mode, selectedId: null, dirty: false, past: [], future: [] })
  },
  select(id) {
    set({ selectedId: id })
  },
  mutate(fn) {
    const next = clone(get().doc)
    fn(next)
    set({ doc: TemplateDocumentSchema.safeParse(next).success ? next : get().doc, dirty: true })
  },
  commit() {
    const { doc, past } = get()
    set({ past: [...past.slice(-49), clone(doc)], future: [] })
  },
  undo() {
    const { past, future, doc } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    set({ past: past.slice(0, -1), future: [clone(doc), ...future], doc: prev, selectedId: null, dirty: true })
  },
  redo() {
    const { future, past, doc } = get()
    if (future.length === 0) return
    const [next, ...rest] = future
    set({ future: rest, past: [...past, clone(doc)], doc: next, selectedId: null, dirty: true })
  },
  addElement(el) {
    get().mutate((d) => {
      el.zIndex = d.content.elements.length
      d.content.elements.push(el)
    })
    set({ selectedId: el.id })
  },
  removeElement(id) {
    get().mutate((d) => {
      d.content.elements = d.content.elements.filter((e) => e.id !== id)
    })
    if (get().selectedId === id) set({ selectedId: null })
  },
  updateGeometry(id, patch) {
    get().mutate((d) => {
      const el = d.content.elements.find((e) => e.id === id)
      if (el) Object.assign(el, patch)
    })
  },
  updateProps(id, patch) {
    get().mutate((d) => {
      const el = d.content.elements.find((e) => e.id === id)
      if (el) Object.assign(el.props, patch)
    })
  },
  addOrUpdateParam(p) {
    get().mutate((d) => {
      const i = d.params.findIndex((x) => x.id === p.id)
      if (i >= 0) d.params[i] = p
      else d.params.push({ ...p, order: d.params.length })
    })
  },
  removeParam(id) {
    get().mutate((d) => {
      d.params = d.params.filter((p) => p.id !== id)
      // 同步删除画布上引用该参数的元素
      d.content.elements = d.content.elements.filter(
        (e) => !(e.type === 'param' && e.props.paramId === id)
      )
    })
  },
  markSaved() {
    set({ dirty: false, past: get().past, future: get().future })
  }
}))
```

> 注意：`mutate` 中 `safeParse` 失败时保留旧文档；param 元素新建瞬间参数可能尚未登记，会导致校验失败。因此 param 元素与参数定义必须在同一次 `mutate` 内成对加入（Task 15 的"插入参数占位"操作保证这一点）。

- [ ] **Step 4: 运行通过并提交**

Run: `bun run test -- tests/renderer/designer-store.test.ts` → PASS。

```bash
git add src/renderer/store src/renderer/session-draft.ts tests/renderer
git commit -m "feat(designer): zustand 文档 store 与撤销重做"
```

---

## Task 13: 设计器画布（Konva：纸张、添加、选中、拖动、缩放、删除）

**Files:**

- Create: `src/renderer/designer/canvas.tsx`
- Modify: `src/renderer/pages/designer.tsx`（装载 store 与画布的页面骨架）
- 手工验收见 Step 4。

- [ ] **Step 1: 画布组件**

`src/renderer/designer/canvas.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Text as KText, Line, Ellipse, Group, Transformer } from 'react-konva'
import type Konva from 'konva'
import { mmToPxAt96 } from '../../../shared/units'
import { useDesignerStore } from '../store/designer-store'
import type { TemplateElement } from '../../../print-core/template-model'

const MM = (v: number, scale: number): number => mmToPxAt96(v) * scale
// 直线/椭圆用 Group 包装（Group 的 x/y 即左上角），Group 无 width/height，
// 这类元素只支持拖动改坐标，尺寸由右侧属性面板修改。
function isGroupWrapped(el: TemplateElement): boolean {
  return el.type === 'shape' && el.props.shape !== 'rect'
}

function ElementShape({ el, scale, selected, onSelect, onChange }: {
  el: TemplateElement
  scale: number
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h'>>) => void
}): JSX.Element {
  const shapeRef = useRef<Konva.Node>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const { updateProps } = useDesignerStore()

  useEffect(() => {
    if (selected && shapeRef.current && trRef.current) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [selected])

  const common = {
    id: el.id,
    x: MM(el.x, scale),
    y: MM(el.y, scale),
    width: MM(el.w, scale),
    height: MM(el.h, scale),
    rotation: el.rotation,
    draggable: !el.locked,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      onChange({ x: e.target.x() / mmToPxAt96(1) / scale, y: e.target.y() / mmToPxAt96(1) / scale })
    },
    onTransformEnd: () => {
      const node = shapeRef.current
      if (!node) return
      // Group 包装元素只回传坐标
      if (node.className === 'Group') {
        onChange({ x: node.x() / mmToPxAt96(1) / scale, y: node.y() / mmToPxAt96(1) / scale })
        return
      }
      onChange({
        x: node.x() / mmToPxAt96(1) / scale,
        y: node.y() / mmToPxAt96(1) / scale,
        w: Math.max(1, node.width() * node.scaleX() / mmToPxAt96(1) / scale),
        h: Math.max(1, node.height() * node.scaleY() / mmToPxAt96(1) / scale)
      })
      node.scaleX(1); node.scaleY(1)
    }
  }

  let body: JSX.Element
  if (el.type === 'text') {
    body = (
      <KText ref={shapeRef as never} {...common}
        text={el.props.text || '文本'}
        fontSize={MM(el.props.fontSizeMm, scale)}
        fontStyle={`${el.props.bold ? 'bold' : ''} ${el.props.italic ? 'italic' : ''}`.trim()}
        align={el.props.align} fill={el.props.color}
        onDblClick={() => {
          const v = window.prompt('编辑文本', el.props.text)
          if (v !== null) updateProps(el.id, { text: v })
        }} />
    )
  } else if (el.type === 'param') {
    body = (
      <KText ref={shapeRef as never} {...common}
        text={`{{${el.props.paramId.slice(0, 6)}}}`}
        fontSize={MM(el.props.fontSizeMm, scale)} fontStyle={el.props.bold ? 'bold' : 'normal'}
        fill={el.props.color} dash={[4, 3]} />
    )
  } else if (el.type === 'shape') {
    const stk = MM(el.props.strokeWidthMm, scale)
    if (el.props.shape === 'line') {
      // Group 定位在左上角；内部 Line 相对 Group 画水平中线，不接收指针事件
      body = (
        <Group ref={shapeRef as never} {...common}>
          <Line listening={false}
            points={[0, MM(el.h, scale) / 2, MM(el.w, scale), MM(el.h, scale) / 2]}
            stroke={el.props.strokeColor} strokeWidth={stk} />
        </Group>
      )
    } else if (el.props.shape === 'ellipse') {
      body = (
        <Group ref={shapeRef as never} {...common}>
          <Ellipse listening={false}
            x={MM(el.w, scale) / 2} y={MM(el.h, scale) / 2}
            radiusX={MM(el.w, scale) / 2} radiusY={MM(el.h, scale) / 2}
            stroke={el.props.strokeColor} strokeWidth={stk} fill={el.props.fillColor ?? undefined} />
        </Group>
      )
    } else {
      body = <Rect ref={shapeRef as never} {...common}
        stroke={el.props.strokeColor} strokeWidth={stk} fill={el.props.fillColor ?? undefined} />
    }
  } else {
    // 图片元素在 Task 16 替换为真实 KImage；在此之前是占位虚线框
    body = <Rect ref={shapeRef as never} {...common} fill="#e6f4ff" stroke="#1677ff" dash={[6, 4]} />
  }

  return (
    <>
      {body}
      {selected && (
        <Transformer ref={trRef} rotateEnabled={false}
          enabledAnchors={isGroupWrapped(el) ? [] : undefined}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 4 || newBox.height < 4 ? oldBox : newBox} />
      )}
    </>
  )
}

export function DesignerCanvas(): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const selectedId = useDesignerStore((s) => s.selectedId)
  const select = useDesignerStore((s) => s.select)
  const updateGeometry = useDesignerStore((s) => s.updateGeometry)
  const commit = useDesignerStore((s) => s.commit)
  const removeElement = useDesignerStore((s) => s.removeElement)
  const [scale, setScale] = useState(1)

  const pw = MM(doc.paper.widthMm, scale)
  const ph = MM(doc.paper.heightMm, scale)
  const sorted = [...doc.content.elements].sort((a, b) => a.zIndex - b.zIndex)

  return (
    <div tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
          removeElement(selectedId); commit()
        }
      }}
      style={{ outline: 'none', height: '100%', overflow: 'auto', background: '#e9ecef', padding: 24 }}>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => setScale((s) => Math.max(0.2, s - 0.1))}>－</button>
        <span style={{ margin: '0 8px' }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, s + 0.1))}>＋</button>
      </div>
      <Stage width={Math.max(pw + 80, 400)} height={Math.max(ph + 80, 400)}
        onMouseDown={(e) => { if (e.target === e.target.getStage()) select(null) }}>
        <Layer offsetX={-40} offsetY={-40}>
          <Rect x={0} y={0} width={pw} height={ph} fill="#ffffff" shadowBlur={6} shadowOpacity={0.2} />
          {sorted.map((el) => (
            <ElementShape key={el.id} el={el} scale={scale} selected={el.id === selectedId}
              onSelect={() => select(el.id)}
              onChange={(patch) => updateGeometry(el.id, patch)} />
          ))}
        </Layer>
      </Stage>
    </div>
  )
}
```

> 说明：M1 旋转手柄禁用（`rotateEnabled={false}`，旋转属 M2）；图片元素在 Task 16 接入真实图片后替换占位矩形；图片 fit 切换 M1 不做（统一 contain）。

- [ ] **Step 2: 页面骨架**

`src/renderer/pages/designer.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Button, Space, Spin, Input, message } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useDesignerStore } from '../store/designer-store'
import { sessionDraft } from '../session-draft'
import { DesignerCanvas } from '../designer/canvas'
import { ElementLibrary } from '../designer/element-library'
import { LayersPanel } from '../designer/layers-panel'
import { PropertyPanel } from '../designer/property-panel'
import { TemplateDocumentSchema } from '../../../print-core/template-model'

export function DesignerPage(): JSX.Element {
  const { id } = useParams()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const doc = useDesignerStore((s) => s.doc)
  const mode = useDesignerStore((s) => s.mode)
  const dirty = useDesignerStore((s) => s.dirty)
  const load = useDesignerStore((s) => s.load)
  const commit = useDesignerStore((s) => s.commit)
  const markSaved = useDesignerStore((s) => s.markSaved)

  useEffect(() => {
    void (async () => {
      if (sessionDraft.doc && sessionDraft.returnToPrint) {
        load(sessionDraft.doc, 'print-session')
        sessionDraft.returnToPrint = false
      } else if (id) {
        const got = await api.templates.get(id)
        if (!got) { message.error('模板不存在'); nav('/templates'); return }
        load(got, 'template')
      } else {
        nav('/templates')
        return
      }
      setLoading(false)
    })()
    // 不做卸载清理：工作副本由 print 页消费或由 clearDraft() 显式清理
  }, [id])

  async function save(): Promise<void> {
    try {
      const parsed = TemplateDocumentSchema.parse(doc)
      await api.templates.save(parsed)
      markSaved()
      message.success('已保存')
    } catch (e) {
      message.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }
  function backToPrint(): void {
    // 放入改过的工作副本；paramValues / baselineJson 保持 print 页进入时的内容
    sessionDraft.doc = doc
    sessionDraft.returnToPrint = true
    nav('/print')
  }

  if (loading) return <Spin style={{ display: 'block', marginTop: 80 }} />

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 200, background: '#1f2937', color: '#fff', padding: 8, overflow: 'auto' }}>
        <ElementLibrary />
        <LayersPanel />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Space style={{ background: '#fff', padding: 8, borderBottom: '1px solid #eee' }}>
          <Button onClick={() => { useDesignerStore.getState().undo() }}>撤销</Button>
          <Button onClick={() => { useDesignerStore.getState().redo() }}>重做</Button>
          <Input variant="borderless" value={doc.name} disabled style={{ width: 160 }} />
          <span style={{ color: '#888' }}>{doc.paper.widthMm}×{doc.paper.heightMm}mm</span>
          {dirty && <span style={{ color: '#fa8c16' }}>未保存</span>}
          {mode === 'print-session'
            ? <Button type="primary" onClick={backToPrint}>完成，返回打印</Button>
            : <Button type="primary" onClick={save}>保存模板</Button>}
        </Space>
        <div style={{ flex: 1 }}><DesignerCanvas /></div>
      </div>
      <div style={{ width: 240, background: '#fff', borderLeft: '1px solid #eee', overflow: 'auto' }}>
        <PropertyPanel onCommitted={commit} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 先创建三个子组件的最小占位，保证编译通过**

`element-library.tsx` / `layers-panel.tsx` / `property-panel.tsx` 先各导出空壳：

```tsx
export function ElementLibrary(): JSX.Element { return <div /> }
export function LayersPanel(): JSX.Element { return <div /> }
export function PropertyPanel(_p: { onCommitted: () => void }): JSX.Element { return <div /> }
```

（三个文件分别导出各自的命名组件。）

- [ ] **Step 4: 手工验收**

Run: `bun run dev` → 列表新建 A4 模板 → 进入设计器：看到白色纸张（竖向比例）、缩放按钮可用；Task 14 起才能加元素，本步先确认无白屏、无控制台报错。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/designer src/renderer/pages/designer.tsx
git commit -m "feat(designer): Konva 毫米画布/拖动缩放/删除与页面骨架"
```

---

## Task 14: 左栏元素库、图层面板与右栏属性面板

**Files:**

- Modify: `src/renderer/designer/element-library.tsx`, `layers-panel.tsx`, `property-panel.tsx`
- 手工验收见 Step 3。

- [ ] **Step 1: 元素库（添加文本/参数/图形；图片在 Task 16）**

`element-library.tsx`：

```tsx
import { Button, Space } from 'antd'
import { createElement } from '../../../print-core/template-model'
import { useDesignerStore } from '../store/designer-store'

export function ElementLibrary(): JSX.Element {
  const addElement = useDesignerStore((s) => s.addElement)
  const commit = useDesignerStore((s) => s.commit)

  function add(type: 'text' | 'shape', props?: Record<string, unknown>): void {
    const el = createElement(
      type,
      props ?? (type === 'text' ? { text: '双击编辑文本' } : { shape: 'rect' }),
      { x: 20, y: 20, w: type === 'shape' ? 50 : 60, h: type === 'shape' ? 30 : 8 }
    )
    addElement(el)
    commit()
  }

  return (
    <div>
      <div style={{ opacity: 0.7, fontSize: 12, margin: '4px 0' }}>添加元素</div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button block onClick={() => add('text')}>文本</Button>
        <Button block disabled title="在右侧“参数”区新建后自动插入占位">参数占位</Button>
        <Button block disabled>图片（Task 16）</Button>
        <Button block onClick={() => add('shape', { shape: 'line' })}>直线</Button>
        <Button block onClick={() => add('shape', { shape: 'rect' })}>矩形</Button>
        <Button block onClick={() => add('shape', { shape: 'ellipse' })}>椭圆</Button>
      </Space>
    </div>
  )
}
```

- [ ] **Step 2: 图层面板**

`layers-panel.tsx`：

```tsx
import { Button } from 'antd'
import { useDesignerStore } from '../store/designer-store'
import type { ElementType } from '../../../print-core/template-model'

const LABEL: Record<ElementType, string> = {
  text: '文本', param: '参数', image: '图片', shape: '图形'
}

export function LayersPanel(): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const selectedId = useDesignerStore((s) => s.selectedId)
  const select = useDesignerStore((s) => s.select)
  const updateGeometry = useDesignerStore((s) => s.updateGeometry)
  const removeElement = useDesignerStore((s) => s.removeElement)
  const commit = useDesignerStore((s) => s.commit)

  const els = [...doc.content.elements].sort((a, b) => b.zIndex - a.zIndex)
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>图层（{els.length}）</div>
      {els.map((el) => (
        <div key={el.id}
          onClick={() => select(el.id)}
          style={{
            background: el.id === selectedId ? '#2563eb' : '#374151',
            borderRadius: 4, padding: '4px 6px', marginBottom: 3, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12
          }}>
          <span style={{ flex: 1 }}>{LABEL[el.type]}</span>
          <button title="锁定/解锁" onClick={(e) => {
            e.stopPropagation()
            updateGeometry(el.id, { locked: !el.locked }); commit()
          }}>{el.locked ? '🔒' : '🔓'}</button>
          <button title="置顶" onClick={(e) => {
            e.stopPropagation()
            updateGeometry(el.id, { zIndex: Math.max(0, ...doc.content.elements.map((x) => x.zIndex)) + 1 }); commit()
          }}>↑</button>
          <button title="删除" onClick={(e) => {
            e.stopPropagation(); removeElement(el.id); commit()
          }}>×</button>
        </div>
      ))}
      {els.length === 0 && <div style={{ opacity: 0.4, fontSize: 12 }}>暂无元素</div>}
    </div>
  )
}
```

- [ ] **Step 3: 属性面板（几何 + 文本/图形属性）**

`property-panel.tsx`：

```tsx
import { Button, ColorPicker, InputNumber, Input, Select, Space, Switch, Divider } from 'antd'
import { useDesignerStore } from '../store/designer-store'
import { mmToPt, ptToMm } from '../../../shared/units'
import { ParamManager } from './param-manager'

export function PropertyPanel({ onCommitted }: { onCommitted: () => void }): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const selectedId = useDesignerStore((s) => s.selectedId)
  const updateGeometry = useDesignerStore((s) => s.updateGeometry)
  const updateProps = useDesignerStore((s) => s.updateProps)
  const el = doc.content.elements.find((e) => e.id === selectedId)

  function geo(patch: Partial<{ x: number; y: number; w: number; h: number; locked: boolean }>): void {
    if (el) { updateGeometry(el.id, patch); onCommitted() }
  }
  function props(patch: Record<string, unknown>): void {
    if (el) { updateProps(el.id, patch); onCommitted() }
  }

  return (
    <div style={{ padding: 12 }}>
      <Divider orientation="left" plain style={{ fontSize: 12 }}>参数定义</Divider>
      <ParamManager onCommitted={onCommitted} />

      <Divider orientation="left" plain style={{ fontSize: 12 }}>元素属性</Divider>
      {!el && <div style={{ color: '#999' }}>未选中元素</div>}
      {el && (
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Space wrap>
            X <InputNumber size="small" style={{ width: 80 }} value={Number(el.x.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ x: v ?? 0 })} />
            Y <InputNumber size="small" style={{ width: 80 }} value={Number(el.y.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ y: v ?? 0 })} />
            宽 <InputNumber size="small" style={{ width: 80 }} value={Number(el.w.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ w: Math.max(1, v ?? 1) })} />
            高 <InputNumber size="small" style={{ width: 80 }} value={Number(el.h.toFixed(1))} addonAfter="mm"
              onChange={(v) => geo({ h: Math.max(1, v ?? 1) })} />
          </Space>
          <Space>
            锁定 <Switch size="small" checked={el.locked} onChange={(v) => geo({ locked: v })} />
          </Space>

          {el.type === 'text' && (
            <>
              <Input.TextArea rows={2} value={el.props.text} onChange={(e) => props({ text: e.target.value })} />
              <Space wrap>
                字号
                <InputNumber size="small" style={{ width: 90 }} min={1}
                  value={Number(mmToPt(el.props.fontSizeMm).toFixed(1))} addonAfter="pt"
                  onChange={(v) => props({ fontSizeMm: ptToMm(Math.max(1, v ?? 1)) })} />
                <Button size="small" type={el.props.bold ? 'primary' : 'default'}
                  onClick={() => props({ bold: !el.props.bold })}>B</Button>
                <Button size="small" type={el.props.italic ? 'primary' : 'default'}
                  onClick={() => props({ italic: !el.props.italic })}>I</Button>
                <Select size="small" style={{ width: 80 }} value={el.props.align}
                  onChange={(v) => props({ align: v })}
                  options={[{ value: 'left', label: '左' }, { value: 'center', label: '中' }, { value: 'right', label: '右' }]} />
              </Space>
              颜色 <ColorPicker size="small" value={el.props.color}
                onChange={(c) => props({ color: c.toHexString() })} />
            </>
          )}

          {el.type === 'param' && (
            <div style={{ color: '#1677ff', fontSize: 12 }}>
              绑定参数：{doc.params.find((p) => p.id === el.props.paramId)?.label ?? '（已删除）'}
              <div style={{ marginTop: 6 }}>
                <Space wrap>
                  字号
                  <InputNumber size="small" style={{ width: 90 }} min={1}
                    value={Number(mmToPt(el.props.fontSizeMm).toFixed(1))} addonAfter="pt"
                    onChange={(v) => props({ fontSizeMm: ptToMm(Math.max(1, v ?? 1)) })} />
                  <Button size="small" type={el.props.bold ? 'primary' : 'default'}
                    onClick={() => props({ bold: !el.props.bold })}>B</Button>
                </Space>
              </div>
            </div>
          )}

          {el.type === 'shape' && (
            <>
              <Select size="small" style={{ width: 120 }} value={el.props.shape}
                onChange={(v) => props({ shape: v })}
                options={[{ value: 'line', label: '直线' }, { value: 'rect', label: '矩形' }, { value: 'ellipse', label: '椭圆' }]} />
              线宽 <InputNumber size="small" style={{ width: 100 }} min={0} step={0.1}
                value={el.props.strokeWidthMm} addonAfter="mm"
                onChange={(v) => props({ strokeWidthMm: Math.max(0, v ?? 0) })} />
              描边 <ColorPicker size="small" value={el.props.strokeColor}
                onChange={(c) => props({ strokeColor: c.toHexString() })} />
              填充 <ColorPicker size="small" allowClear value={el.props.fillColor ?? undefined}
                onChange={(c) => props({ fillColor: c ? c.toHexString() : null })} />
            </>
          )}
        </Space>
      )}
    </div>
  )
}
```

- [ ] **Step 4: ParamManager 占位（Task 15 完整实现）**

先创建 `src/renderer/designer/param-manager.tsx` 导出最小组件使编译通过：

```tsx
export function ParamManager(_p: { onCommitted: () => void }): JSX.Element {
  return <div style={{ color: '#999', fontSize: 12 }}>参数管理（Task 15）</div>
}
```

- [ ] **Step 5: 手工验收**

1. 添加文本/三种图形 → 图层列表出现；画布上可拖动、拖缩放框改尺寸，属性面板 X/Y/宽高联动。
2. 双击文本弹 prompt 改字；B/I/字号/颜色生效。
3. 图层锁定后元素不可拖动；置顶改变叠放顺序；删除按钮与 Delete 键都能删。
4. 撤销/重做覆盖添加、拖动、改属性。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/designer
git commit -m "feat(designer): 元素库/图层面板/属性面板"
```

---

## Task 15: 参数定义管理（参数占位与 param 定义成对插入）

**Files:**

- Modify: `src/renderer/designer/param-manager.tsx`（完整实现）, `src/renderer/designer/element-library.tsx`（启用参数按钮）
- 手工验收见 Step 3。

- [ ] **Step 1: 完整 ParamManager**

`param-manager.tsx`：

```tsx
import { useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Popconfirm } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useDesignerStore } from '../store/designer-store'
import { createElement, createParamDef, type ParamDef, type ParamType } from '../../../print-core/template-model'

const TYPE_LABEL: Record<ParamType, string> = {
  text: '单行文本', textarea: '多行文本', date: '日期', number: '数字/金额'
}

export function ParamManager({ onCommitted }: { onCommitted: () => void }): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const addOrUpdateParam = useDesignerStore((s) => s.addOrUpdateParam)
  const removeParam = useDesignerStore((s) => s.removeParam)
  const addElement = useDesignerStore((s) => s.addElement)
  const [editing, setEditing] = useState<ParamDef | null>(null)

  function upsert(values: Partial<ParamDef> & { key: string; label: string; type: ParamType }): void {
    const def = editing
      ? { ...editing, ...values }
      : createParamDef({ key: values.key, label: values.label, type: values.type })
    addOrUpdateParam(def)
    // 新建定义时，若无元素引用它则自动插入一个 param 占位（同一 mutate 内成对，避免模型校验失败）
    const referenced = doc.content.elements.some(
      (e) => e.type === 'param' && e.props.paramId === def.id
    )
    if (!referenced) {
      const el = createElement('param', { paramId: def.id }, { x: 20, y: 40 + doc.content.elements.length * 12, w: 70, h: 8 })
      addElement(el)
    }
    onCommitted()
    setEditing(null)
  }

  return (
    <div>
      <Button size="small" type="dashed" icon={<PlusOutlined />} block
        onClick={() => setEditing(createParamDef({ key: `f${doc.params.length + 1}`, label: '新参数', type: 'text' }))}>
        添加参数
      </Button>
      <Table size="small" rowKey="id" pagination={false} style={{ marginTop: 8 }}
        dataSource={[...doc.params].sort((a, b) => a.order - b.order)}
        columns={[
          { title: '名称', dataIndex: 'label' },
          { title: '类型', render: (_, r: ParamDef) => TYPE_LABEL[r.type] },
          {
            title: '操作', width: 90,
            render: (_, r: ParamDef) => (
              <Space size="small">
                <a onClick={() => setEditing(r)}>编辑</a>
                <Popconfirm title="删除参数会同时删除画布上的占位元素" onConfirm={() => { removeParam(r.id); onCommitted() }}
                  okText="删除" cancelText="取消">
                  <a style={{ color: '#cf1322' }}>删</a>
                </Popconfirm>
              </Space>
            )
          }
        ]} />

      {editing && (
        <ParamEditModal def={editing} isNew={!doc.params.some((p) => p.id === editing.id)}
          onCancel={() => setEditing(null)} onOk={upsert} />
      )}
    </div>
  )
}

function ParamEditModal({ def, isNew, onOk, onCancel }: {
  def: ParamDef
  isNew: boolean
  onOk: (v: Partial<ParamDef> & { key: string; label: string; type: ParamType }) => void
  onCancel: () => void
}): JSX.Element {
  const [f, setF] = useState<ParamDef>(def)
  return (
    <Modal open title={isNew ? '添加参数' : '编辑参数'} onCancel={onCancel}
      onOk={() => onOk(f)} okText="确定" cancelText="取消">
      <Form layout="vertical" size="small">
        <Form.Item label="字段标识（英文 key，保存后不可改）" required>
          <Input value={f.key} disabled={!isNew}
            onChange={(e) => setF({ ...f, key: e.target.value })} />
        </Form.Item>
        <Form.Item label="显示名称" required>
          <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
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
          <Space>
            <span>小数位</span>
            <InputNumber min={0} max={6} value={f.decimals} onChange={(v) => setF({ ...f, decimals: v ?? 0 })} />
            <span>千分位</span>
            <Switch checked={f.thousandsSeparator} onChange={(v) => setF({ ...f, thousandsSeparator: v })} />
          </Space>
        )}
        <Form.Item label="值为空时">
          <Select value={f.printOnEmpty} onChange={(v) => setF({ ...f, printOnEmpty: v })}
            options={[{ value: 'blank', label: '留空白' }, { value: 'line', label: '打印占位横线' }]} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
```

- [ ] **Step 2: 元素库中"参数占位"按钮改为提示语（参数统一由参数区添加）**

把 `element-library.tsx` 中该按钮替换为说明文本：

```tsx
<div style={{ opacity: 0.5, fontSize: 12, margin: '6px 0' }}>
  参数占位请在右栏“添加参数”，会自动放到画布上
</div>
```

- [ ] **Step 3: 手工验收**

1. 添加参数 key=`name`、名称"姓名"、单行文本、必填 → 画布自动出现虚线参数框；图层面板出现"参数"行。
2. 添加 date 类型默认 today；number 类型 2 位小数+千分位；保存模板后重开，参数与元素都在。
3. 编辑参数改类型生效；删除参数时其占位元素同步消失；key 非法（中文/数字开头）点"保存模板"时弹出错误提示（save 的 try/catch 已在 Task 13 实现），模板不被保存。
4. 打印会话模式（Task 19 联调）下加参数不应被要求保存——store 不区分，均允许，返回打印页即可。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/designer
git commit -m "feat(designer): 参数定义 CRUD 与占位元素联动"
```

---

## Task 16: 图片元素上传与画布渲染

**Files:**

- Modify: `src/renderer/designer/element-library.tsx`, `src/renderer/designer/canvas.tsx`
- 手工验收见 Step 3。

- [ ] **Step 1: 元素库增加图片上传按钮**

在 `element-library.tsx` 中，把 Task 14 遗留的禁用按钮 `<Button block disabled>图片（Task 16）</Button>` 替换为下面的真实上传按钮 + 隐藏 input；组件顶部补充 `import { useRef } from 'react'`，并从 store 取 `const doc = useDesignerStore((s) => s.doc)`：

```tsx
import { useRef } from 'react'
// 在组件内：
const fileRef = useRef<HTMLInputElement>(null)
const doc = useDesignerStore((s) => s.doc)

async function pickImage(): Promise<void> {
  fileRef.current?.click()
}
async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  // 新模板可能尚未保存过：先确保模板在库（create 时已入库，故 id 可用）
  const { assetId } = await window.api.assets.import({ templateId: doc.id, sourcePath: (file as File & { path: string }).path })
  const el = createElement('image', { assetId, fit: 'contain', opacity: 1 }, { x: 20, y: 60, w: 40, h: 40 })
  addElement(el)
  commit()
}
// JSX：
<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/bmp"
  style={{ display: 'none' }} onChange={onFile} />
<Button block onClick={pickImage}>图片</Button>
```

> Electron 31 中 File 带 `path` 属性（需在 TS 里就地扩展，代码已用 `File & { path: string }`）。沙箱渲染进程通过 IPC 传路径字符串，由主进程读盘。

- [ ] **Step 2: 画布渲染真实图片（精确改动三处）**

改动 A — 把 react-konva 导入行补上图片组件，并在 `canvas.tsx` 模块顶层加图片加载 hook：

```tsx
import { Stage, Layer, Rect, Text as KText, Image as KImage, Line, Ellipse, Transformer } from 'react-konva'
```

```tsx
function useLoadedImage(url: string | undefined): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement | undefined>()
  useEffect(() => {
    if (!url) { setImg(undefined); return }
    const i = new window.Image()
    i.onload = () => setImg(i)
    i.src = url
  }, [url])
  return img
}
```

改动 B — `ElementShape` 增加 `assetUrls` 参数，并在组件顶层（所有分支之前）无条件调用 hook，替换原 image 分支：

```tsx
function ElementShape({ el, scale, selected, onSelect, onChange, assetUrls }: {
  el: TemplateElement
  scale: number
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h'>>) => void
  assetUrls: Record<string, string>
}): JSX.Element {
  // ...既有 ref/useEffect/common 不变...
  const imageEl = useLoadedImage(el.type === 'image' ? assetUrls[el.props.assetId] : undefined)
  // ...
  } else if (el.type === 'image') {
    body = (
      <KImage ref={shapeRef as never} {...common} image={imageEl} opacity={el.props.opacity} />
    )
  }
```

改动 C — `DesignerCanvas` 加载资产映射，并在 map 处传入：

```tsx
const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
const imageCount = doc.content.elements.filter((e) => e.type === 'image').length
useEffect(() => {
  void window.api.assets.listUrls(doc.id).then(setAssetUrls).catch(() => setAssetUrls({}))
}, [doc.id, imageCount])
// ...
<ElementShape key={el.id} el={el} scale={scale} selected={el.id === selectedId}
  onSelect={() => select(el.id)}
  onChange={(patch) => updateGeometry(el.id, patch)}
  assetUrls={assetUrls} />
```

M1 图片统一 `contain`（fit 切换放 M2），无 crop 计算。

- [ ] **Step 3: 手工验收**

1. 添加图片选择本地 PNG/JPG → 画布显示图片，可拖动缩放。
2. 保存模板 → 关闭重开，图片仍显示（验证资产落盘与 listUrls）。
3. 删除该模板后，userData/assets/<id> 目录被清空（可用资源管理器打开 `%APPDATA%/template-print/assets` 核对）。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/designer
git commit -m "feat(designer): 图片上传/持久化/画布渲染"
```

---

## Task 17: 打印填写页（动态表单 + 实时预览）

**Files:**

- Create/Modify: `src/renderer/pages/print.tsx`
- 手工验收见 Step 3。

- [ ] **Step 1: 实现打印页（完整最终代码）**

`src/renderer/pages/print.tsx`：

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { clearDraft, sessionDraft } from '../session-draft'
import { renderPrintDocument } from '../../../print-core/render-print-document'
import { evaluateParams, type EvaluatedValues } from '../../../print-core/param-evaluator'
import { mmToPxAt96 } from '../../../shared/units'
import type { ParamDef, TemplateDocument } from '../../../print-core/template-model'
import type { PrinterInfoDto } from '../../../shared/ipc-contract'

export function PrintPage(): JSX.Element {
  const { id } = useParams()
  const nav = useNavigate()

  const [doc, setDoc] = useState<TemplateDocument | null>(null)
  const [fromHistory, setFromHistory] = useState(false)
  const [printers, setPrinters] = useState<PrinterInfoDto[]>([])
  const [printerName, setPrinterName] = useState('')
  const [mode, setMode] = useState<'silent' | 'dialog'>('silent')
  const [copies, setCopies] = useState(1)
  const [values, setValues] = useState<Record<string, string>>({})
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [lastResult, setLastResult] = useState<{ working: TemplateDocument } | null>(null)

  // 原始模板基线（用于 dirty 判定）；从调整版式返回时从草稿恢复
  const baselineRef = useRef<string>('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    void (async () => {
      let loaded: TemplateDocument | null = null
      let restoredValues: Record<string, string> | null = null
      let historyFlag = false
      let baseline: string | null = null

      if (sessionDraft.doc) {
        // 从设计器“完成返回”或历史“重打”进入
        loaded = sessionDraft.doc
        restoredValues = sessionDraft.paramValues
        historyFlag = sessionDraft.fromHistory
        baseline = sessionDraft.baselineJson
        clearDraft()
      } else if (id) {
        loaded = await api.templates.get(id)
      }
      if (!loaded) { message.error('模板不存在'); nav('/templates'); return }

      setDoc(loaded)
      setFromHistory(historyFlag)
      baselineRef.current = baseline ?? JSON.stringify(loaded)

      const [prts, defPrinter] = await Promise.all([api.printers.list(), api.printers.getDefault()])
      setPrinters(prts)
      setPrinterName(loaded.printerName ?? defPrinter ?? prts.find((p) => p.isDefault)?.name ?? prts[0]?.name ?? '')
      setMode(loaded.printMode)

      const init: Record<string, string> = {}
      for (const p of loaded.params) {
        init[p.key] = p.defaultValue === 'today' && p.type === 'date'
          ? dayjs().format('YYYY-MM-DD')
          : p.defaultValue
      }
      setValues(restoredValues ?? init)
      setAssetUrls(loaded.id.startsWith('__') ? {} : await api.assets.listUrls(loaded.id).catch(() => ({})))
    })()
  }, [id, nav])

  // 预览区域尺寸
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 32, h: el.clientHeight - 60 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  const evaluated = useMemo<EvaluatedValues>(
    () => (doc ? evaluateParams(doc.params, values) : {}),
    [doc, values]
  )
  const previewHtml = useMemo(
    () => (doc ? renderPrintDocument(doc, evaluated, assetUrls) : ''),
    [doc, evaluated, assetUrls]
  )

  // 预览 iframe：按 96dpi 得到物理像素，再缩放到可用区域
  const preview = useMemo(() => {
    if (!doc || box.w < 10 || box.h < 10) return null
    const naturalW = mmToPxAt96(doc.paper.widthMm)
    const naturalH = mmToPxAt96(doc.paper.heightMm)
    const scale = Math.min(box.w / naturalW, box.h / naturalH, 1.5)
    return { w: naturalW * scale, h: naturalH * scale, scale }
  }, [doc, box])

  if (!doc) return <Spin style={{ display: 'block', marginTop: 80 }} />
  const errors = evaluated.__errors ?? []

  function setValue(key: string, v: unknown): void {
    setValues((prev) => ({ ...prev, [key]: v === null || v === undefined ? '' : String(v) }))
  }

  function field(p: ParamDef): JSX.Element {
    const v = values[p.key] ?? ''
    if (p.type === 'textarea') {
      return <Input.TextArea rows={2} value={v} onChange={(e) => setValue(p.key, e.target.value)} />
    }
    if (p.type === 'date') {
      return (
        <DatePicker
          style={{ width: '100%' }}
          format={p.dateFormat.replace(/yyyy/g, 'YYYY').replace(/dd/g, 'DD')}
          value={v ? dayjs(v) : null}
          onChange={(d: Dayjs | null) => setValue(p.key, d ? d.format('YYYY-MM-DD') : '')}
        />
      )
    }
    if (p.type === 'number') {
      return (
        <InputNumber
          style={{ width: '100%' }}
          value={v === '' ? null : Number(v)}
          onChange={(n) => setValue(p.key, n === null ? '' : String(n))}
        />
      )
    }
    return <Input value={v} maxLength={p.maxLength ?? undefined} onChange={(e) => setValue(p.key, e.target.value)} />
  }

  function editLayout(): void {
    if (!doc) return
    sessionDraft.doc = doc
    sessionDraft.paramValues = values
    sessionDraft.returnToPrint = true
    sessionDraft.fromHistory = false
    sessionDraft.baselineJson = baselineRef.current
    nav('/designer')
  }

  async function doPrint(): Promise<void> {
    if (!doc) return
    if (errors.length > 0) { message.warning(`请填写必填项：${errors.join(', ')}`); return }
    if (!printerName) { message.warning('请选择打印机'); return }
    const working: TemplateDocument = { ...doc, printMode: mode, printerName }
    let res
    try {
      res = await api.print.submit({ template: working, paramValues: values, printerName, copies, mode })
    } catch (e) {
      message.error(`打印失败：${e instanceof Error ? e.message : String(e)}`)
      return
    }
    if (res.status === 'success') message.success('打印任务已发送')
    else if (res.status === 'cancelled') message.info('已取消打印')
    else message.error(`打印失败：${res.errorMessage ?? '未知错误'}`)

    // 来自真实模板（非历史重打）且版式相对基线有改动 → 弹保存决策
    const changed = JSON.stringify(working) !== baselineRef.current
    if (res.status === 'success' && !working.id.startsWith('__') && !fromHistory && changed) {
      setLastResult({ working })
      setSaveOpen(true)
    } else {
      nav('/history')
    }
  }

  async function saveOverwrite(): Promise<void> {
    if (!lastResult) return
    await api.templates.save(lastResult.working)
    message.success('改动已保存到原模板')
    setSaveOpen(false)
    nav('/history')
  }

  async function saveAsNew(): Promise<void> {
    if (!lastResult) return
    const w = lastResult.working
    const created = await api.templates.create({
      name: `${w.name} 副本`,
      widthMm: w.paper.widthMm,
      heightMm: w.paper.heightMm
    })
    await api.templates.save({ ...w, id: created.id, createdAt: created.createdAt, isBuiltin: false })
    message.success('已另存为新模板（图片需重新上传）')
    setSaveOpen(false)
    nav('/history')
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 280, background: '#fff', borderRight: '1px solid #eee', padding: 16, overflow: 'auto' }}>
        <h3>{doc.name}</h3>
        <Form layout="vertical" size="small">
          {[...doc.params].sort((a, b) => a.order - b.order).map((p) => (
            <Form.Item
              key={p.id}
              label={p.label + (p.required ? ' *' : '')}
              validateStatus={errors.includes(p.key) ? 'error' : ''}
              help={errors.includes(p.key) ? '必填' : undefined}
            >
              {field(p)}
            </Form.Item>
          ))}
        </Form>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            打印机
            <Select
              style={{ width: '100%' }}
              value={printerName}
              onChange={setPrinterName}
              options={printers.map((p) => ({
                value: p.name,
                label: `${p.name}${p.isDefault ? '（系统默认）' : ''}`
              }))}
            />
          </div>
          <Space>
            <span>静默直打</span>
            <Switch checked={mode === 'silent'} onChange={(v) => setMode(v ? 'silent' : 'dialog')} />
            <span>份数</span>
            <InputNumber min={1} max={99} value={copies} onChange={(v) => setCopies(v ?? 1)} style={{ width: 70 }} />
          </Space>
          <Space>
            <Button type="primary" onClick={doPrint}>打印</Button>
            <Button onClick={editLayout}>调整版式</Button>
          </Space>
        </Space>
      </div>

      <div ref={wrapRef} style={{ flex: 1, overflow: 'hidden', background: '#e9ecef', padding: 16, textAlign: 'center' }}>
        <div style={{ color: '#666', marginBottom: 8 }}>实时预览（{doc.paper.widthMm}×{doc.paper.heightMm}mm）</div>
        {preview && (
          <iframe
            title="preview"
            srcDoc={previewHtml}
            scrolling="no"
            style={{
              border: 'none',
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,.2)',
              width: mmToPxAt96(doc.paper.widthMm),
              height: mmToPxAt96(doc.paper.heightMm),
              transform: `scale(${preview.scale})`,
              transformOrigin: 'top center'
            }}
          />
        )}
      </div>

      <Modal
        title="版式有改动，是否保存？"
        open={saveOpen}
        onCancel={() => { setSaveOpen(false); nav('/history') }}
        cancelText="不保存"
        footer={[
          <Button key="no" onClick={() => { setSaveOpen(false); nav('/history') }}>不保存</Button>,
          <Button key="new" onClick={saveAsNew}>另存为新模板</Button>,
          <Button key="yes" type="primary" onClick={saveOverwrite}>保存到原模板</Button>
        ]}
      >
        <p>本次打印前对版式做了修改。可保存到原模板、另存为新模板，或仅本次生效不保存。</p>
      </Modal>
    </div>
  )
}
```

要点：

- `baselineRef` 记录进入时原始模板 JSON；普通进入时基线为库中版本，调整版式往返时通过 `sessionDraft.baselineJson` 保留最初基线，dirty 判定不会因往返而失效。
- 历史重打（`fromHistory`）与测试页（id 以 `__` 开头）打印后不弹保存决策。
- "另存为新模板"的图片限制与 Task 9 的 duplicate 一致（新模板需重新上传图片）。

- [ ] **Step 2: 手工验收**

1. 从列表"使用"进入：左侧按参数定义出现表单；日期默认今天；改任意字段右侧预览即时变化。
2. 必填清空后点打印被拦截并提示；数字千分位/小数位在预览中体现；空值横线参数显示横线。
3. 打印机下拉列出系统打印机（Task 18 的 PrinterService 已在打印管线任务一并落地，按任务顺序执行即可）。
4. "调整版式"跳到设计器（标题栏显示"完成，返回打印"），拖动元素后返回：已填参数保留、预览反映改动；此时打印成功会弹保存决策三选项。
5. 小票/标签模板下预览自动按纸张比例缩放。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/pages/print.tsx
git commit -m "feat(ui): 打印参数表单/毫米实时预览/保存决策"
```

---

## Task 18: 打印管线主进程（离屏窗口 / print / 缩略图 / 历史落库）

**Files:**

- Create: `electron/main/services/print-service.ts`, `history-service.ts`, `printer-service.ts`（本任务实现打印与历史；打印机枚举在 Task 21 补全，本任务先最小实现 list）
- Modify: `electron/main/ipc/index.ts`, `electron/main/index.ts`
- Test: `tests/print-core/end-to-end-document.test.ts`（渲染产物断言，硬件部分人工验收）

- [ ] **Step 1: PrinterService 最小版（枚举 + app 默认设置；状态与测试页 Task 21 补）**

`electron/main/services/printer-service.ts`：

```ts
import { ipcMain, BrowserWindow } from 'electron'
import { IPC, type PrinterInfoDto } from '../../../shared/ipc-contract'
import { loadSettings, saveSettings, type AppSettings } from '../settings'
import type { Services } from '../ipc'

export class PrinterService {
  constructor(private dataDir: string) {}

  async list(win: BrowserWindow): Promise<PrinterInfoDto[]> {
    const all = await win.webContents.getPrintersAsync()
    return all.map((p) => ({ name: p.name, isDefault: p.isDefault }))
  }
  getDefault(): string | null {
    return loadSettings(this.dataDir).defaultPrinterName
  }
  setDefault(name: string): void {
    const s: AppSettings = { defaultPrinterName: name }
    saveSettings(this.dataDir, s)
  }
}

export function registerPrinterHandlers(deps: Services, win: BrowserWindow): void {
  if (!deps.printers) return
  const svc = deps.printers
  ipcMain.handle(IPC.printersList, () => svc.list(win))
  ipcMain.handle(IPC.printersGetDefault, () => svc.getDefault())
  ipcMain.handle(IPC.printersSetDefault, (_e, name: string) => svc.setDefault(name))
  ipcMain.handle(IPC.printersTestPage, () => { throw new Error('Task 21') })
}
```

- [ ] **Step 2: HistoryService + JobRepository 接线**

`electron/main/services/history-service.ts`：

```ts
import { ipcMain } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { IPC } from '../../../shared/ipc-contract'
import { JobRepository, type NewJob } from '../../../db/repositories/job-repo'
import type { Services } from '../ipc'

export class HistoryService {
  constructor(
    private dataDir: string,
    private jobs: JobRepository
  ) {}
  list(filter?: { templateId?: string; from?: number; to?: number; keyword?: string }) {
    return Promise.resolve(this.jobs.list(filter ?? {}))
  }
  get(id: string) {
    return Promise.resolve(this.jobs.getById(id))
  }
  insert(job: NewJob): void {
    this.jobs.insert(job)
  }
  /** 缩略图以 dataURL 返回：dev 下渲染页是 http 源，不能直接读 file:// */
  thumbDataUrl(relOrAbs: string): string {
    const abs = relOrAbs.includes(this.dataDir) ? relOrAbs : join(this.dataDir, relOrAbs)
    return 'data:image/png;base64,' + readFileSync(abs).toString('base64')
  }
}

export function registerHistoryHandlers(deps: Services): void {
  if (!deps.history) return
  const svc = deps.history
  ipcMain.handle(IPC.jobsList, (_e, filter) => svc.list(filter))
  ipcMain.handle(IPC.jobsGet, (_e, id: string) => svc.get(id))
  ipcMain.handle(IPC.thumbFileUrl, (_e, p: string) => svc.thumbDataUrl(p))
}
```

- [ ] **Step 3: PrintService（核心）**

`electron/main/services/print-service.ts`：

```ts
import { BrowserWindow, ipcMain } from 'electron'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type SubmitPrintInput, type SubmitPrintResult } from '../../../shared/ipc-contract'
import { renderPrintDocument } from '../../../print-core/render-print-document'
import { evaluateParams } from '../../../print-core/param-evaluator'
import { mmToMicron } from '../../../shared/units'
import { TemplateDocumentSchema, localId, type TemplateDocument } from '../../../print-core/template-model'
import type { AssetService } from './asset-service'
import type { HistoryService } from './history-service'
import type { Services } from '../ipc'

function waitImagesReady(win: BrowserWindow, timeoutMs = 5000): Promise<void> {
  return Promise.race([
    win.webContents.executeJavaScript(
      `Promise.all([...document.images].map(img => img.complete ? Promise.resolve() :
        new Promise(res => { img.onload = res; img.onerror = res; }))).then(() => 'ready')`
    ) as Promise<string>,
    new Promise<void>((res) => setTimeout(res, timeoutMs))
  ]).then(() => undefined)
}

function callPrint(
  win: BrowserWindow,
  opts: { silent: boolean; deviceName?: string; copies: number; widthMm: number; heightMm: number }
): Promise<{ success: boolean; reason: string | null }> {
  return new Promise((resolve) => {
    win.webContents.print(
      {
        silent: opts.silent,
        deviceName: opts.deviceName,
        copies: opts.copies,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: mmToMicron(opts.widthMm), height: mmToMicron(opts.heightMm) }
      },
      (success, reason) => resolve({ success, reason: reason ?? null })
    )
  })
}

export class PrintService {
  constructor(
    private dataDir: string,
    private assets: AssetService,
    private history: HistoryService
  ) {}

  private assetFileUrls(doc: TemplateDocument): Record<string, string> {
    const out: Record<string, string> = {}
    for (const el of doc.content.elements) {
      if (el.type === 'image') {
        try { out[el.props.assetId] = this.assets.fileUrl(el.props.assetId) }
        catch { /* 资产缺失：渲染为空并在打印前校验时拦截 */ }
      }
    }
    return out
  }

  async submit(input: SubmitPrintInput): Promise<SubmitPrintResult> {
    // IPC 入参不可信，先经模型校验（非法结构直接 reject，由渲染端提示）
    const doc = TemplateDocumentSchema.parse(input.template)
    const paramValues = input.paramValues
    // 打印前校验：图片资产必须存在
    for (const el of doc.content.elements) {
      if (el.type === 'image' && !this.assets.repo.get(el.props.assetId)) {
        throw new Error(`模板引用的图片不存在（元素 ${el.id}），请重新上传后再打印`)
      }
    }
    const values = evaluateParams(doc.params, paramValues)
    if (values.__errors?.length) throw new Error(`必填项未填：${values.__errors.join(', ')}`)

    const html = renderPrintDocument(doc, values, this.assetFileUrls(doc))
    const jobId = localId('job')
    const htmlPath = join(this.dataDir, 'print-tmp', `${jobId}.html`)
    writeFileSync(htmlPath, html, 'utf-8')

    const win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: false }
    })

    let status: 'success' | 'failed' | 'cancelled' = 'failed'
    let errorMessage: string | null = null
    let thumbPath: string | null = null

    try {
      await win.loadFile(htmlPath)
      await waitImagesReady(win)

      // 缩略图（打印前抓帧）
      try {
        const image = await win.webContents.capturePage()
        thumbPath = join('thumbs', `${jobId}.png`)
        writeFileSync(join(this.dataDir, thumbPath), image.resize({ width: 240 }).toPNG())
      } catch {
        thumbPath = null
      }

      const { success, reason } = await callPrint(win, {
        silent: input.mode === 'silent',
        deviceName: input.printerName || undefined,
        copies: input.copies,
        widthMm: doc.paper.widthMm,
        heightMm: doc.paper.heightMm
      })
      // Electron：用户在系统对话框取消时 failureReason 为 'cancelled'
      if (reason === 'cancelled') status = 'cancelled'
      else if (success) status = 'success'
      else { status = 'failed'; errorMessage = reason }
    } catch (e) {
      status = 'failed'
      errorMessage = e instanceof Error ? e.message : String(e)
    } finally {
      win.destroy()
      rmSync(htmlPath, { force: true })
    }

    this.history.insert({
      id: jobId,
      // 以 __ 开头的是临时合成模板（测试页），不关联真实模板
      templateId: doc.id && !doc.id.startsWith('__') ? doc.id : null,
      templateNameSnapshot: doc.name,
      templateSnapshot: doc,
      paramValues,
      thumbPath,
      printerName: input.printerName,
      copies: input.copies,
      printMode: input.mode,
      status,
      errorMessage,
      createdAt: Date.now()
    })

    return { jobId, status, errorMessage, thumbPath }
  }
}

export function registerPrintHandlers(deps: Services, _win: BrowserWindow): void {
  if (!deps.print) return
  const svc = deps.print
  ipcMain.handle(IPC.printSubmit, (_e, input: SubmitPrintInput) => svc.submit(input))
}
```

`Services` 最终形态（`electron/main/ipc/index.ts`）：

```ts
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import type { AssetService } from '../services/asset-service'
import type { TemplateService } from '../services/template-service'
import type { PrintService } from '../services/print-service'
import type { PrinterService } from '../services/printer-service'
import type { HistoryService } from '../services/history-service'
import { registerTemplateHandlers } from '../services/template-service'
import { registerAssetHandlers } from '../services/asset-service'
import { registerPrinterHandlers } from '../services/printer-service'
import { registerPrintHandlers } from '../services/print-service'
import { registerHistoryHandlers } from '../services/history-service'

export interface Services {
  assets: AssetService
  templates: TemplateService
  print: PrintService
  printers: PrinterService
  history: HistoryService
}

export function registerIpc(mainWindow: BrowserWindow, deps: Services): void {
  registerTemplateHandlers(deps)
  registerAssetHandlers(deps)
  registerPrinterHandlers(deps, mainWindow)
  registerPrintHandlers(deps, mainWindow)
  registerHistoryHandlers(deps)
  ipcMain.removeHandler(IPC.thumbFileUrl)
  ipcMain.handle(IPC.thumbFileUrl, (_e, p: string) => deps.history.thumbDataUrl(p))
}
```

`electron/main/index.ts` whenReady 装配更新：

```ts
import { JobRepository } from '../../db/repositories/job-repo'
import { HistoryService } from './services/history-service'
import { PrintService } from './services/print-service'
import { PrinterService } from './services/printer-service'
// ...
const assetRepo = new AssetRepository(client.db)
const assets = new AssetService(p.dataDir, assetRepo)
const templates = new TemplateService(new TemplateRepository(client.db), assets)
const history = new HistoryService(p.dataDir, new JobRepository(client.db))
const print = new PrintService(p.dataDir, assets, history)
const printers = new PrinterService(p.dataDir)
const win = createWindow()
registerIpc(win, { assets, templates, history, printers, print })
```

> Task 21 会把 PrinterService 构造改为 `(dataDir, print)` 并同步更新本行。

- [ ] **Step 4: 渲染产物测试（不依赖硬件）**

`tests/print-core/end-to-end-document.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createTemplate, createElement, createParamDef } from '../../print-core/template-model'
import { evaluateParams } from '../../print-core/param-evaluator'
import { renderPrintDocument } from '../../print-core/render-print-document'

it('端到端：模板+用户输入 → 完整打印 HTML', () => {
  const tpl = createTemplate('t', '小票', { widthMm: 80, heightMm: 200 })
  const p = createParamDef({ key: 'name', label: '姓名', type: 'text' })
  tpl.params.push(p)
  tpl.content.elements.push(
    createElement('text', { text: '收银小票', bold: true, align: 'center' }, { x: 0, y: 5, w: 80, h: 8 }),
    createElement('param', { paramId: p.id }, { x: 5, y: 20, w: 70, h: 6 })
  )
  const values = evaluateParams(tpl.params, { name: '李四' })
  const html = renderPrintDocument(tpl, values, {})
  expect(html).toContain('size: 80mm 200mm')
  expect(html).toContain('李四')
})
```

Run: `bun run test` → 全绿；`bun run typecheck` → 通过。

- [ ] **Step 5: 硬件手工验收清单（必须在真实 Windows + 打印机或"Microsoft Print to PDF"上执行）**

1. 选 "Microsoft Print to PDF"，静默模式：点打印后直接弹文件保存框（说明 silent 链路工作），输出 PDF 尺寸/内容与预览一致。
2. 切到弹框模式：出现系统打印对话框，取消后历史出现 `cancelled` 记录。
3. 制造失败：打印中途把打印机名改为不存在的名字（可在设置页临时操作），历史出现 `failed` 且有错误信息。
4. 检查 `%APPDATA%/template-print/thumbs/` 生成了缩略图 PNG。
5. 打印成功且改过版式 → 弹三选项，分别验证：覆盖原模板（回列表编辑可见改动）、另存为新模板（出现新模板）、不保存（原模板不变）。

- [ ] **Step 6: 提交**

```bash
git add electron tests/print-core
git commit -m "feat: 离屏窗口静默/弹框打印管线/缩略图/历史落库"
```

---

## Task 19: 打印历史页（表格、筛选、缩略图、重打）

**Files:**

- Create/Modify: `src/renderer/pages/history.tsx`
- 手工验收见 Step 3。

- [ ] **Step 1: 实现历史页（完整最终代码）**

`src/renderer/pages/history.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Button, DatePicker, Image, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { clearDraft, sessionDraft } from '../session-draft'
import type { JobListItem } from '../../../db/repositories/job-repo'

const { RangePicker } = DatePicker

function Thumb({ path }: { path: string | null }): JSX.Element {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    if (path) void api.thumbUrl(path).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [path])
  if (!path) return <span style={{ color: '#aaa' }}>无</span>
  return <Image width={36} height={Math.round(36 * 1.414)} style={{ objectFit: 'contain' }} src={url} />
}

export function HistoryPage(): JSX.Element {
  const nav = useNavigate()
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [templateId, setTemplateId] = useState<string | undefined>(undefined)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [keyword, setKeyword] = useState('')

  async function refresh(): Promise<void> {
    setJobs(
      await api.jobs.list({
        templateId,
        from: range?.[0] ? range[0].startOf('day').valueOf() : undefined,
        to: range?.[1] ? range[1].endOf('day').valueOf() : undefined,
        keyword: keyword || undefined
      })
    )
  }
  useEffect(() => { void refresh() }, [templateId, range, keyword])
  useEffect(() => {
    void api.templates.list({}).then((ts) => setTemplates(ts.map((t) => ({ id: t.id, name: t.name }))))
  }, [])

  function reprint(job: JobListItem): void {
    clearDraft()
    sessionDraft.doc = job.templateSnapshot
    sessionDraft.paramValues = job.paramValues
    sessionDraft.fromHistory = true
    sessionDraft.returnToPrint = false
    sessionDraft.baselineJson = JSON.stringify(job.templateSnapshot)
    nav('/print')
  }

  const columns: ColumnsType<JobListItem> = [
    { title: '时间', dataIndex: 'createdAt', width: 140, render: (v: number) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '缩略图', dataIndex: 'thumbPath', width: 80, render: (p: string | null) => <Thumb path={p} /> },
    { title: '模板', dataIndex: 'templateNameSnapshot', width: 140 },
    {
      title: '参数摘要', dataIndex: 'paramValues',
      render: (v: Record<string, string>) =>
        Object.entries(v).map(([k, val]) => `${k}=${val}`).join('，') || '—'
    },
    { title: '打印机', dataIndex: 'printerName', width: 160 },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (s: string, r) => {
        if (s === 'success') return <Tag color="green">成功</Tag>
        if (s === 'cancelled') return <Tag>已取消</Tag>
        return <Tooltip title={r.errorMessage ?? ''}><Tag color="red">失败</Tag></Tooltip>
      }
    },
    {
      title: '操作', width: 80,
      render: (_, r) => (
        <Button size="small" type="link" onClick={() => reprint(r)}>
          {r.status === 'failed' ? '重试' : '重打'}
        </Button>
      )
    }
  ]

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear placeholder="全部模板" style={{ width: 160 }} value={templateId}
          onChange={(v) => setTemplateId(v)}
          options={templates.map((t) => ({ value: t.id, label: t.name }))}
        />
        <RangePicker
          value={range as never}
          onChange={(v) => setRange((v as [Dayjs | null, Dayjs | null] | null) ?? null)}
        />
        <Input.Search
          placeholder="搜索参数内容，如：张三" allowClear style={{ width: 220 }}
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
        />
      </Space>
      <Table rowKey="id" size="small" columns={columns} dataSource={jobs} pagination={{ pageSize: 30 }} />
    </div>
  )
}
```

- [ ] **Step 2: 手工验收**

1. 打印两次（一次成功、一次取消），历史页显示两行，状态颜色正确，参数摘要正确。
2. 按模板过滤、时间范围过滤、关键字"张三"过滤均生效；缩略图可点击放大；失败行悬停显示错误原因。
3. 点"重打"进入打印页：模板为快照版本（即使原模板已修改）、参数已回填；直接打印产生一条新历史，且打印后不弹保存决策。
4. 把某模板删除后，其历史仍显示模板名且可重打（快照不依赖原模板；若快照含图片而资产已随模板删除，重打会收到"图片不存在"的明确报错）。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/pages/history.tsx
git commit -m "feat(ui): 打印历史表格/筛选/缩略图/快照重打"
```

---

## Task 20: 打印机设置页（枚举、设默认）

**Files:**

- Create/Modify: `src/renderer/pages/settings.tsx`
- 手工验收见 Step 2。

- [ ] **Step 1: 实现设置页（测试页按钮在 Task 21 接入）**

`src/renderer/pages/settings.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Button, Card, Space, Tag, message } from 'antd'
import { api } from '../api'
import type { PrinterInfoDto } from '../../../shared/ipc-contract'

export function SettingsPage(): JSX.Element {
  const [printers, setPrinters] = useState<PrinterInfoDto[]>([])
  const [appDefault, setAppDefault] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const [list, d] = await Promise.all([api.printers.list(), api.printers.getDefault()])
    setPrinters(list)
    setAppDefault(d)
  }
  useEffect(() => { void refresh() }, [])

  async function setDefault(name: string): Promise<void> {
    await api.printers.setDefault(name)
    setAppDefault(name)
    message.success(`已将“${name}”设为应用默认打印机`)
  }
  async function testPage(name: string): Promise<void> {
    await api.printers.testPage(name)
    message.success('测试页任务已发送')
  }

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <h3>打印机设置</h3>
      <Space direction="vertical" style={{ width: '100%' }}>
        {printers.map((p) => (
          <Card key={p.name} size="small">
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                <strong>{p.name}</strong>
                {p.isDefault && <Tag>系统默认</Tag>}
                {appDefault === p.name && <Tag color="blue">应用默认</Tag>}
              </Space>
              <Space>
                {appDefault !== p.name && <Button size="small" onClick={() => setDefault(p.name)}>设为应用默认</Button>}
                <Button size="small" onClick={() => testPage(p.name)}>打印测试页</Button>
              </Space>
            </Space>
          </Card>
        ))}
        {printers.length === 0 && <Card size="small">未检测到打印机，请先在 Windows 中安装打印机。</Card>}
      </Space>
      <p style={{ color: '#888', marginTop: 12 }}>
        应用默认打印机用于新建模板的默认输出目标；系统默认打印机由 Windows 设置决定。
      </p>
    </div>
  )
}
```

- [ ] **Step 2: 手工验收（测试页 Task 21 后生效，此时按钮会报"Task 21"）**

1. 列表与 Windows"设置 → 打印机"一致；系统默认打印机有标记。
2. 设某台为应用默认 → 重开应用仍保持（settings.json 持久化）。
3. 新建模板进入打印页时，打印机下拉默认选中应用默认打印机。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/pages/settings.tsx
git commit -m "feat(ui): 打印机设置页与应用默认打印机"
```

---

## Task 21: 测试页打印

**Files:**

- Modify: `electron/main/services/printer-service.ts`（需要 HistoryService 或直接复用 PrintService 提交一份合成模板）

- [ ] **Step 1: 用合成模板复用打印管线**

把 `printer-service.ts` 整体替换为以下最终版（构造函数直接注入 PrintService，无循环依赖：PrintService 不依赖 PrinterService）：

```ts
import { ipcMain, BrowserWindow } from 'electron'
import { IPC, type PrinterInfoDto, type SubmitPrintInput } from '../../../shared/ipc-contract'
import { loadSettings, saveSettings, type AppSettings } from '../settings'
import { createTemplate, createElement } from '../../../print-core/template-model'
import type { PrintService } from './print-service'
import type { Services } from '../ipc'

export class PrinterService {
  constructor(
    private dataDir: string,
    private print: PrintService
  ) {}

  async list(win: BrowserWindow): Promise<PrinterInfoDto[]> {
    const all = await win.webContents.getPrintersAsync()
    return all.map((p) => ({ name: p.name, isDefault: p.isDefault }))
  }
  getDefault(): string | null {
    return loadSettings(this.dataDir).defaultPrinterName
  }
  setDefault(name: string): void {
    saveSettings(this.dataDir, { defaultPrinterName: name } satisfies AppSettings)
  }
  testPage(name: string) {
    return this.print.submit(buildTestPageJob(name))
  }
}

function buildTestPageJob(printerName: string): SubmitPrintInput {
  // 100×100mm：外框距纸边 5mm，用于判断可打印区域偏差；黑/灰色块检验色彩
  const tpl = createTemplate('__test_page__', '测试页', { widthMm: 100, heightMm: 100 })
  tpl.content.elements.push(
    createElement('shape', { shape: 'rect', strokeColor: '#000000', strokeWidthMm: 0.3, fillColor: null },
      { x: 5, y: 5, w: 90, h: 90 }),
    createElement('text', { text: 'Template Print 测试页', bold: true, fontSizeMm: 5 },
      { x: 10, y: 10, w: 80, h: 8 }),
    createElement('text', { text: `Printer: ${printerName}`, fontSizeMm: 3.5 },
      { x: 10, y: 22, w: 80, h: 6 }),
    createElement('text', { text: 'Paper: 100 x 100 mm', fontSizeMm: 3.5 },
      { x: 10, y: 30, w: 80, h: 6 }),
    createElement('shape', { shape: 'rect', strokeColor: '#000000', strokeWidthMm: 0, fillColor: '#000000' },
      { x: 10, y: 45, w: 20, h: 10 }),
    createElement('shape', { shape: 'rect', strokeColor: '#000000', strokeWidthMm: 0, fillColor: '#cccccc' },
      { x: 40, y: 45, w: 20, h: 10 })
  )
  // 固定走系统对话框，便于在对话框里核对纸张
  return { template: tpl, paramValues: {}, printerName, copies: 1, mode: 'dialog' }
}

export function registerPrinterHandlers(deps: Services, win: BrowserWindow): void {
  const svc = deps.printers
  ipcMain.handle(IPC.printersList, () => svc.list(win))
  ipcMain.handle(IPC.printersGetDefault, () => svc.getDefault())
  ipcMain.handle(IPC.printersSetDefault, (_e, name: string) => svc.setDefault(name))
  ipcMain.handle(IPC.printersTestPage, (_e, name: string) => svc.testPage(name))
}
```

同步更新 `electron/main/index.ts` 的实例化（顺序：assets → templates → history → print → printers）：

```ts
const print = new PrintService(p.dataDir, assets, history)
const printers = new PrinterService(p.dataDir, print)
```

- [ ] **Step 2: 手工验收**

1. 设置页点"打印测试页"→ 弹系统对话框 → 打印输出：外框距纸边约 5mm、黑/灰两色块颜色正常、文字清晰。
2. 历史中出现一条"测试页"记录（状态、缩略图正常；templateId 为 null 不影响列表）。

- [ ] **Step 3: 提交**

```bash
git add electron/main/services/printer-service.ts electron/main/index.ts
git commit -m "feat: 100mm 标尺测试页"
```

---

## Task 22: electron-builder NSIS 打包与 M1 整体验收

**Files:**

- Create: `electron-builder.yml`（或写入 package.json 的 build 字段）
- Modify: `package.json`（files/extraResources 无需额外配置）

- [ ] **Step 1: 打包配置**

项目根创建 `electron-builder.yml`：

```yaml
appId: com.local.template-print
productName: TemplatePrint
directories:
  output: release
files:
  - out/**
  - package.json
asarUnpack:
  - node_modules/better-sqlite3/**
win:
  target:
    - target: nsis
      arch: [x64]
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
```

- [ ] **Step 2: 构建验证**

Run: `bun run build`
Expected: 生成 `out/main`、`out/preload`、`out/renderer`，无 TS/打包错误。

Run: `bun run dist`
Expected: `release/` 下出现 NSIS 安装包（.exe）。

- [ ] **Step 3: 安装包验收（全新 Windows 用户环境视角）**

1. 在本机运行安装包，选择非系统目录安装，桌面生成快捷方式。
2. 启动应用：数据目录自动创建于 `%APPDATA%/template-print/`（含 app.db、assets、thumbs、print-tmp、settings.json）。
3. 完整走一遍业务：新建 40×30mm 标签模板 → 加文本/参数/图形/图片 → 保存；使用模板填参 → 用 Microsoft Print to PDF 直打；历史查看缩略图并重打；设置页打印测试页。
4. 关闭重开应用：模板、历史、默认打印机设置全部保留。

- [ ] **Step 4: 全量自动化检查与提交**

Run: `bun run test`（全部用例通过）；`bun run typecheck`（无错误）。

```bash
git add electron-builder.yml package.json
git commit -m "build: NSIS 安装包配置与 M1 验收"
```

---

## 自查记录（计划对照规格）

**M1 规格覆盖：**

| 设计文档条目 | 任务 |
|---|---|
| §3 架构（IPC/preload/服务层/仓储隔离/资源目录） | 1、6、7、8、9、18 |
| §4 五张表与 JSON 模型 | 3、6 |
| §5.1 主流程（填参/校验/预览/打印/落历史） | 17、18 |
| §5.2 dirty 工作副本与保存决策 | 12、18(Step 4) |
| §5.3 设计新模板（纸张预设/自定义） | 11、12–16 |
| §5.5 历史与重打（快照/筛选/失败重试） | 6、18、19 |
| §6.1–6.5 五个界面 | 10–16、17、19、20 |
| §7.1 参数求值 | 4 |
| §7.2 打印 HTML 离屏渲染 | 5、18 |
| §7.3 毫米/微米/pt | 2 |
| §7.4 打印机枚举（状态检查属 M2，明确不在本计划） | 18(Step 1)、20 |
| §7.6 错误处理（缺图拦截/取消状态/失败记录） | 18 |
| §7.7 测试页 | 21 |
| §9 测试策略（print-core/repo 自动化 + 硬件人工清单） | 2–6、18(Step 6)、22 |
| §10 M1 分期条目（除条码/旋转/吸附/分类管理/导入导出/状态检查——均属 M2） | 全部任务 |

**M2 明确排除项**（本计划不实现，验收时不得当作缺陷）：条码/二维码元素、元素旋转、辅助线与网格吸附、图层拖拽排序（仅按钮置顶）、模板分类管理 UI（分类字段已存储，列表仅按已存在分类过滤）、`.tplx` 导入导出、PowerShell 打印机状态检查、图片 fit/opacity 属性编辑（模型已支持）。
