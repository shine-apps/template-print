# 文本框扩展设计（横排/竖排、字体设置、系统字体加载）

日期：2026-09-24　状态：待评审
关联：[2026-09-23-template-print-design.md](./2026-09-23-template-print-design.md)（总体设计）、[2026-09-24-template-params-in-text](../plans/2026-09-24-template-params-in-text.md)（参数占位符 v2，已完成）

## 1. 需求与范围

### 1.1 要做的

1. 文本元素可选择类型：**横排文本框** / **竖排文本框**。
2. 文本框级统一字体设置：字体类型、字号、粗体、斜体、下划线（一个文本框内所有文字一套格式，不做框内混排）。
3. 自动加载系统已安装字体供选择；未设置字体时使用"系统默认"字体栈。
4. 横排/竖排在设计器画布、打印预览、实际打印（含导出 HTML 管线）中方向与排版一致。
5. 不影响设计器既有能力（旋转、吸附、图层、图片/图形、参数 token、保存/打印/历史等），UI 风格与操作逻辑保持一致。

### 1.2 不做（YAGNI）

- 框内富文本混排（选中部分文字单独设置样式）——本次字体设置粒度为文本框级。
- 文本框边框/背景色属性——可用"矩形图形 + 文本框"组合实现，不新增字段。
- 打包字体文件/自定义字体上传——只枚举系统已安装字体。
- 竖排中英数字的"正立/旋转"用户开关——固定采用 Word 标准竖排（mixed，英数旋转），后续如需再加。

## 2. 数据模型（content v3）

不新增元素类型，仍为 `type: 'text'`，在 props 上扩展。旧数据由 zod 默认值自动升级（v2→v3 无数据搬迁代码）；v1 数据在已上线的 v2 迁移中处理。

```ts
type TextDirection = 'horizontal' | 'vertical'

interface TextProps {
  text: string                 // 可含 {{参数名称}}（v2 机制不变）
  fontFamily: string           // '' = 系统默认；否则为字体家族名，如 'Microsoft YaHei'
  fontSizeMm: number           // 正数字号
  bold: boolean
  italic: boolean
  underline: boolean           // 新增，默认 false
  align: 'left' | 'center' | 'right'
  color: string
  lineHeight: number           // 倍数
  direction: TextDirection     // 新增，默认 'horizontal'
}
```

- `CONTENT_VERSION = 3`。TemplateDocumentSchema.version 改为 literal(3)，TextElementSchema.props 增加 `underline`、`direction` 两个带默认值字段。
- **版本归一（无业务数据搬迁，但有版本号代码）**：z.literal(3) 会使库内存量 v2 文档 parse 失败，因此 `print-core/migrate.ts` 的 migrateDocument 升级为**统一入口**：v1 输入走既有 param 元素转换逻辑，v1/v2 输入最终都输出 version=3（v2→v3 仅版本号变化，新字段由 zod 默认值补全）；v3 原样返回。三个读取点统一过该函数：`template-repo.hydrate`（替代当前硬编码 version:2）、`job-repo.hydrate`（历史快照 v2→v3，下划线 false/横排不改变历史外观）、tplx 导入。print_jobs 历史快照同样安全升级。
- `fontFamily: ''` 是一等值，表示系统默认。现有模板保存的具体字体名保持不变；新建文本框默认 `''`。
- 系统默认字体栈常量（画布与打印共用，导出 `SYSTEM_FONT_STACK`）：
  `system-ui, "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif`
- 竖排语义：汉字/全角标点正立、从上到下成列、列从右向左排列；半角英数顺时针旋转 90°；超框高换列。等价 CSS `writing-mode: vertical-rl; text-orientation: mixed`。
- `{{参数名称}}` 在排版前完成求值替换（沿用 v2 纯函数管线），与排版方向正交。

## 3. 系统字体枚举（FontService）

新增主进程服务 `electron/main/services/font-service.ts`。

### 3.1 数据来源

- PowerShell（execFile，与 PrinterService 同模式：参数数组、不经 shell、3 秒超时、异常优雅回落）：
  `Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'` 与 `HKCU` 同名键；
  属性名形如 `Microsoft YaHei (TrueType)` / `宋体 & 新宋体 (TrueType)`，剥离 ` (TrueType)` 等后缀得家族名；`&` 分隔的复合名取第一段为主名并同时保留全名。
- 内置兜底家族（注册表读取失败时保证可用）：微软雅黑、宋体、黑体、楷体、仿宋、Arial、Times New Roman、Calibri、Courier New、Segoe UI。
- 不解析字体二进制（不引入 fontkit）。

### 3.2 契约

IPC 常量 `fontsList: 'fonts:list'`；preload 暴露 `api.fonts.list()`，进程内只读缓存一次：

```ts
interface FontListDto {
  all: string[]          // 去重排序的全部家族名
  common: string[]       // 常用家族中实际存在于 all 的项
  defaultFont: ''        // 固定空串，代表系统默认
}
```

常用清单常量 `COMMON_FONTS`：微软雅黑、宋体、黑体、楷体、仿宋、Arial、Times New Roman、Calibri、Courier New、Segoe UI。

注册表行→家族名的解析抽为纯函数 `parseFontRegistryEntries(rows): string[]`，独立单测；PowerShell 调用不做自动化测试。

## 4. 排版核心（print-core/text-layout.ts）

无 DOM/Electron 依赖的纯模块，驱动设计器自绘；打印侧用同构 CSS（§5），两端规则用测试锁定。

```ts
interface TextStyle {
  fontFamily: string; fontSizeMm: number
  bold: boolean; italic: boolean; underline: boolean
  lineHeight: number; direction: 'horizontal' | 'vertical'
}
interface Measurer {
  measureChar(ch: string, fontSizeMm: number, style: TextStyle): { w: number; h: number }
}
interface LaidChar { ch: string; x: number; y: number; rotated: boolean }
interface LaidLine { chars: LaidChar[]; widthMm: number; heightMm: number; underline: Array<{ x: number; y: number; w: number; h: number }> }
interface LayoutResult { lines: LaidLine[]; widthMm: number; heightMm: number }

function layoutText(text: string, boxW: number, boxH: number, style: TextStyle, m: Measurer): LayoutResult
```

### 4.1 横排规则

- `\n` 强制换行；连续空白保留（pre-wrap 语义）。
- CJK 字符可任意间断行；连续 ASCII（字母/数字）尽量整词不拆，单词超框宽强制断字。
- 行高 = 字号 × lineHeight；行内按 align 分配起点 x（left=0 / center / right 贴右）。
- 下划线：为每行生成水平线段坐标（基线位置），供绘制与测试断言。

### 4.2 竖排规则

- 一列从上到下，纵向容量 = 框高；满列后向左新开列（首列贴框右）；`\n` 强制换列。
- 汉字/全角标点正立，字格约字号见方；ASCII 字符在字位中心 rotate(90°) 绘制，占位宽高互换，LaidChar.rotated=true。
- 列间距与 CSS 行高等价：列宽 = 字号，列间距 = 字号 × (lineHeight − 1)。
- align 映射（列组在框宽内的水平分布）：`left → 列组贴右`、`right → 贴左`、`center → 水平居中`；列内文字统一从框顶起排（不引入第四种对齐）。该映射在测试中固定。
  注意 CSS 中 `text-align` 在 vertical-rl 下只控制 inline 轴（垂直方向），**不能**用它做列组水平对齐；打印侧实现见 §5 的 flex row-reverse 方案。
- 下划线：竖直线段坐标（每字右侧）。

### 4.3 Measurer 实现与字体加载

- 设计器 Measurer：离屏 canvas 2D，`ctx.font = '${italic?"italic":""} ${bold?"bold":""} ${px}px ${family||默认栈}'`，measureText 宽 / em 高，按 96dpi 换算 mm；ASCII 与常用 CJK 测量结果缓存。
- 字体尚未加载时先用默认栈测量；订阅 `document.fonts.ready` 与 `document.fonts.onloadingdone`，字体可用后触发画布重排重绘。
- 单测注入假 Measurer（全角/等宽两种），不依赖真实字体。

## 5. 打印与预览渲染

`print-core/render-print-document.ts` 的 text 分支：外层定位 div（mm 坐标/尺寸/旋转，现状不变）+ 内层文本 div。

- 横排：外层定位 div 内直接放文本 div，样式为 `font-family:{family || SYSTEM_FONT_STACK}; font-size:{n}mm; font-weight; font-style; text-align; line-height; white-space:pre-wrap; word-break:break-word; overflow:hidden`；underline 时加 `text-decoration:underline`。
- 竖排：**两层结构**——外层定位 div（固定框宽高、overflow:hidden）设 `display:flex; flex-direction:row-reverse`，按 align 映射设 `justify-content`（left→flex-start 列组贴右、center→center、right→flex-end 贴左）；内层文本 div 样式为 `writing-mode:vertical-rl; text-orientation:mixed; height:100%;` 加字体/字号/粗斜/行高/`text-decoration:underline`。列内统一顶对齐（不输出 text-align）。
  实现前先写一个最小 HTML 在 Electron/Chromium 中验证三种 justify-content 的实际贴边方向，并将结论锁进测试断言（防止 row-reverse 方向记反）。
- token 插值、HTML 转义沿用 v2。空值横线 token（EMPTY_LINE_TOKEN）改用**逻辑文本装饰**实现：输出带 `text-decoration:underline` 的占位片段（如 `<span style="text-decoration:underline">&emsp;&emsp;</span>`），underline 会随 writing-mode 自动取水平/竖直方向；**不使用 border-bottom**（物理边框在竖排下不旋转）。
- 预览继续直接加载 renderPrintDocument 的输出（iframe 等比缩放），预览即打印结果。

## 6. 设计器交互

### 6.1 元素库（左栏）

- "文本"按钮点击后弹出二选一（Dropdown/Popover）：横排文本框 / 竖排文本框；创建对应 direction 的 text 元素，fontFamily 默认 ''。
- 图层面板文本项加方向小标记（"横"/"竖"）。

### 6.2 画布

- text 元素改用自定义 `<LaidText>`：Konva.Shape 的 sceneFunc 调 layoutText + 2D 逐字绘制（含 rotated 字符、下划线）；hitFunc 返回整框矩形保证命中与 Transformer 稳定。
- 超出框内容裁剪（clip 到框），与打印 overflow:hidden 一致。
- 拖移/缩放/旋转/吸附/辅助线/Group 包装等既有机制不变；双击仍可 prompt 改文本。

### 6.3 属性面板（文本选中）

- 方向：Segmented「横排/竖排」。
- 内容：TextArea（多行）；其下保留"插入参数"下拉（v2 逻辑）。
- 字体：Select showSearch，optionGroupProp 三组——系统默认（''）/常用（common，每项用自身字体渲染预览）/全部（all 去掉常用）。
- 字号 mm：InputNumber；样式按钮 B/I/U（高亮联动）；对齐三按钮（tooltip 随方向切换文案，字段仍为 align）；颜色 ColorPicker；行高 InputNumber。
- 所有写操作走现有 updateProps → store mutate → zod → 撤销栈。

## 7. 边界处理

- 字体名缺失/已卸载：CSS 回退默认栈；Canvas Measurer 回退默认字体；不报错、不阻断打印。
- 竖排 `\n` 强制换列；连续空格保留。
- 极小框（≥1mm）与极小字号不崩溃，超出部分裁剪。
- 元素 rotation 与 direction 叠加：先竖排再整体旋转。
- v2 模板打开视觉零变化（direction=horizontal、underline=false 默认；旧 fontFamily 保留）。

## 8. 测试策略

- `tests/print-core/text-layout.test.ts`（纯逻辑+假 Measurer）：CJK 逐字换行、ASCII 整词/超长断字、竖排换列顺序（右→左）、英数 rotated 占位、三对齐坐标、`\n`、下划线线段（横水平/竖竖直）。
- render-print-document 测试增补：竖排 HTML 含 writing-mode/text-orientation、underline 声明、fontFamily='' 输出默认栈、align 映射、v2 文档 parse 后默认 direction/underline。
- font-service：parseFontRegistryEntries 去重/去后缀/兜底合并单测；PowerShell 子进程仅手工验收。
- 模型/迁移测试：v2 文档（无 underline/direction、version:2）经 migrateDocument + zod parse 得到 direction='horizontal'、underline=false、version=3；v3 原样；v1→v3 仍正确（param 元素转文本）；job-repo 用 v2 快照夹具 hydrate 成功。
- CDP 走查：新建横/竖文本框；字体/字号/B/I/U；中文长文换行；竖排英数旋转；画布与预览一致；旧模板不变；零 console 异常。

## 9. 文件清单（预计）

```
print-core/template-model.ts                 修改：CONTENT_VERSION=3，TextProps +underline/+direction
print-core/text-layout.ts                    新增：排版纯逻辑与类型；导出 SYSTEM_FONT_STACK
print-core/migrate.ts                         修改：migrateDocument 统一入口（v1/v2→v3）
print-core/render-print-document.ts          修改：text 分支横竖两套样式（flex row-reverse/逻辑下划线）
db/repositories/template-repo.ts, job-repo.ts 修改：hydrate 统一过 migrateDocument
electron/main/services/font-service.ts       新增：注册表枚举/缓存/parseFontRegistryEntries
electron/main/ipc/index.ts, main/index.ts    修改：装配 FontService
shared/ipc-contract.ts, electron/preload/index.ts  修改：fonts:list 契约
src/renderer/designer/
  laid-text.tsx                              新增：Konva.Shape 自绘组件
  canvas.tsx                                 修改：text 用 LaidText
  element-library.tsx                       修改：横/竖二选一
  layers-panel.tsx                          修改：方向标记
  property-panel.tsx                        修改：方向/字体/B/I/U/TextArea
src/renderer/fonts.ts（或 store）            新增：api.fonts.list 缓存
tests/print-core/text-layout.test.ts         新增
tests/print-core/render-print-document.test.ts、template-model.test.ts、migrate.test.ts 修改
tests/main/font-service.test.ts              新增（纯解析函数）
```
