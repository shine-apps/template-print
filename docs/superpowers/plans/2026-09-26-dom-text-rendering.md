# 方案 C：画布文本 DOM 化，实现设计器=打印预览像素级一致

日期：2026-09-26
分支：`feat/dom-text-rendering`（从 main @ 59d8d13 切出）

## 1. 背景与问题

设计器画布与打印预览/实际打印使用两套文本排版引擎：

| 链路 | 引擎 |
|---|---|
| 设计器画布 | `layoutText()` 手工算坐标 + Canvas 2D 逐字 `fillText`（`LaidText` Konva.Shape） |
| 打印预览 iframe / 实际打印 | `renderPrintDocument()` 生成 HTML，Chromium 原生 CSS 行盒模型 |
| 列表缩略图 | React DOM + CSS（已与打印同源） |

两套引擎导致三类不可消除的差异：
1. **半行距**：CSS `line-height>1` 时差值对半拆为每行上下 half-leading；Canvas `textBaseline:'top'` 没有。已用补偿常量 `(pitch-fs)/2` 临时对齐（方案 A），但属于经验逼近。
2. **字体度量**：Canvas top 基线与 CSS em-box 顶部存在 ~1px 级差，随字体/字号变化。
3. **换行与字距**：手工逐字 `measureText` 累加丢失 kerning，分词/断行算法与浏览器不同，长文本行数可能不同，整段垂直居中位置随之不同。

## 2. 目标

设计器画布的文本元素改为 **DOM 元素渲染**，与打印端共用同一份样式构造（单一真源）。
设计器、预览 iframe、实际打印都运行在同一个 Electron Chromium 中（同版本同字体），DOM 排版结果天然一致。

完成后全产品文本只剩一种渲染模型（CSS），`layoutText` 手工排版引擎删除。

### 非目标

- 不改缩略图组件（已是 CSS）。
- 不改图片/形状元素的 Konva 渲染方式。
- 不做富文本、字间距等新功能。

## 3. 架构设计

### 3.1 总体结构

```
Stage（react-konva，content div 由 Konva 创建）
 └─ div.konvajs-content（position:absolute；z-index auto，不形成 stacking context）
     ├─ canvas: 图形段 Layer 0（图片/形状，z-index=0）
     ├─ div: 文本覆盖层（React createPortal 注入，position:absolute，z-index=1）
     ├─ canvas: 图形段 Layer 1（z-index=2）
     ├─ div: 文本覆盖层（z-index=3）
     ├─ ...
     └─ canvas: 文本热区 Layer（z-index=9999）
```

要点：

1. **Portal 注入**：Stage mount 后取 `stageRef.current.content`（Konva 的 content div），用 `createPortal` 把文本 div 渲染进去。文本 div 与各 Layer 的 canvas 是同级节点，通过 `z-index` 与 canvas 交错，正确支持「图片压文字 / 文字压图片」的层级顺序。
2. **分段 Layer**：按 `sorted`（zIndex 升序）遍历元素，连续的非文本元素归入同一个 Konva `<Layer>`；遇到文本元素则结束当前图形段，输出一个文本覆盖层 div。段数通常很少（典型模板：图形在下、文字在上，共 2 段）。
3. **文本热区 Layer**：独立的最顶 Konva Layer，每个文本元素一个透明 `Rect`（`fill='transparent'` 有 hit area），负责：
   - 点击选中、双击编辑、拖拽、Transformer 缩放/旋转；
   - 空白区域 Konva 自动穿透到下层图形段 canvas，不影响图片/形状交互；
   - 选中文本时 Transformer 挂在该 Rect 上。
4. **DOM 文本不接收指针事件**（`pointer-events:none`），所有交互由热区 Rect 承担，避免双重命中。

### 3.2 坐标系

- content div 内为 Stage 像素坐标。现有 Layer 用 `offsetX/offsetY=-40` 把纸张原点放到 (40,40)；DOM 节点不受 Layer offset 影响，文本 div 定位为 `left: 40 + mmToPx(x)*scale`、`top: 40 + mmToPx(y)*scale`，宽高同为缩放后像素。
- 缩放滑块变化时整个 Stage 尺寸与元素坐标重算（现有模式），DOM 同步重渲染。

### 3.3 拖拽/变换时 DOM 跟随

热区 Rect 拖拽或 Transformer 变换过程中不能每帧 React setState（文本多时卡顿）。维护 `elId → HTMLDivElement` 的 ref Map：

- `onDragMove`：直接写文本 div 的 `style.left/top`（同步 Konva node 的 x/y）；
- `onTransform`：直接写 `style.width/height/transform: rotate()`；图片等比锁定逻辑不变（仅图片热区在图形段，文本热区不锁比例）；
- `onDragEnd/onTransformEnd`：commit 几何到 store，React 重渲染与命令式位置收敛一致；重置 node scale。

### 3.4 文本样式单一真源

新增 `print-core/text-style.ts`（纯 TS，不依赖 React，类型用 `Record<string, string>`）：

- `SYSTEM_FONT_STACK`（从 text-layout.ts 迁入）
- `textCssString(props)`：返回打印 HTML 用的 style 字符串（横排/竖排两分支，逻辑等价于现 `renderTextHtml` 的内联样式）
- `textCssProps(props)`：返回 `{ outer: Record<string,string>, inner?: Record<string,string> }`，DOM 文本组件直接展开到 style

两处实现共享同一份声明表，打印端只做对象→字符串序列化。样式内容与现状保持完全一致：

- 横排：`display:flex; align-items:safe center; height:100%; font-*; color; line-height; text-align; white-space:pre-wrap; word-break:break-word; overflow:hidden` + 下划线
- 竖排：外层 `flex row-reverse justify-content` + 内层 `writing-mode:vertical-rl; text-orientation:mixed`
- 字体 mm 单位、`fontCss` 单引号规则不变

### 3.5 文本内容

- 画布显示 `el.props.text` 原文（含 `{{参数名}}` 原样可见，与当前 LaidText 行为一致）。
- 打印端仍由 `textSegments()` 做参数替换/转义，不变。

### 3.6 删除项

- `src/renderer/designer/laid-text.tsx`（Konva.Shape 自绘文本）
- `print-core/text-layout.ts`（`layoutText`/`Measurer`/`isUprightChar`/Laid* 类型；SYSTEM_FONT_STACK 迁出）
- `tests/print-core/text-layout.test.ts`
- 画布中的 `createPxMeasurer`
- `template-thumbnail.tsx` 等对 SYSTEM_FONT_STACK 的 import 改指 text-style.ts
- FontService 保留（属性面板字体枚举仍用 `fonts:list`），仅不再用于画布测量

## 4. 任务分解

1. **抽离样式真源**：新建 `print-core/text-style.ts`，迁移 SYSTEM_FONT_STACK 与横/竖排样式（字符串版 + 对象版）；`render-print-document.ts` 改为调用它；更新 import（thumbnail）。单测覆盖关键字声明。
2. **画布分段架构**：canvas.tsx 中 Stage 加 ref，mount 后拿 content 节点；按 zIndex 把非文本元素分段渲染到多个 `<Layer>`（每段 canvas 的 `style.zIndex` 显式设为 `seg*2`）。
3. **DOM 文本覆盖层**：`createPortal` 注入 content；每段文本一个 absolute div（z-index=`seg*2+1`，left/top=40+缩放坐标，pointer-events:none），样式用 textCssProps；竖排走内外两层结构。
4. **文本热区 Layer**：最顶 Layer（z-index 9999），每文本一个透明 Rect；接线选中/双击 prompt 编辑/拖拽/Transformer；onDragMove/onTransform 经 ref Map 命令式同步文本 div 的 left/top/width/height/rotate；onEnd commit。
5. **删除旧链路**：删 laid-text.tsx、text-layout.ts 及其测试、createPxMeasurer；修正全部 import；方案 A 的 halfLeading 补偿随 text-layout 一并移除（DOM 原生行盒不再需要）。
6. **验证**：tsc 0 错、vitest 全绿、electron-vite build 通过。
7. **CDP 真机走查**（独立临时用户目录）：
   - 一致性：同模板的设计器文本 bbox 与打印预览 iframe 内文本 bbox 坐标一致（DOM 测量对比）；
   - 样式：横/竖排、三种对齐、加粗斜体下划线、字号行高、长文本换行行数、`{{参数}}` 原文显示；
   - 交互：点选、拖拽（DOM 实时跟随）、Transformer 缩放（文本回流）、旋转、双击编辑、Delete；
   - 层级：图片在文字下层/上层两种 z 序都正确遮挡；
   - 缩放滑块/滚动、网格缓存层不受影响；
   - console 0 错误。
8. **提交**：分支内按任务粒度提交。

## 5. 风险与回退

| 风险 | 应对 |
|---|---|
| Portal 进 stage.content 后 canvas/div z-index 交错不生效（Konva content 意外形成 stacking context） | 任务 2 先做最小验证；若失败，回退为「全部文本单层覆盖于图形之上」（绝大多数模板文字本就在最上层），z 序交错列为后续限制 |
| 拖拽时命令式同步与 React 重渲染抖动 | onEnd 统一收敛；以 store 值为最终真来源，命令式写入仅视觉跟随 |
| mm 字号在 DOM 与打印 iframe 中渲染差异 | 两处同 Chromium、同 96dpi 换算，理论一致；走查实测 bbox |
| 文本元素数量大时 DOM 性能 | 模板文本元素通常 <100；无逐帧 setState，可接受 |

回退：整支分支独立，不合入 main 即不影响 0.3.0 发布。
