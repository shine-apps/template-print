# 模板打印程序 M2（完善能力）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1 闭环之上补齐：条码/二维码、元素旋转、网格与对齐吸附、图层拖拽排序、模板分类编辑、.tplx 导入导出、打印机状态检查与打印前拦截。

**Architecture:** 沿用 M1 分层。条码 SVG 在主进程纯 node 生成（bwip-js 出一维码、qrcode 出二维码，均无原生依赖），经"元素 id → SVG 字符串"映射注入渲染器（与 assetUrls 同构，渲染器保持同步纯函数）；吸附/旋转/图层/分类为渲染端 Konva 演进；.tplx 为 zip（adm-zip）；打印机状态经 PowerShell Get-Printer 子进程查询。

**Tech Stack:** 在 M1 栈上新增 bwip-js 4（一维条码 SVG）、qrcode（QR SVG，node toString 不需 DOM）、adm-zip + @types/adm-zip（zip）。运行时 Node 24 + npm，测试 `npm test`，tsc `npm run typecheck`；ABI 切换 `npm run bin:node` / `npm run bin:electron` 仍适用。

**继承的事实（实现时必须遵守）：**

- ParamDef 的 id=key；renderPrintDocument(doc, values, assetUrlsFlat)；几何单位 mm；模板 content.version=1。
- barcode 元素在 M1 的 zod 模型中**仅定义了 schema 常量但未加入 discriminatedUnion**，M2-T2 才启用；M1 画布把 barcode 之外的未知类型当图片占位，不会出现该元素。
- 提交信息里若本机身份已配置直接 git commit；不要 add node_modules/out/release/.native-bin。

---

## 文件结构（M2 新增/修改）

```
print-core/barcode.ts                 新增：条码/二维码 → SVG 字符串（纯 node）
print-core/template-model.ts          修改：ElementSchema union 加 BarcodeElementSchema
print-core/render-print-document.ts   修改：新增 barcodeSvgs 选项与 barcode 分支
shared/ipc-contract.ts                修改：barcode.render、templates.export/import、printers.status
electron/main/services/
  barcode-service.ts                  新增：批量为模板元素生成 SVG（缓存到 job 无关内存即可）
  template-service.ts                 修改：exportToFile / importFromFile
  asset-service.ts                    修改：importBuffer（从 zip 条目入库）
  printer-service.ts                  修改：getStatus / getStatusMap（PowerShell）
electron/main/ipc/index.ts            修改：注册新 handler
src/renderer/designer/
  canvas.tsx                          修改：条码预览、旋转回传、吸附辅助线、网格
  element-library.tsx                 修改：条码按钮
  layers-panel.tsx                    修改：拖拽排序
  property-panel.tsx                  修改：条码属性、旋转角度
  guides.ts                           新增：吸附候选线计算（纯函数，可单测）
src/renderer/pages/
  designer.tsx                        修改：分类编辑
  templates.tsx                       修改：导出/导入入口
  print.tsx                           修改：条码 SVG 预取、打印机状态检查
  settings.tsx                        修改：打印机状态点与刷新
tests/print-core/barcode.test.ts      新增
tests/renderer/guides.test.ts         新增
```

---

## Task 1: 条码/二维码 SVG 生成纯核心（TDD）

**Files:**

- Create: `print-core/barcode.ts`
- Test: `tests/print-core/barcode.test.ts`

- [ ] **Step 1: 安装依赖**

Run: `npm install bwip-js@^4.5.0 qrcode@^1.5.4 && npm install -D @types/qrcode@^1.5.5`
Expected: 安装成功（bwip-js、qrcode 均为纯 JS）。

- [ ] **Step 2: 写失败测试**

`tests/print-core/barcode.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { renderBarcodeSvg, type BarcodeSpec } from '../../print-core/barcode'

describe('renderBarcodeSvg', () => {
  it('CODE128 返回含 path 的 SVG，且尺寸为正', async () => {
    const spec: BarcodeSpec = { format: 'CODE128', expr: 'ABC-123', showText: true, widthMm: 40, heightMm: 15 }
    const svg = await renderBarcodeSvg(spec)
    expect(svg).toMatch(/^<svg[^>]*width="\d/)
    expect(svg).toContain('<path')
    expect(svg).toContain('ABC-123')
  })

  it('QR 返回正方形 svg（viewBox 方形、含矩阵 path/rect）', async () => {
    const spec: BarcodeSpec = { format: 'QR', expr: 'https://example.com', showText: false, widthMm: 25, heightMm: 25, eccLevel: 'M' }
    const svg = await renderBarcodeSvg(spec)
    const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(Number(m![2]))
  })

  it('EAN13 非法位数抛出可识别错误', async () => {
    const spec: BarcodeSpec = { format: 'EAN13', expr: '123', showText: true, widthMm: 40, heightMm: 15 }
    await expect(renderBarcodeSvg(spec)).rejects.toThrow(/EAN|13|digit/i)
  })

  it('空内容抛错', async () => {
    await expect(renderBarcodeSvg({ format: 'CODE128', expr: '  ', showText: false, widthMm: 10, heightMm: 10 }))
      .rejects.toThrow(/empty|内容/i)
  })
})
```

- [ ] **Step 3: 运行确认失败** → `npx vitest run tests/print-core/barcode.test.ts`，FAIL（模块不存在）。

- [ ] **Step 4: 实现**

`print-core/barcode.ts`：

```ts
import bwipjs from 'bwip-js'
import QRCode from 'qrcode'

export type BarcodeFormat = 'CODE128' | 'EAN13' | 'QR'
export type QrEcc = 'L' | 'M' | 'Q' | 'H'

export interface BarcodeSpec {
  format: BarcodeFormat
  /** 已求值的文本（{{paramId}} 替换由调用方在生成前完成） */
  expr: string
  showText: boolean
  widthMm: number
  heightMm: number
  eccLevel?: QrEcc
}

/** 1mm@96dpi 像素，条码用像素精确绘制再由打印 HTML 拉伸到 mm 框 */
const PX_PER_MM = 96 / 25.4

export async function renderBarcodeSvg(spec: BarcodeSpec): Promise<string> {
  const text = spec.expr.trim()
  if (!text) throw new Error('条码内容为空')
  const widthPx = Math.max(16, Math.round(spec.widthMm * PX_PER_MM))
  const heightPx = Math.max(16, Math.round(spec.heightMm * PX_PER_MM))

  if (spec.format === 'QR') {
    // qrcode 在 node 下 toString(svg) 不依赖 DOM；ecc 映射其 errorCorrectionLevel
    return QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: (spec.eccLevel ?? 'M') as 'L' | 'M' | 'Q' | 'H',
      margin: 1,
      width: Math.min(widthPx, heightPx)
    })
  }

  if (spec.format === 'EAN13' && !/^\d{13}$/.test(text)) {
    throw new Error('EAN13 必须为 13 位数字')
  }

  try {
    return bwipjs.toSVG({
      bcid: spec.format === 'EAN13' ? 'ean13' : 'code128',
      text,
      scale: 3,
      height: Math.max(8, heightPx - (spec.showText ? 12 : 0)),
      width: widthPx,
      includetext: spec.showText,
      textxalign: 'center',
      paddingwidth: 0,
      paddingheight: 0
    })
  } catch (e) {
    throw new Error(`条码生成失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 为模板中全部 barcode 元素批量生成 SVG（expr 已插值）。失败元素不阻塞，返回错误映射。 */
export async function renderBarcodesForDoc(
  specs: Array<{ elementId: string; spec: BarcodeSpec }>
): Promise<{ svgs: Record<string, string>; errors: Record<string, string> }> {
  const svgs: Record<string, string> = {}
  const errors: Record<string, string> = {}
  await Promise.all(
    specs.map(async ({ elementId, spec }) => {
      try {
        svgs[elementId] = await renderBarcodeSvg(spec)
      } catch (e) {
        errors[elementId] = e instanceof Error ? e.message : String(e)
      }
    })
  )
  return { svgs, errors }
}
```

- [ ] **Step 5: 运行通过并提交**

Run: `npx vitest run tests/print-core/barcode.test.ts` → 4/4 PASS。

```bash
git add print-core/barcode.ts tests/print-core/barcode.test.ts package.json package-lock.json
git commit -m "feat(core): bwip-js/qrcode 条码 SVG 生成"
```

---

## Task 2: 条码全链路接入（模型、渲染器、IPC、设计器 UI）

**Files:**

- Modify: `print-core/template-model.ts`, `print-core/render-print-document.ts`
- Create: `electron/main/services/barcode-service.ts`
- Modify: `shared/ipc-contract.ts`, `electron/main/ipc/index.ts`, `electron/main/index.ts`, `electron/preload/index.ts`
- Modify: `src/renderer/designer/{element-library,canvas,property-panel}.tsx`
- Test: 扩展 `tests/print-core/render-print-document.test.ts`

- [ ] **Step 1: 模型启用 barcode 元素**

在 `print-core/template-model.ts` 中把已有的 `BarcodeElementSchema` 加入 union：

```ts
export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ParamElementSchema,
  ImageElementSchema,
  BarcodeElementSchema,
  ShapeElementSchema
])
```

`BarcodeElementSchema` 已存在（props: expr/format/showText/eccLevel）；确认其字段与 `BarcodeSpec` 对齐，`format` 枚举 `['CODE128','EAN13','QR']`、`eccLevel` 默认 `'M'`。

- [ ] **Step 2: 渲染器注入 barcodeSvgs**

`render-print-document.ts`：

a. `RenderOptions` 增加可选映射（保持扁平风格，作为第三参对象的字段）：

```ts
export interface RenderOptions {
  [assetId: string]: string | Record<string, string> | undefined
  assetUrls?: Record<string, string>
  /** barcode 元素 id → 内联 SVG 字符串 */
  barcodeSvgs?: Record<string, string>
}
```

> 为避免索引签名与字段冲突，直接重写为明确接口（更干净，调用方同步修改）：

```ts
export interface RenderOptions {
  assetUrls?: Record<string, string>
  barcodeSvgs?: Record<string, string>
}
```

把函数签名改为 `renderPrintDocument(doc, values, options: RenderOptions = {})`，内部 `const assetUrls = options.assetUrls ?? {}`、`const barcodeSvgs = options.barcodeSvgs ?? {}`。**第三参由 M1 的扁平 assetUrls 改为选项对象，所有现有调用点必须同步修改（共 4 处）**：

- `electron/main/services/print-service.ts`：`renderPrintDocument(doc, values, { assetUrls: this.assetFileUrls(doc), barcodeSvgs })`（barcodeSvgs 在 Task 2 Step 3 接入）；
- `src/renderer/pages/print.tsx`：`renderPrintDocument(doc, evaluated, { assetUrls, barcodeSvgs })`（Task 2 Step 6）；
- `tests/print-core/render-print-document.test.ts`：3 处调用——`{ a1: 'file:///img/a1.png' }` 改为 `{ assetUrls: { a1: 'file:///img/a1.png' } }`，空值横线用例的第二参之后第三参 `{ a1: '' }` 改为 `{ assetUrls: { a1: '' } }`，特殊字符用例的 `{}` 保持不变；
- `tests/print-core/end-to-end-document.test.ts`：`{}` 保持不变。

b. `renderElement` 增加 barcode 分支（在 image 分支之后）：

```ts
    case 'barcode': {
      const p = el.props
      const svg = barcodeSvgs[el.id]
      if (!svg) {
        // 未生成（非法内容等）：打印为带错误文字的虚线框，绝不输出空白误导
        return `<div style="${style};border:0.3mm dashed #d4380a;color:#d4380a;font-size:3mm;` +
          `display:flex;align-items:center;justify-content:center;text-align:center">条码错误</div>`
      }
      return `<div style="${style};overflow:hidden">${svg}</div>`
    }
```

c. 条码 SVG 尺寸自适应：在注入前对 SVG 根节点补 width/height 100%。在 barcode 分支改为：

```ts
const sized = svg.replace(/<svg /, '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ')
return `<div style="${style};overflow:hidden">${sized}</div>`
```

d. 扩展测试 `tests/print-core/render-print-document.test.ts`，新增用例：

```ts
  it('barcode 元素内联注入 SVG；缺失时显示错误框', () => {
    const tpl = createTemplate('tb', '条码', { widthMm: 60, heightMm: 40 })
    tpl.content.elements.push(
      createElement('barcode', { expr: 'SKU001', format: 'CODE128', showText: true, eccLevel: 'M' },
        { x: 5, y: 5, w: 50, h: 15 })
    )
    const withSvg = renderPrintDocument(tpl, {}, { barcodeSvgs: { [tpl.content.elements[0].id]: '<svg><path d="x"/></svg>' } })
    expect(withSvg).toContain('width="100%" height="100%"')
    const noSvg = renderPrintDocument(tpl, {}, {})
    expect(noSvg).toContain('条码错误')
  })
```

Run: `npx vitest run tests/print-core` → 全绿。

- [ ] **Step 3: 主进程 BarcodeService + IPC**

`electron/main/services/barcode-service.ts`：

```ts
import { ipcMain } from 'electron'
import { IPC } from '../../../shared/ipc-contract'
import { renderBarcodesForDoc } from '../../../print-core/barcode'
import { interpolate } from '../../../print-core/param-evaluator'
import type { TemplateDocument, TemplateElement } from '../../../print-core/template-model'
import type { Services } from '../ipc'

type BarcodeElement = Extract<TemplateElement, { type: 'barcode' }>

export class BarcodeService {
  /** 返回 doc 中全部条码元素的 SVG 映射（expr 已用 values 插值） */
  async svgsForDoc(doc: TemplateDocument, values: Record<string, string>): Promise<Record<string, string>> {
    const specs = doc.content.elements
      .filter((el): el is BarcodeElement => el.type === 'barcode')
      .map((el) => ({
        elementId: el.id,
        spec: {
          format: el.props.format,
          expr: interpolate(el.props.expr, values),
          showText: el.props.showText,
          widthMm: el.w,
          heightMm: el.h,
          eccLevel: el.props.eccLevel
        }
      }))
    const { svgs } = await renderBarcodesForDoc(specs)
    return svgs
  }
}

export function registerBarcodeHandlers(deps: Services): void {
  ipcMain.removeHandler(IPC.barcodeRender)
  ipcMain.handle(IPC.barcodeRender, async (_e, doc: TemplateDocument, values: Record<string, string>) =>
    deps.barcodes.svgsForDoc(doc, values)
  )
}
```

`shared/ipc-contract.ts`：

```ts
// IPC 常量对象中新增
barcodeRender: 'barcode:render',
// Api 接口中新增
barcodes: {
  render(doc: TemplateDocument, values: Record<string, string>): Promise<Record<string, string>>
}
```

preload 增加 `barcodes: { render: (doc: unknown, values: unknown) => ipcRenderer.invoke(IPC.barcodeRender, doc, values) }`。

print-service.ts 注入 BarcodeService（构造函数新增第 4 参 `private barcodes: BarcodeService`），submit 中渲染 HTML 前：

```ts
const barcodeSvgs = await this.barcodes.svgsForDoc(doc, values)
const html = renderPrintDocument(doc, values, { assetUrls: this.assetFileUrls(doc), barcodeSvgs })
```

main/index.ts 装配：`const barcodes = new BarcodeService()`；PrintService 构造传入；registerIpc 调 registerBarcodeHandlers（Services 加 `barcodes: BarcodeService`）。

- [ ] **Step 4: 设计器元素库与属性面板**

element-library.tsx 增加按钮（与文本/图形同列）：

```tsx
<Button block onClick={() => add('barcode', { expr: '1234567890', format: 'CODE128', showText: true, eccLevel: 'M' })}>
  条码/二维码
</Button>
```

`add` 函数当前签名只接受 `'text' | 'shape'`，放开为元素类型联合（M1 图片按钮走自己的上传逻辑；条码走通用 add，默认框 50×15mm）：

```ts
function add(type: 'text' | 'shape' | 'barcode', props?: Record<string, unknown>): void {
  const el = createElement(
    type,
    props ?? (type === 'text' ? { text: '双击编辑文本' } : type === 'barcode'
      ? { expr: '1234567890', format: 'CODE128', showText: true, eccLevel: 'M' }
      : { shape: 'rect' }),
    { x: 20, y: 20, w: type === 'barcode' ? 50 : 60, h: type === 'shape' ? 30 : type === 'barcode' ? 15 : 8 }
  )
  addElement(el); commit()
}
```

property-panel.tsx 增加 barcode 分支：

```tsx
{el.type === 'barcode' && (
  <>
    <Input.TextArea rows={2} value={el.props.expr}
      placeholder="静态内容或 {{参数key}}"
      onChange={(e) => props({ expr: e.target.value })} />
    <Select size="small" style={{ width: 140 }} value={el.props.format}
      onChange={(v) => props({ format: v })}
      options={[{ value: 'CODE128', label: 'Code128' }, { value: 'EAN13', label: 'EAN-13' }, { value: 'QR', label: '二维码 QR' }]} />
    <Space><span>显示文字</span>
      <Switch size="small" disabled={el.props.format === 'QR'} checked={el.props.showText}
        onChange={(v) => props({ showText: v })} /></Space>
    {el.props.format === 'QR' && (
      <Select size="small" style={{ width: 120 }} value={el.props.eccLevel}
        onChange={(v) => props({ eccLevel: v })}
        options={['L', 'M', 'Q', 'H'].map((x) => ({ value: x, label: `容错 ${x}` }))} />
    )}
  </>
)}
```

- [ ] **Step 5: 画布条码占位渲染（不调 IPC，避免拖动中频繁请求）**

canvas.tsx 的末位 else 分支当前把非 text/param/shape 都画成图片虚线框。增加明确的 barcode 分支：

```tsx
  } else if (el.type === 'barcode') {
    body = (
      <Group ref={shapeRef as never} {...common}>
        <Rect listening={false} x={0} y={0} width={MM(el.w, scale)} height={MM(el.h, scale)}
          fill="#fff" stroke="#1677ff" dash={[6, 4]} />
        <KText listening={false} x={MM(el.w, scale) / 2} y={MM(el.h, scale) / 2 - MM(3, scale)}
          width={MM(el.w, scale)} align="center" text={el.props.format === 'QR' ? 'QR' : '▌▌█▌▐█'}
          fontSize={MM(4, scale)} fill="#1677ff" />
        <KText listening={false} x={MM(el.w, scale) / 2} y={MM(el.h, scale) / 2 + MM(2, scale)}
          width={MM(el.w, scale)} align="center" text={el.props.format} fontSize={MM(2.5, scale)} fill="#1677ff" />
      </Group>
    )
  } else {
    body = <Rect ref={shapeRef as never} {...common} fill="#e6f4ff" stroke="#1677ff" dash={[6, 4]} />
  }
```

条码与直线/椭圆一样是 Group 包装（只拖动改坐标，尺寸走属性面板），在 `isGroupWrapped` 中加入：

```ts
function isGroupWrapped(el: TemplateElement): boolean {
  return (el.type === 'shape' && el.props.shape !== 'rect') || el.type === 'barcode'
}
```

- [ ] **Step 6: 打印预览页预取条码 SVG**

print.tsx：在 assetUrls state 旁加 `barcodeSvgs` state；用 useEffect 随 doc/evaluated 变化（防抖 200ms）调用：

```tsx
const [barcodeSvgs, setBarcodeSvgs] = useState<Record<string, string>>({})
useEffect(() => {
  if (!doc) return
  let alive = true
  const t = setTimeout(() => {
    void window.api.barcodes.render(doc, values).then((m) => { if (alive) setBarcodeSvgs(m) }).catch(() => { if (alive) setBarcodeSvgs({}) })
  }, 200)
  return () => { alive = false; clearTimeout(t) }
}, [doc, values])
```

预览 useMemo 改为 `renderPrintDocument(doc, evaluated, { assetUrls, barcodeSvgs })`。

- [ ] **Step 7: 验证与提交**

Run: `npm test`（全部通过，含新增条码/渲染用例）；`npm run typecheck` 0 错误；`npx electron-vite build` 成功。

```bash
git add print-core electron shared src
git commit -m "feat: 条码/二维码全链路（模型/渲染/IPC/设计器/预览）"
```

---

## Task 3: 元素旋转

**Files:**

- Modify: `src/renderer/designer/canvas.tsx`, `src/renderer/designer/property-panel.tsx`

- [ ] **Step 1: 画布开启旋转手柄并回传角度**

canvas.tsx 中 Transformer 去掉 `rotateEnabled={false}`（改为默认 true）。`onTransformEnd` 中节点读取旋转：

```ts
    onTransformEnd: () => {
      const node = shapeRef.current
      if (!node) return
      const patch: Record<string, number> = {
        x: node.x() / mmToPxAt96(1) / scale,
        y: node.y() / mmToPxAt96(1) / scale
      }
      if (node.className !== 'Group') {
        patch.w = Math.max(1, node.width() * node.scaleX() / mmToPxAt96(1) / scale)
        patch.h = Math.max(1, node.height() * node.scaleY() / mmToPxAt96(1) / scale)
      }
      patch.rotation = Math.round(node.rotation() * 10) / 10
      onChange(patch as Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>)
      node.scaleX(1); node.scaleY(1); node.rotation(node.rotation()) // 保留角度（store 已存）
    }
```

`onChange` 类型放开为 `Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>`（ElementShape props 与 DesignerCanvas 中 updateGeometry 已支持 rotation）。

> 说明：Konva rotate 后 x/y 是未旋转包围盒左上角，CSS `transform: rotate()` 同样绕元素中心、left/top 为未旋转框，打印与设计坐标一致。

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

- [ ] **Step 3: 验证与提交**

`npm run typecheck` 0 错误、`npx electron-vite build` 成功。手工：添加矩形→拖旋转手柄→属性面板角度联动→输入 45°→元素旋转。打印 HTML 已在 M1 渲染器支持 rotation（快照测试已覆盖）。

```bash
git add src/renderer/designer
git commit -m "feat(designer): 元素旋转（手柄/角度属性）"
```

---

## Task 4: 网格与对齐吸附辅助线

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
    // a 的中心 x=70；拖动框中心 70 → x=55(w=30)
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
    sizeKey: 'w' | 'h',
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
    trySnap(vTargets, 'x', 'w', guidesV)
    trySnap(hTargets, 'y', 'h', guidesH)
  }

  if (grid.enabled) {
    const gx = Math.round(x / grid.sizeMm) * grid.sizeMm
    const gy = Math.round(y / grid.sizeMm) * grid.sizeMm
    x = gx; y = gy
  }

  return { x: round(x), y: round(y), guidesV, guidesH }
}
```

Run: `npx vitest run tests/renderer/guides.test.ts` → 5/5 PASS。

- [ ] **Step 2: 画布接入拖动吸附与辅助线层**

canvas.tsx：

a. 顶部工具条缩放旁加网格开关（localStorage 持久化）：

```tsx
const [gridOn, setGridOn] = useState(() => localStorage.getItem('tp-grid') === '1')
useEffect(() => { localStorage.setItem('tp-grid', gridOn ? '1' : '0') }, [gridOn])
const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
```

工具条 JSX：`<label style={{ marginLeft: 12 }}><input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} /> 网格(10mm)</label>`

b. 网格线 Layer（纸张 Rect 后、元素前），仅 gridOn 时渲染：

```tsx
{gridOn && Array.from({ length: Math.floor(doc.paper.widthMm / 10) - 1 }, (_, i) => (
  <Line key={`gv${i}`} listening={false}
    points={[MM((i + 1) * 10, scale), 0, MM((i + 1) * 10, scale), ph]}
    stroke="#d9d9d9" strokeWidth={1} />
)).concat(Array.from({ length: Math.floor(doc.paper.heightMm / 10) - 1 }, (_, i) => (
  <Line key={`gh${i}`} listening={false}
    points={[0, MM((i + 1) * 10, scale), pw, MM((i + 1) * 10, scale)]}
    stroke="#d9d9d9" strokeWidth={1} />
)))}
```

c. 辅助线层（元素后）：

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

d. 元素拖动改为实时吸附。把 common 中原有的 onDragEnd 删除，ElementShape 的 props 改为：

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

各节点（含 Group 包装）统一挂 `onDragMove={(e) => onDragMove(el, e.target)} onDragEnd={(e) => onDragEnd(el, e.target)}`。DesignerCanvas 的 map 下传这两个回调，处理函数：

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

Transform 缩放/旋转走 onTransformEnd→onChange，不做吸附（仅拖动吸附）。

- [ ] **Step 3: 验证与提交**

`npm test`（guides 5 例 + 既有无回归）；`npm run typecheck` 0 错误；build 成功。

```bash
git add src/renderer/designer tests/renderer
git commit -m "feat(designer): 10mm 网格与智能对齐吸附辅助线"
```

---

## Task 5: 图层拖拽排序 + 模板分类编辑

**Files:**

- Modify: `src/renderer/designer/layers-panel.tsx`, `src/renderer/store/designer-store.ts`, `src/renderer/pages/designer.tsx`

- [ ] **Step 1: store 增加 reorderLayer**

designer-store.ts：

```ts
reorderLayer: (id: string, beforeId: string | null) => void
```

接口与实现（加入 DesignerState）：

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

layers-panel.tsx 中图层行 div 增加：

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

图层列表容器（最底部空白区）加 onDrop（beforeId=null 置底）：

```tsx
onDragOver={(e) => e.preventDefault()}
onDrop={(e) => { const id = e.dataTransfer.getData('text/el-id'); if (id) { reorderLayer(id, null); commit() } }}
```

从 store 取 `reorderLayer`。列表按 zIndex 降序显示（M1 已如此），拖到某行=插到该行之前。

- [ ] **Step 3: 设计器顶部分类编辑**

designer.tsx 顶部工具条把禁用的模板名 Input 替换为可编辑的名称与分类：

```tsx
<Input variant="borderless" style={{ width: 140 }} value={doc.name}
  onChange={(e) => useDesignerStore.getState().mutate((d) => { d.name = e.target.value })} />
<Select style={{ width: 130 }} placeholder="分类" allowClear showSearch
  value={doc.category || undefined}
  onChange={(v) => useDesignerStore.getState().mutate((d) => { d.category = v ?? '' })}
  options={categoryOptions}
  dropdownRender={(menu) => (<>
    {menu}
    <div style={{ padding: 4, borderTop: '1px solid #eee' }}>
      <Input size="small" placeholder="输入新分类后回车" onPressEnter={(e) => {
        const v = (e.target as HTMLInputElement).value.trim()
        if (v && !categoryOptions.some((c) => c.value === v)) setCategoryOptions((o) => [...o, { value: v, label: v }])
        useDesignerStore.getState().mutate((d) => { d.category = v })
      }} />
    </div>
  </>)} />
```

categoryOptions 初始来自 `api.templates.list({})` 去重分类的 state（useEffect 加载）；mutate 改名/分类后保存按钮提交（save 走 zod parse + api.templates.save，已有）。

- [ ] **Step 4: 验证与提交**

`npm test`、`npm run typecheck`、build。手工：图层拖序后画布叠放变化、刷新仍保持；分类新建后列表页筛选可见。

```bash
git add src/renderer
git commit -m "feat(designer): 图层拖拽排序与模板分类编辑"
```

---

## Task 6: .tplx 模板导入导出（zip）

**Files:**

- Install: adm-zip, @types/adm-zip
- Modify: `electron/main/services/asset-service.ts`, `template-service.ts`, `shared/ipc-contract.ts`, preload, ipc, `src/renderer/pages/templates.tsx`
- Test: `tests/main/tplx-roundtrip.test.ts`

格式定义：`.tplx` 为 zip；根 `template.json`（完整 TemplateDocument）；图片在 `assets/<assetId><.ext>`；template.json 内的 image 元素只通过 assetId 关联。

- [ ] **Step 1: 安装**

Run: `npm install adm-zip@^0.5.16 && npm install -D @types/adm-zip@^0.5.13`

- [ ] **Step 2: AssetService 增加缓冲导入**

asset-service.ts：

```ts
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
  // 尺寸读缓冲：复用 readImageSize，改造其接受 Buffer（见 Step 3）
  const { widthPx, heightPx } = readImageSizeFromBuffer(input.buffer)
  this.repo.insert({
    id: input.assetId, templateId: input.templateId, filePath: relPath,
    originalName: input.originalName, mime, sizeBytes: input.buffer.length, widthPx, heightPx
  })
}
```

- [ ] **Step 3: readImageSize 支持 Buffer**

把现有 `readImageSize(path)` 内部改为 `readImageSizeFromBuffer(buf: Buffer)`（逻辑不变：PNG 偏移读宽高、JPEG 扫 marker、GIF/BMP 头），原函数保留为读文件后委托：

```ts
export function readImageSize(path: string) { return readImageSizeFromBuffer(readFileSync(path)) }
```

- [ ] **Step 4: TemplateService 导出/导入**

template-service.ts 增加（构造注入已含 assets repo 与 AssetService 实例——M1 构造为 `(repo, assets: AssetService)`，直接用 this.assets）：

```ts
import AdmZip from 'adm-zip'
import { writeFileSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

async exportToFile(id: string, targetPath: string): Promise<void> {
  const doc = this.repo.getById(id)
  if (!doc) throw new Error('模板不存在')
  const zip = new AdmZip()
  zip.addFile('template.json', Buffer.from(JSON.stringify(doc, null, 2), 'utf-8'))
  for (const a of this.assets.repo.listByTemplate(id)) {
    zip.addFile(`assets/${basename(a.filePath)}`, readFileSync(join(this.assets['dataDir' as never] ?? '', a.filePath)))
  }
  writeFileSync(targetPath, zip.toBuffer())
}
```

> AssetService 的 dataDir 是 private；在 AssetService 增加公开只读方法 `absPathOf(rel: string): string { return join(this.dataDir, rel) }`，导出时用 `this.assets.absPathOf(a.filePath)`，不要用下标访问。

```ts
async importFromFile(sourcePath: string): Promise<TemplateDocument> {
  const zip = new AdmZip(sourcePath)
  const entry = zip.getEntry('template.json')
  if (!entry) throw new Error('不是有效的 .tplx 文件（缺少 template.json）')
  const raw = JSON.parse(entry.getData().toString('utf-8'))
  const parsed = TemplateDocumentSchema.parse(raw) // version/结构校验

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

  // 资产：保留原 assetId（全局 nanoid，冲突可忽略），从 zip 解压入库
  const imageEls = newDoc.content.elements.filter(
    (e): e is Extract<TemplateElement, { type: 'image' }> => e.type === 'image'
  )
  for (const el of imageEls) {
    if (this.assets.repo.get(el.props.assetId)) continue // 极端情况下已存在则复用
    const fileEntry = zip.getEntries().find(
      (e) => e.entryName.startsWith('assets/') && e.entryName.includes(el.props.assetId)
    )
    if (!fileEntry) continue
    const ext = extname(fileEntry.entryName) || '.png'
    await this.assets.importBuffer({
      templateId: newDoc.id,
      assetId: el.props.assetId,
      buffer: fileEntry.getData(),
      ext,
      originalName: fileEntry.name
    })
  }
  return newDoc
}
```

- [ ] **Step 5: IPC 与对话框**

ipc-contract 增加：

```ts
templatesExport: 'templates:export',
templatesImport: 'templates:import',
// Api.templates：
export(id: string): Promise<{ canceled: boolean; path?: string }>
importTplx(): Promise<{ canceled: boolean; id?: string }>
```

主进程 handler（注册于 template-service.ts，dialog 在主进程；顶部 `import { dialog, ipcMain } from 'electron'`）：

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

preload 的 templates 对象加：
`export: (id: string) => ipcRenderer.invoke(IPC.templatesExport, id)`
`importTplx: () => ipcRenderer.invoke(IPC.templatesImport)`。

- [ ] **Step 6: 列表页入口与测试**

templates.tsx 顶部按钮区加：

```tsx
<Button onClick={async () => {
  const r = await api.templates.importTplx()
  if (!r.canceled) { message.success('模板已导入'); void refresh() }
}}>导入</Button>
```

卡片 ⋯ 菜单加 `{ key: 'export', label: '导出', onClick: () => api.templates.export(d.id) }`（M1 计划提过导入按钮，导出放卡片菜单）。

`tests/main/tplx-roundtrip.test.ts`：

```ts
// 用 tmp 目录建 AssetService/TemplateService：
// 1) create 模板 + 参数；写 1x1 PNG 到临时文件并 importImage
// 2) exportToFile 到 tmp/a.tplx
// 3) importFromFile → 新 id、名称含“导入”、参数齐全、图片资产可读且 toDataUrl 以 data:image/png 开头
```

1x1 PNG base64 复用 tests/main/asset-service.test.ts 中的常量。

- [ ] **Step 7: 验证与提交**

`npm test` 全绿；tsc 0 错误；build 成功。

```bash
git add electron shared src tests package.json package-lock.json
git commit -m "feat: .tplx 模板包导入导出（含图片资产）"
```

---

## Task 7: 打印机状态检查（PowerShell）与打印前拦截

**Files:**

- Modify: `electron/main/services/printer-service.ts`, `shared/ipc-contract.ts`, preload, `src/renderer/pages/settings.tsx`, `src/renderer/pages/print.tsx`

- [ ] **Step 1: PrinterService 状态查询**

printer-service.ts：

```ts
import { execFile } from 'node:child_process'

export type PrinterRuntimeStatus = 'ready' | 'offline' | 'paper-out' | 'error' | 'unknown'

interface PsPrinter {
  PrinterStatus?: string
  WorkflowStatus?: string
}

function queryPrinterStatus(name: string, timeoutMs = 3000): Promise<PrinterRuntimeStatus> {
  return new Promise((resolve) => {
    // 单引号转义防注入；经参数数组执行，不经 shell 拼接
    const safe = name.replace(/'/g, "''")
    const ps = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Get-Printer -Name '${safe}' | Select-Object PrinterStatus,WorkflowStatus | ConvertTo-Json -Compress`],
      { timeout: timeoutMs, windowsHide: true }
    )
    let out = ''
    ps.stdout?.on('data', (d) => { out += d })
    ps.on('error', () => resolve('unknown'))
    ps.on('close', () => {
      try {
        const json = out.trim()
        if (!json) return resolve('unknown')
        const arr: PsPrinter[] = JSON.parse(json)
        const s = (Array.isArray(arr) ? arr[0] : arr) ?? {}
        const raw = `${s.PrinterStatus ?? ''} ${s.WorkflowStatus ?? ''}`.toLowerCase()
        if (raw.includes('offline')) resolve('offline')
        else if (raw.includes('paper') || raw.includes('out of paper') || raw.includes('toner')) resolve('paper-out')
        else if (raw.includes('normal') || raw.includes('idle') || raw.includes('printing')) resolve('ready')
        else if (raw.trim() === '') resolve('unknown')
        else resolve('error')
      } catch { resolve('unknown') }
    })
  })
}
```

类内方法（带 60 秒内存缓存，避免频繁拉起 PowerShell）：

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

IPC：`printersStatus: 'printers:status'`。**状态类型唯一定义在 shared/ipc-contract.ts**（渲染端与主进程共用，禁止两处重复定义）：

```ts
export type PrinterRuntimeStatus = 'ready' | 'offline' | 'paper-out' | 'error' | 'unknown'
// Api.printers 增加：
status(names: string[]): Promise<Record<string, PrinterRuntimeStatus>>
```

printer-service.ts 中 `import type { PrinterRuntimeStatus } from '../../../shared/ipc-contract'`，删除本地同名联合定义；handler 经 `ipcMain.handle(IPC.printersStatus, (_e, names: string[]) => svc.getStatusMap(names))` 注册（先 removeHandler）。preload 加 `status: (names: string[]) => ipcRenderer.invoke(IPC.printersStatus, names)`。

- [ ] **Step 2: 设置页显示状态**

settings.tsx：加载列表后调用 `api.printers.status(names)`，每台打印机名前加状态点：

```tsx
const STATUS_META: Record<string, { color: string; text: string }> = {
  ready: { color: '#52c41a', text: '就绪' },
  offline: { color: '#8c8c8c', text: '离线' },
  'paper-out': { color: '#faad14', text: '缺纸/耗材' },
  error: { color: '#ff4d4f', text: '异常' },
  unknown: { color: '#bfbfbf', text: '状态未知' }
}
// 名称前：<span title={meta.text} style={{ display:'inline-block', width:8, height:8, borderRadius:8, background: meta.color, marginRight:6 }} />
// 顶部加“刷新状态”按钮清缓存重查（后端缓存期内同结果，提供 IPC 强制刷新参数 true 可选——M2 简化：按钮仅重新渲染+60s 后自动过期）
```

- [ ] **Step 3: 打印页打印前拦截**

print.tsx doPrint 中、submit 前：

```tsx
const st = (await api.printers.status([printerName]))[printerName]
if (st === 'offline' || st === 'error' || st === 'paper-out') {
  const label = ({ offline: '离线', error: '异常', 'paper-out: '缺纸/耗材' } as Record<string, string>)[st]
  const force = await new Promise<boolean>((resolve) => Modal.confirm({
    title: `打印机状态：${label}`,
    content: '打印机当前状态可能无法完成打印。仍要继续发送任务吗？',
    okText: '强制打印', cancelText: '返回',
    onOk: () => resolve(true), onCancel: () => resolve(false)
  }))
  if (!force) return
}
// unknown / ready 直接继续
```

- [ ] **Step 4: 验证与提交**

tsc 0 错误；build 成功；`npm test` 无回归。手工：设置页状态点（Microsoft Print to PDF 一般为 ready/unknown 都应正常不阻塞）；断网/不存在打印机已由打印失败路径覆盖（本任务对不存在打印机名查询返回 unknown，不与失败冲突）。

```bash
git add electron shared src
git commit -m "feat: PowerShell 打印机状态检查与打印前可强制拦截"
```

---

## Task 8: M2 全量回归与端到端走查

- [ ] **Step 1: 自动化回归**

`npm run bin:node` → `npm test`（全部通过）→ `npm run typecheck`（0 错误）→ `npm run bin:electron` → `npx electron-vite build`。

- [ ] **Step 2: CDP 走查（沿用 M1 方式，主代理执行）**

覆盖：建模板加 CODE128 与 QR 元素（打印 HTML 内含两段 svg）、旋转 30° 后快照含 rotate、网格开关持久化、图层拖拽改 zIndex、导出 .tplx 后重新导入得到"导入"模板且图片可显示、打印机状态 IPC 返回映射。

- [ ] **Step 3: 提交走查脚本外的必要修复（如有）并收尾**

切回 `npm run bin:node`；更新设计文档/计划状态与项目记忆；M2 完成。

---

## 自查记录

| 设计文档 M2 条目 | 任务 |
|---|---|
| 条码/二维码 | 1、2 |
| 元素旋转 | 3 |
| 辅助线与网格吸附 | 4 |
| 图层拖拽排序 | 5（锁定/置顶 M1 已有） |
| 模板分类与列表搜索 | 5（搜索 M1 已有） |
| .tplx 导入导出 | 6 |
| PowerShell 状态检查与打印前拦截 | 7 |
| 回归走查 | 8 |

**排除项（仍属 M3/不做）**：流水号、下拉/图片参数、自定义纸张驱动引导、失败重试 UI（历史"重试"按钮 M1 已支持）、多用户。
