# 模板打印程序 M2（完善能力）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1 闭环之上补齐：元素旋转、网格与对齐吸附、图层拖拽排序、模板分类编辑、.tplx 导入导出、打印机状态检查与打印前拦截。

**Architecture:** 沿用 M1 分层。吸附为渲染端 Konva 演进（候选线计算抽为纯函数可单测）；旋转直接复用模型已有的 rotation 字段（M1 打印 HTML 已支持）；.tplx 为 zip（adm-zip）；打印机状态经 PowerShell Get-Printer 子进程查询。

**Tech Stack:** 在 M1 栈上新增 adm-zip + @types/adm-zip（zip）。运行时 Node 24 + npm，测试 `npm test`，tsc `npm run typecheck`；ABI 切换 `npm run bin:node` / `npm run bin:electron` 仍适用。

**范围决策（2026-09-23 用户确认）：M2 不做条码/二维码生成模块。** 条码/二维码需求由"直接上传包含条码或二维码的图片文件"满足（M1 图片元素已完整支持上传/缩放/打印）。因此：

- 模板模型不引入 barcode 元素类型（M1 实际代码中本就不存在该 schema）；
- 不安装 bwip-js/qrcode，不新增 print-core/barcode.ts、BarcodeService、barcode IPC、设计器条码按钮与属性；
- print-core 中 `interpolate` 工具函数保留（通用 `{{key}}` 替换，未来其他场景可用），但注释不再提条码。

**继承的事实（实现时必须遵守）：**

- ParamDef 的 id=key；`renderPrintDocument(doc, values, assetUrlsFlat)` 第三参为扁平 assetId→url 映射；几何单位 mm；模板 content.version=1。
- 提交信息里若本机身份已配置直接 git commit；不要 add node_modules/out/release/.native-bin。

---

## 文件结构（M2 新增/修改）

```
src/renderer/designer/
  canvas.tsx                          修改：旋转回传、吸附辅助线、网格
  layers-panel.tsx                    修改：拖拽排序
  property-panel.tsx                  修改：旋转角度
  element-library.tsx                 无功能改动（无条码按钮）
  guides.ts                           新增：吸附候选线计算（纯函数，可单测）
src/renderer/store/designer-store.ts  修改：reorderLayer
src/renderer/pages/
  designer.tsx                        修改：分类/名称内联编辑
  templates.tsx                       修改：导出/导入入口
  print.tsx                           修改：打印机状态检查
  settings.tsx                        修改：打印机状态点与刷新
electron/main/services/
  asset-service.ts                    修改：importBuffer（从 zip 条目入库）+ readImageSize 支持 Buffer
  template-service.ts                 修改：exportToFile / importFromFile
  printer-service.ts                  修改：getStatus / getStatusMap（PowerShell）
shared/ipc-contract.ts                修改：templates.export/import、printers.status
electron/main/ipc/index.ts            修改：注册新 handler
electron/preload/index.ts             修改：白名单新增方法
print-core/param-evaluator.ts         修改：仅更新 interpolate 注释（去掉条码表述）
tests/renderer/guides.test.ts         新增
tests/main/tplx-roundtrip.test.ts     新增
```

---

## Task 1: 元素旋转

**Files:**

- Modify: `src/renderer/designer/canvas.tsx`, `src/renderer/designer/property-panel.tsx`

说明：模型的几何字段 `rotation`、打印 HTML 的 `transform:rotate()` 在 M1 已就绪，本任务仅打通设计器交互。

- [ ] **Step 1: 画布开启旋转手柄并回传角度**

canvas.tsx 中 Transformer 去掉 `rotateEnabled={false}`（改为默认 true）。ElementShape 的 onChange 类型放开为：

```ts
onChange: (patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>) => void
```

`onTransformEnd` 改为读取旋转（保留 Group 元素只回传坐标的分支）：

```ts
onTransformEnd: () => {
  const node = shapeRef.current
  if (!node) return
  const patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>> = {
    x: node.x() / mmToPxAt96(1) / scale,
    y: node.y() / mmToPxAt96(1) / scale
  }
  if (node.className !== 'Group') {
    patch.w = Math.max(1, node.width() * node.scaleX() / mmToPxAt96(1) / scale)
    patch.h = Math.max(1, node.height() * node.scaleY() / mmToPxAt96(1) / scale)
  }
  patch.rotation = Math.round(node.rotation() * 10) / 10
  onChange(patch)
  node.scaleX(1); node.scaleY(1)
}
```

> 坐标一致性：Konva rotate 后 x/y 是未旋转包围盒左上角，CSS `transform: rotate()` 同样绕元素中心、left/top 为未旋转框，设计与打印坐标一致。
> 注意：本任务先只改 Transformer 与 onTransformEnd；onChange 类型在 Task 2 吸附改造时会进一步扩展，本任务按上面的联合类型即可。DesignerCanvas map 处的 `(patch) => updateGeometry(el.id, patch)` 无需改（store 的 updateGeometry 已接受 rotation）。

- [ ] **Step 2: 属性面板加旋转角度**

property-panel.tsx 几何区 Space 内追加：

```tsx
旋转 <InputNumber size="small" style={{ width: 80 }} min={-180} max={180} step={15}
  value={Number(el.rotation.toFixed(1))} addonAfter="°"
  onChange={(v) => geo({ rotation: v ?? 0 })} />
```

geo 函数的 patch 类型加入 rotation：

```ts
function geo(patch: Partial<{ x: number; y: number; w: number; h: number; locked: boolean; rotation: number }>): void
```

- [ ] **Step 3: 顺手清理 param-evaluator 注释**

`print-core/param-evaluator.ts` 第 81 行注释改为：

```ts
/** 替换表达式中的 {{key}}（通用工具，保留供未来场景使用） */
```

- [ ] **Step 4: 验证与提交**

`npm run typecheck`（0 错误）；`npx electron-vite build`（成功）；`npm test`（无回归）。手工：添加矩形→拖旋转手柄→属性面板角度联动→输入 45°→元素旋转。

```bash
git add src/renderer/designer print-core/param-evaluator.ts
git commit -m "feat(designer): 元素旋转（手柄/角度属性）"
```

---

## Task 2: 网格与对齐吸附辅助线

**Files:**

- Create: `src/renderer/designer/guides.ts`
- Test: `tests/renderer/guides.test.ts`
- Modify: `src/renderer/designer/canvas.tsx`

- [ ] **Step 1: 纯函数吸附计算（TDD）**

`tests/renderer/guides.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { snapPosition, type GuideRect } from '../../src/renderer/designer/guides'

const paper: GuideRect = { id: '__paper__', x: 0, y: 0, w: 200, h: 280 }
const others: GuideRect[] = [
  { id: 'a', x: 50, y: 50, w: 40, h: 10 },
  { id: 'b', x: 10, y: 100, w: 80, h: 20 }
]

describe('snapPosition', () => {
  it('左边对齐其他元素左边（阈值内）', () => {
    const r = snapPosition({ x: 48.5, y: 80, w: 30, h: 8 }, paper, others, 3)
    expect(r.x).toBe(50)
    expect(r.guidesV.some((g) => g === 50)).toBe(true)
  })
  it('中心垂直对齐', () => {
    // a 的中心 x=70；拖动框中心 70 → x=54(w=32)
    const r = snapPosition({ x: 54, y: 200, w: 32, h: 8 }, paper, others, 3)
    expect(Math.abs((r.x + 16) - 70)).toBeLessThanOrEqual(3)
  })
  it('顶边对齐纸张顶边 0', () => {
    const r = snapPosition({ x: 30, y: 1.2, w: 20, h: 8 }, paper, others, 3)
    expect(r.y).toBe(0)
  })
  it('超阈值不吸附', () => {
    const r = snapPosition({ x: 40, y: 80, w: 30, h: 8 }, paper, others, 3)
    expect(r.x).toBe(40)
    expect(r.guidesV.length + r.guidesH.length).toBe(0)
  })
  it('网格吸附：开启时落到 10 的倍数', () => {
    const r = snapPosition({ x: 33, y: 47, w: 8, h: 8 }, paper, [], 0, { enabled: true, sizeMm: 10 })
    expect(r.x % 10).toBe(0)
    expect(r.y % 10).toBe(0)
  })
})
```

`src/renderer/designer/guides.ts`：

```ts
export interface GuideRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface SnapResult {
  x: number
  y: number
  /** 竖向辅助线的 x 坐标（mm） */
  guidesV: number[]
  /** 横向辅助线的 y 坐标（mm） */
  guidesH: number[]
}

interface GridOpt {
  enabled: boolean
  sizeMm: number
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * 计算拖动后位置的吸附结果。
 * 候选线：拖动框（左/中/右、上/中/下）与纸张、其他元素对应线对齐。
 * @param thresholdMm 吸附阈值（mm）；网格吸附不受阈值限制
 */
export function snapPosition(
  moving: GuideRect,
  paper: GuideRect,
  others: GuideRect[],
  thresholdMm: number,
  grid: GridOpt = { enabled: false, sizeMm: 10 }
): SnapResult {
  let { x, y } = moving
  const guidesV: number[] = []
  const guidesH: number[] = []

  const vTargets = [
    { m: (r: GuideRect) => r.x, line: (r: GuideRect) => r.x },
    { m: (r: GuideRect) => r.x + r.w / 2, line: (r: GuideRect) => r.x + r.w / 2 },
    { m: (r: GuideRect) => r.x + r.w, line: (r: GuideRect) => r.x + r.w }
  ]
  const hTargets = [
    { m: (r: GuideRect) => r.y, line: (r: GuideRect) => r.y },
    { m: (r: GuideRect) => r.y + r.h / 2, line: (r: GuideRect) => r.y + r.h / 2 },
    { m: (r: GuideRect) => r.y + r.h, line: (r: GuideRect) => r.y + r.h }
  ]

  const candidates = [paper, ...others]

  const trySnap = (
    targets: typeof vTargets,
    posKey: 'x' | 'y',
    guides: number[]
  ): void => {
    for (const t of targets) {
      const movingMark = t.m(moving)
      let best: { delta: number; line: number } | null = null
      for (const c of candidates) {
        const line = t.line(c)
        const delta = line - movingMark
        if (Math.abs(delta) <= thresholdMm && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, line }
        }
      }
      if (best) {
        if (posKey === 'x') x = round(moving.x + best.delta)
        else y = round(moving.y + best.delta)
        if (!guides.includes(best.line)) guides.push(round(best.line))
        return // 每个轴取一条最强对齐即可
      }
    }
  }

  if (thresholdMm > 0) {
    trySnap(vTargets, 'x', guidesV)
    trySnap(hTargets, 'y', guidesH)
  }

  if (grid.enabled) {
    x = Math.round(x / grid.sizeMm) * grid.sizeMm
    y = Math.round(y / grid.sizeMm) * grid.sizeMm
  }

  return { x: round(x), y: round(y), guidesV, guidesH }
}
```

Run: `npx vitest run tests/renderer/guides.test.ts` → 5/5 PASS（先红后绿）。

- [ ] **Step 2: 画布接入网格开关、网格线与辅助线层**

canvas.tsx 顶部状态：

```tsx
const [gridOn, setGridOn] = useState(() => localStorage.getItem('tp-grid') === '1')
useEffect(() => { localStorage.setItem('tp-grid', gridOn ? '1' : '0') }, [gridOn])
const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
```

工具条 JSX（缩放控件旁）：

```tsx
<label style={{ marginLeft: 12 }}>
  <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} /> 网格(10mm)
</label>
```

网格线 Layer（纸张 Rect 后、元素前）：

```tsx
{gridOn && Array.from({ length: Math.max(0, Math.floor(doc.paper.widthMm / 10) - 1) }, (_, i) => (
  <Line key={`gv${i}`} listening={false}
    points={[MM((i + 1) * 10, scale), 0, MM((i + 1) * 10, scale), ph]}
    stroke="#d9d9d9" strokeWidth={1} />
)).concat(Array.from({ length: Math.max(0, Math.floor(doc.paper.heightMm / 10) - 1) }, (_, i) => (
  <Line key={`gh${i}`} listening={false}
    points={[0, MM((i + 1) * 10, scale), pw, MM((i + 1) * 10, scale)]}
    stroke="#d9d9d9" strokeWidth={1} />
)))}
```

辅助线层（元素后）：

```tsx
{guides.v.map((gx) => (
  <Line key={`av${gx}`} listening={false}
    points={[MM(gx, scale), 0, MM(gx, scale), ph]} stroke="#ff4d4f" strokeWidth={1} />
))}
{guides.h.map((gy) => (
  <Line key={`ah${gy}`} listening={false}
    points={[0, MM(gy, scale), pw, MM(gy, scale)]} stroke="#ff4d4f" strokeWidth={1} />
))}
```

- [ ] **Step 3: 拖动实时吸附**

把 common 中原有的 onDragEnd 删除。ElementShape 的 props 最终形态（Task 1 的 rotation 类型保留）：

```tsx
function ElementShape({ el, scale, selected, onSelect, onChange, assetUrls, onDragMove, onDragEnd }: {
  el: TemplateElement
  scale: number
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>) => void
  assetUrls: Record<string, string>
  onDragMove: (el: TemplateElement, node: Konva.Node) => void
  onDragEnd: (el: TemplateElement, node: Konva.Node) => void
}): JSX.Element
```

各节点（含 Group 包装）统一挂 `onDragMove={(e) => onDragMove(el, e.target)} onDragEnd={(e) => onDragEnd(el, e.target)}`。DesignerCanvas 的 map 下传：

```tsx
<ElementShape key={el.id} el={el} scale={scale} selected={el.id === selectedId}
  onSelect={() => select(el.id)}
  onChange={(patch) => updateGeometry(el.id, patch)}
  assetUrls={assetUrls}
  onDragMove={handleDragMove}
  onDragEnd={handleDragEnd} />
```

处理函数（在 DesignerCanvas 内，引用当前 doc/scale/gridOn）：

```tsx
function handleDragMove(el: TemplateElement, node: Konva.Node): void {
  const moving = {
    id: el.id,
    x: node.x() / mmToPxAt96(1) / scale,
    y: node.y() / mmToPxAt96(1) / scale,
    w: el.w, h: el.h
  }
  const paper = { id: '__paper__', x: 0, y: 0, w: doc.paper.widthMm, h: doc.paper.heightMm }
  const other = doc.content.elements
    .filter((e) => e.id !== el.id)
    .map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h }))
  const r = snapPosition(moving, paper, other, 3, gridOn ? { enabled: true, sizeMm: 10 } : { enabled: false, sizeMm: 10 })
  if (Math.abs(r.x - moving.x) > 0.001) node.x(MM(r.x, scale))
  if (Math.abs(r.y - moving.y) > 0.001) node.y(MM(r.y, scale))
  setGuides({ v: r.guidesV, h: r.guidesH })
}
function handleDragEnd(el: TemplateElement, node: Konva.Node): void {
  updateGeometry(el.id, {
    x: node.x() / mmToPxAt96(1) / scale,
    y: node.y() / mmToPxAt96(1) / scale
  })
  setGuides({ v: [], h: [] })
}
```

文件顶部 `import { snapPosition } from './guides'`。Transform 缩放/旋转走 onTransformEnd→onChange，不做吸附（仅拖动吸附）。

- [ ] **Step 4: 验证与提交**

`npm test`（guides 5 例 + 既有无回归）；`npm run typecheck` 0 错误；build 成功。

```bash
git add src/renderer/designer tests/renderer
git commit -m "feat(designer): 10mm 网格与智能对齐吸附辅助线"
```

---

## Task 3: 图层拖拽排序 + 模板分类/名称编辑

**Files:**

- Modify: `src/renderer/designer/layers-panel.tsx`, `src/renderer/store/designer-store.ts`, `src/renderer/pages/designer.tsx`

- [ ] **Step 1: store 增加 reorderLayer**

designer-store.ts 的 DesignerState 接口加入：

```ts
reorderLayer: (id: string, beforeId: string | null) => void
```

实现（与其他 action 同层）：

```ts
reorderLayer: (id, beforeId) => {
  get().mutate((d) => {
    const sorted = [...d.content.elements].sort((a, b) => a.zIndex - b.zIndex)
    const from = sorted.findIndex((e) => e.id === id)
    if (from < 0) return
    const [item] = sorted.splice(from, 1)
    const to = beforeId === null ? sorted.length : sorted.findIndex((e) => e.id === beforeId)
    sorted.splice(to < 0 ? sorted.length : to, 0, item)
    sorted.forEach((e, i) => { e.zIndex = i })
  })
},
```

- [ ] **Step 2: 图层面板原生拖拽**

layers-panel.tsx 从 store 取 `reorderLayer`。图层行 div 增加：

```tsx
draggable
onDragStart={(e) => { e.dataTransfer.setData('text/el-id', el.id); e.dataTransfer.effectAllowed = 'move' }}
onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
onDrop={(e) => {
  e.preventDefault(); e.stopPropagation()
  const id = e.dataTransfer.getData('text/el-id')
  if (id && id !== el.id) { reorderLayer(id, el.id); commit() }
}}
```

图层列表容器（底部空白区）加拖到底：

```tsx
onDragOver={(e) => e.preventDefault()}
onDrop={(e) => { const id = e.dataTransfer.getData('text/el-id'); if (id) { reorderLayer(id, null); commit() } }}
```

列表按 zIndex 降序显示（M1 已如此），拖到某行=插到该行之前。

- [ ] **Step 3: 设计器顶部名称与分类编辑**

designer.tsx：顶部工具条把禁用的模板名 Input 替换为可编辑名称与分类。新增 state 加载已有分类：

```tsx
const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([])
useEffect(() => {
  void api.templates.list({}).then((ts) => {
    setCategoryOptions([...new Set(ts.map((t) => t.category).filter(Boolean))].map((c) => ({ value: c, label: c })))
  })
}, [])
```

工具条 JSX（替换原禁用 Input 与纸张尺寸展示那一组，保留纸张尺寸文本）：

```tsx
<Input variant="borderless" style={{ width: 140 }} value={doc.name}
  onChange={(e) => useDesignerStore.getState().mutate((d) => { d.name = e.target.value })} />
<span style={{ color: '#888' }}>{doc.paper.widthMm}×{doc.paper.heightMm}mm</span>
<Select style={{ width: 130 }} placeholder="分类" allowClear showSearch
  value={doc.category || undefined}
  onChange={(v) => useDesignerStore.getState().mutate((d) => { d.category = v ?? '' })}
  options={categoryOptions}
  dropdownRender={(menu) => (<>
    {menu}
    <div style={{ padding: 4, borderTop: '1px solid #eee' }}>
      <Input size="small" placeholder="输入新分类后回车"
        onPressEnter={(e) => {
          const v = (e.target as HTMLInputElement).value.trim()
          if (v && !categoryOptions.some((c) => c.value === v)) {
            setCategoryOptions((o) => [...o, { value: v, label: v }])
          }
          useDesignerStore.getState().mutate((d) => { d.category = v })
        }} />
    </div>
  </>)} />
```

名称/分类修改后经既有"保存模板"按钮提交（save 已做 zod parse + api.templates.save + try/catch 提示）。

- [ ] **Step 4: 验证与提交**

`npm test`、`npm run typecheck`、build。手工：图层拖序后画布叠放变化、保存重开仍保持；分类新建后列表页筛选可见；改名保存后列表显示新名。

```bash
git add src/renderer
git commit -m "feat(designer): 图层拖拽排序与模板名称/分类编辑"
```

---

## Task 4: .tplx 模板导入导出（zip）

**Files:**

- Install: adm-zip, @types/adm-zip
- Modify: `electron/main/services/asset-service.ts`, `template-service.ts`, `shared/ipc-contract.ts`, `electron/preload/index.ts`, `electron/main/ipc/index.ts`（handler 注册于 template-service.ts 内）, `src/renderer/pages/templates.tsx`
- Test: `tests/main/tplx-roundtrip.test.ts`

格式定义：`.tplx` 为 zip；根 `template.json`（完整 TemplateDocument）；图片在 `assets/<文件名含assetId><.ext>`；image 元素通过 assetId 关联。

- [ ] **Step 1: 安装**

Run: `npm install adm-zip@^0.5.16 && npm install -D @types/adm-zip@^0.5.13`

- [ ] **Step 2: readImageSize 支持 Buffer + AssetService.importBuffer**

asset-service.ts：把现有 `readImageSize(path)` 重构为缓冲版本（PNG/JPEG/GIF/BMP 头解析逻辑不变，入参改 Buffer），原函数委托：

```ts
export function readImageSizeFromBuffer(buf: Buffer): { widthPx: number; heightPx: number } {
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
  const ascii6 = buf.subarray(0, 6).toString('ascii')
  if (ascii6 === 'GIF87a' || ascii6 === 'GIF89a') {
    return { widthPx: buf.readUInt16LE(6), heightPx: buf.readUInt16LE(8) }
  }
  if (ascii6.slice(0, 2) === 'BM') {
    return { widthPx: buf.readInt32LE(18), heightPx: Math.abs(buf.readInt32LE(22)) }
  }
  throw new Error('不支持的图片格式（仅 png/jpg/gif/bmp）')
}
export function readImageSize(path: string): { widthPx: number; heightPx: number } {
  return readImageSizeFromBuffer(readFileSync(path))
}
```

AssetService 增加两个方法：

```ts
absPathOf(rel: string): string {
  return join(this.dataDir, rel)
}

async importBuffer(input: {
  templateId: string
  assetId: string
  buffer: Buffer
  ext: string
  originalName: string
}): Promise<void> {
  const mime = MIME[input.ext] ?? 'application/octet-stream'
  const relPath = join('assets', input.templateId, `${input.assetId}${input.ext}`)
  mkdirSync(join(this.dataDir, 'assets', input.templateId), { recursive: true })
  writeFileSync(join(this.dataDir, relPath), input.buffer)
  const { widthPx, heightPx } = readImageSizeFromBuffer(input.buffer)
  this.repo.insert({
    id: input.assetId, templateId: input.templateId, filePath: relPath,
    originalName: input.originalName, mime, sizeBytes: input.buffer.length, widthPx, heightPx
  })
}
```

- [ ] **Step 3: TemplateService 导出/导入**

template-service.ts 顶部补充导入：

```ts
import AdmZip from 'adm-zip'
import { writeFileSync, readFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { TemplateElement } from '../../../print-core/template-model'
```

类内增加两个方法：

```ts
async exportToFile(id: string, targetPath: string): Promise<void> {
  const doc = this.repo.getById(id)
  if (!doc) throw new Error('模板不存在')
  const zip = new AdmZip()
  zip.addFile('template.json', Buffer.from(JSON.stringify(doc, null, 2), 'utf-8'))
  for (const a of this.assets.repo.listByTemplate(id)) {
    zip.addFile(`assets/${basename(a.filePath)}`, readFileSync(this.assets.absPathOf(a.filePath)))
  }
  writeFileSync(targetPath, zip.toBuffer())
}

async importFromFile(sourcePath: string): Promise<TemplateDocument> {
  const zip = new AdmZip(sourcePath)
  const entry = zip.getEntry('template.json')
  if (!entry) throw new Error('不是有效的 .tplx 文件（缺少 template.json）')
  const parsed = TemplateDocumentSchema.parse(JSON.parse(entry.getData().toString('utf-8')))

  const now = Date.now()
  const newDoc: TemplateDocument = TemplateDocumentSchema.parse({
    ...structuredClone(parsed),
    id: localId('tpl'),
    name: `${parsed.name} 导入`,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now
  })
  this.repo.upsert(newDoc)

  const imageEls = newDoc.content.elements.filter(
    (e): e is Extract<TemplateElement, { type: 'image' }> => e.type === 'image'
  )
  for (const el of imageEls) {
    if (this.assets.repo.get(el.props.assetId)) continue
    const fileEntry = zip.getEntries().find(
      (e) => e.entryName.startsWith('assets/') && e.entryName.includes(el.props.assetId)
    )
    if (!fileEntry) continue
    await this.assets.importBuffer({
      templateId: newDoc.id,
      assetId: el.props.assetId,
      buffer: fileEntry.getData(),
      ext: extname(fileEntry.entryName) || '.png',
      originalName: fileEntry.name
    })
  }
  return newDoc
}
```

- [ ] **Step 4: IPC 契约、对话框 handler、preload**

shared/ipc-contract.ts 的 IPC 常量增加：

```ts
templatesExport: 'templates:export',
templatesImport: 'templates:import',
```

Api.templates 增加：

```ts
export(id: string): Promise<{ canceled: boolean; path?: string }>
importTplx(): Promise<{ canceled: boolean; id?: string }>
```

template-service.ts 的 registerTemplateHandlers 内（顶部 `import { dialog, ipcMain } from 'electron'`）：

```ts
ipcMain.removeHandler(IPC.templatesExport)
ipcMain.handle(IPC.templatesExport, async (_e, id: string) => {
  const doc = svc.get(id)
  if (!doc) throw new Error('模板不存在')
  const r = await dialog.showSaveDialog({
    title: '导出模板',
    defaultPath: `${doc.name}.tplx`,
    filters: [{ name: '模板包', extensions: ['tplx'] }]
  })
  if (r.canceled || !r.filePath) return { canceled: true }
  await svc.exportToFile(id, r.filePath)
  return { canceled: false, path: r.filePath }
})

ipcMain.removeHandler(IPC.templatesImport)
ipcMain.handle(IPC.templatesImport, async () => {
  const r = await dialog.showOpenDialog({
    title: '导入模板',
    filters: [{ name: '模板包', extensions: ['tplx'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return { canceled: true }
  const created = await svc.importFromFile(r.filePaths[0])
  return { canceled: false, id: created.id }
})
```

electron/preload/index.ts 的 templates 对象加：

```ts
export: (id: string) => ipcRenderer.invoke(IPC.templatesExport, id),
importTplx: () => ipcRenderer.invoke(IPC.templatesImport)
```

- [ ] **Step 5: 列表页入口**

templates.tsx 顶部按钮区（"新建模板"旁）加：

```tsx
<Button onClick={async () => {
  const r = await api.templates.importTplx()
  if (!r.canceled) { message.success('模板已导入'); void refresh() }
}}>导入</Button>
```

卡片 ⋯ 菜单加一项（在"复制"之前或之后均可）：

```tsx
{ key: 'export', label: '导出', onClick: () => api.templates.export(d.id) }
```

- [ ] **Step 6: 往返测试（TDD）**

`tests/main/tplx-roundtrip.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb, type DbClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { AssetRepository } from '../../db/repositories/asset-repo'
import { TemplateService } from '../../electron/main/services/template-service'
import { AssetService } from '../../electron/main/services/asset-service'
import { createElement } from '../../print-core/template-model'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

let dataDir: string
let client: DbClient
let svc: TemplateService

beforeEach(() => {
  dataDir = join(tmpdir(), `tp-tplx-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  client = createDb(join(tmpdir(), `tp-tplx-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`))
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

describe('.tplx 往返', () => {
  it('导出再导入：新 id/名称含导入/参数齐全/图片可读', async () => {
    const tpl = await svc.create({ name: '价签', widthMm: 40, heightMm: 30, category: '标签' })
    tpl.content.elements.push(createElement('text', { text: 'X' }, { x: 1, y: 1, w: 10, h: 5 }))
    await svc.save(tpl)

    const srcImg = join(dataDir, 'a.png')
    writeFileSync(srcImg, PNG_1X1)
    const { assetId } = await (svc as unknown as { assets: AssetService }).assets
      .importImage({ templateId: tpl.id, sourcePath: srcImg })
    const withImg = await svc.get(tpl.id)
    withImg!.content.elements.push(
      createElement('image', { assetId, fit: 'contain', opacity: 1 }, { x: 1, y: 10, w: 10, h: 10 })
    )
    await svc.save(withImg!)

    const tplxPath = join(dataDir, 'out.tplx')
    await svc.exportToFile(tpl.id, tplxPath)

    const imported = await svc.importFromFile(tplxPath)
    expect(imported.id).not.toBe(tpl.id)
    expect(imported.name).toBe('价签 导入')
    expect(imported.params).toHaveLength(tpl.params.length)
    const imgEl = imported.content.elements.find((e) => e.type === 'image')!
    expect(imgEl).toBeTruthy()
    const dataUrl = await (svc as unknown as { assets: AssetService }).assets.toDataUrl(imgEl.props.assetId)
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })
})
```

- [ ] **Step 7: 验证与提交**

`npm test` 全绿；`npm run typecheck` 0 错误；build 成功。

```bash
git add electron shared src tests package.json package-lock.json
git commit -m "feat: .tplx 模板包导入导出（含图片资产）"
```

---

## Task 5: 打印机状态检查（PowerShell）与打印前拦截

**Files:**

- Modify: `shared/ipc-contract.ts`, `electron/preload/index.ts`, `electron/main/services/printer-service.ts`, `src/renderer/pages/settings.tsx`, `src/renderer/pages/print.tsx`

- [ ] **Step 1: 状态类型与 IPC 契约**

shared/ipc-contract.ts 增加（渲染端与主进程共用，唯一定义处）：

```ts
export type PrinterRuntimeStatus = 'ready' | 'offline' | 'paper-out' | 'error' | 'unknown'
```

IPC 常量加 `printersStatus: 'printers:status'`；Api.printers 加：

```ts
status(names: string[]): Promise<Record<string, PrinterRuntimeStatus>>
```

preload 的 printers 对象加：

```ts
status: (names: string[]) => ipcRenderer.invoke(IPC.printersStatus, names)
```

- [ ] **Step 2: PrinterService 状态查询（60s 内存缓存）**

printer-service.ts 增加：

```ts
import { execFile } from 'node:child_process'
import { ipcMain } from 'electron'
import type { PrinterRuntimeStatus } from '../../../shared/ipc-contract'

type RawPrinter = { PrinterStatus?: string; WorkflowStatus?: string }

function queryPrinterStatus(name: string, timeoutMs = 3000): Promise<PrinterRuntimeStatus> {
  return new Promise((resolve) => {
    // 单引号转义防注入；参数数组执行，不经 shell 拼接
    const safe = name.replace(/'/g, "''")
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Get-Printer -Name '${safe}' | Select-Object PrinterStatus,WorkflowStatus | ConvertTo-Json -Compress`],
      { timeout: timeoutMs, windowsHide: true }
    )
    let out = ''
    child.stdout?.on('data', (d: string) => { out += d })
    child.on('error', () => resolve('unknown'))
    child.on('close', () => {
      try {
        const json = out.trim()
        if (!json) return resolve('unknown')
        const parsed: RawPrinter | RawPrinter[] = JSON.parse(json)
        const s = Array.isArray(parsed) ? parsed[0] : parsed
        const raw = `${s?.PrinterStatus ?? ''} ${s?.WorkflowStatus ?? ''}`.toLowerCase()
        if (raw.includes('offline')) resolve('offline')
        else if (raw.includes('paper') || raw.includes('toner')) resolve('paper-out')
        else if (raw.includes('normal') || raw.includes('idle') || raw.includes('printing')) resolve('ready')
        else if (raw.trim() === '') resolve('unknown')
        else resolve('error')
      } catch {
        resolve('unknown')
      }
    })
  })
}
```

PrinterService 类内增加缓存与方法（构造签名不变）：

```ts
private statusCache = new Map<string, { at: number; s: PrinterRuntimeStatus }>()

async getStatus(name: string): Promise<PrinterRuntimeStatus> {
  const hit = this.statusCache.get(name)
  if (hit && Date.now() - hit.at < 60_000) return hit.s
  const s = await queryPrinterStatus(name)
  this.statusCache.set(name, { at: Date.now(), s })
  return s
}
async getStatusMap(names: string[]): Promise<Record<string, PrinterRuntimeStatus>> {
  const out: Record<string, PrinterRuntimeStatus> = {}
  await Promise.all(names.map(async (n) => { out[n] = await this.getStatus(n) }))
  return out
}
```

registerPrinterHandlers 注册（先 removeHandler）：

```ts
ipcMain.removeHandler(IPC.printersStatus)
ipcMain.handle(IPC.printersStatus, (_e, names: string[]) => svc.getStatusMap(names))
```

- [ ] **Step 3: 设置页显示状态点与刷新**

settings.tsx 增加状态加载：

```tsx
import type { PrinterRuntimeStatus } from '../../../shared/ipc-contract'

const STATUS_META: Record<PrinterRuntimeStatus, { color: string; text: string }> = {
  ready: { color: '#52c41a', text: '就绪' },
  offline: { color: '#8c8c8c', text: '离线' },
  'paper-out': { color: '#faad14', text: '缺纸/耗材' },
  error: { color: '#ff4d4f', text: '异常' },
  unknown: { color: '#bfbfbf', text: '状态未知' }
}
```

state 与加载函数：

```tsx
const [statusMap, setStatusMap] = useState<Record<string, PrinterRuntimeStatus>>({})
const [statusLoading, setStatusLoading] = useState(false)
async function loadStatus(list: PrinterInfoDto[]): Promise<void> {
  setStatusLoading(true)
  try { setStatusMap(await api.printers.status(list.map((p) => p.name))) }
  finally { setStatusLoading(false) }
}
// refresh() 中拿到 list 后调用 loadStatus(list)
```

每台打印机卡片名前加状态点：

```tsx
{(() => {
  const st = statusMap[p.name] ?? 'unknown'
  const m = STATUS_META[st]
  return <span title={m.text} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: m.color, marginRight: 6 }} />
})()}
```

顶部加刷新按钮（重新查询；60 秒缓存内结果可能相同，属预期）：

```tsx
<Button size="small" loading={statusLoading}
  onClick={() => loadStatus(printers)}>刷新状态</Button>
```

- [ ] **Step 4: 打印页打印前拦截**

print.tsx 的 doPrint 中，submit 前增加状态检查：

```tsx
const statusMap = await api.printers.status([printerName])
const st = statusMap[printerName]
if (st === 'offline' || st === 'error' || st === 'paper-out') {
  const labelMap: Record<string, string> = { offline: '离线', error: '异常', 'paper-out': '缺纸/耗材' }
  const force = await new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: `打印机状态：${labelMap[st]}`,
      content: '打印机当前状态可能无法完成打印。仍要继续发送任务吗？',
      okText: '强制打印',
      cancelText: '返回',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
  if (!force) return
}
// ready / unknown 直接继续提交
```

- [ ] **Step 5: 验证与提交**

`npm test` 无回归；`npm run typecheck` 0 错误；build 成功。手工：设置页 Microsoft Print to PDF 显示就绪/未知（均不应阻塞打印）；PowerShell 无 Get-Printer 的环境（如 Home 版策略）应优雅回落 unknown，不报错、不阻塞。

```bash
git add shared electron src
git commit -m "feat: PowerShell 打印机状态检查与打印前可强制拦截"
```

---

## Task 6: M2 全量回归与端到端走查

- [ ] **Step 1: 自动化回归**

`npm run bin:node` → `npm test`（全部通过）→ `npm run typecheck`（0 错误）→ `npm run bin:electron` → `npx electron-vite build`。

- [ ] **Step 2: CDP 走查（主代理执行，沿用 M1 方式）**

覆盖：

1. 元素旋转 30° 后打印 HTML 快照含 `transform:rotate(30deg)`；
2. 网格开关持久化（localStorage tp-grid）；拖动元素出现红色吸附辅助线并贴齐；
3. 图层拖拽改变 zIndex，保存重开保持；模板改名/改分类后列表页可见可筛选；
4. 导出 .tplx → 删除原模板 → 导入得到"xxx 导入"模板，图片资产完整可预览；
5. `api.printers.status([...])` 返回每台打印机的五态之一；
6. 全应用无 console 异常。

- [ ] **Step 3: 收尾**

切回 `npm run bin:node`；更新设计文档 M2 完成状态与项目记忆。

---

## 自查记录

| 设计文档 M2 条目（更新后） | 任务 |
|---|---|
| 元素旋转 | 1 |
| 辅助线与网格吸附 | 2 |
| 图层拖拽排序、锁定/置顶（锁定置顶 M1 已有） | 3 |
| 模板名称/分类编辑与列表搜索（搜索 M1 已有） | 3 |
| .tplx 导入导出 | 4 |
| PowerShell 状态检查与打印前拦截 | 5 |
| 回归走查 | 6 |
| ~~条码/二维码生成~~ | **已移除（2026-09-23 决策）：用图片上传满足** |

**排除项（M3/不做）**：流水号、下拉/图片参数、自定义纸张驱动引导、条码/二维码生成、多用户。
