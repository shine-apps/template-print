# 模板打印程序 设计文档

- 日期：2026-09-23
- 状态：已评审通过（2026-09-23）
- 形态：Windows 本地桌面应用（单机先行，预留多机扩展）

## 1. 背景与目标

用户需要一个可自行设计打印模板并快速套打输出的桌面程序：

1. 可视化设计模板，支持图文排版与纸张大小设置（A4/A3、58/80mm 小票、标签、自定义尺寸）。
2. 模板可预留文本参数（姓名、日期等），使用模板打印时先填写参数。
3. 维护模板列表（增删改查、分类、导入导出）。
4. 选择模板后可在其基础上继续修改版式；打印后提示"保存改动 / 另存为新模板 / 不保存"。
5. 维护打印历史（参数值、成品缩略图、搜索筛选、一键重打）。
6. 打印机检查与配置（枚举、状态检查、测试页）。

### 1.1 需求范围确认

| 主题 | 结论 |
|---|---|
| 程序形态 | 本地桌面应用 |
| 打印机类型 | 普通办公（A4/A3）、标签/条码（热敏/热转印）、票据小票（58/80mm）、证卡/特种自定义尺寸，四类都支持 |
| 使用规模 | 先单机单人；数据访问层预留多机/PostgreSQL 扩展能力 |
| 设计元素 | 静态文本（内嵌 {{参数名称}} 占位符）、图片（含条码/二维码图片）、基础图形（直线/矩形/椭圆） |
| 排版辅助 | 对齐辅助线 + 网格吸附、图层顺序/锁定、元素旋转 |
| 打印方式 | 静默直打与系统打印对话框两种，按模板配置，可临时切换 |
| 参数类型 | 单行文本、多行文本、日期（默认今天）、数字/金额；不做下拉、流水号、图片参数 |
| 打印历史 | 参数值 + 成品缩略图、按模板/时间/参数搜索、一键重打；记录成功/失败/取消状态 |
| 打印机管理 | 枚举系统打印机并可设默认、打印前状态检查（可强制继续）、测试页 |
| 模板管理 | 新建/编辑/复制/删除、分类分组、导入/导出模板文件 |

> **范围决策（2026-09-23）**：不内置条码/二维码生成器。条码/二维码通过"上传图片元素"满足，设计器不集成专门的生成功能。

### 1.2 非目标（首版不做）

- 多用户、权限、网络协同与云同步（仅保证仓储层可切换到 PostgreSQL）。
- 自动流水号、下拉选择参数、图片参数。
- 条码/二维码生成器（用图片上传替代）。
- 打印审批、计费、统计报表。
- macOS / Linux 适配（架构上不主动破坏，但只在 Windows 验收）。

## 2. 技术方案选型

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A. Electron 一体化** | Chromium 打印栈成熟，支持静默直打、指定打印机、自定义纸张（微米）；前端生态丰富 | 安装包大（约 80–150MB）、内存占用高 | **选用** |
| B. Tauri | 安装包小、内存低 | 静默打印/打印机枚举/自定义纸张需自研 Rust 插件或 Win32 调用，标签机兼容性风险高 | 不选 |
| C. Bun 服务 + 浏览器 + 本地打印代理 | 贴合现有 Bun 技术栈，多机扩展顺 | 浏览器仍无法可靠静默打印，需额外常驻代理；三层结构安装与排障复杂，桌面体验弱 | 不选 |

**选型理由**：项目成败取决于打印链路可靠性。Electron + Chromium 在 Windows 下对办公打印机、标签机、小票机的兼容性与静默打印能力最成熟；SQLite + Drizzle 的数据层保留未来切换 PostgreSQL、升级多机版的空间。

### 2.1 定稿技术栈

- Electron + electron-vite（main / preload / renderer 三端构建）
- React 18 + TypeScript；Ant Design（表格/表单/抽屉等桌面管理台组件）；Zustand（设计器状态）
- Konva + react-konva（设计画布）
- adm-zip（.tplx 模板包导入导出）
- better-sqlite3 + Drizzle ORM（drizzle-kit 管理迁移）
- electron-builder（Windows NSIS 安装包）
- Vitest（单元/集成测试）
- 模板与元素模型用 zod 做运行时校验

## 3. 总体架构

```
┌──────────────────────────── Electron 应用 ────────────────────────────┐
│  渲染进程（React + TypeScript）                                        │
│  模板列表页 │ 模板设计器 │ 打印填写页 │ 打印历史页 │ 打印机设置页        │
│         │  类型安全 IPC（preload 暴露 window.api；禁用 nodeIntegration）│
├─────────┼─────────────────────────────────────────────────────────────┤
│  主进程（Node 环境）                                                   │
│  IPC 通道（薄封装：参数校验 + 转发）                                    │
│  服务层：TemplateService / PrintService / HistoryService /            │
│          PrinterService / AssetService                                │
│  ┌──────────────┐            ┌─────────────────────────┐              │
│  │ SQLite(Drizzle)│           │ Chromium 打印栈 /        │              │
│  │ 模板/历史/设置 │            │ Get-Printer 状态查询 /   │              │
│  └──────────────┘            │ 本地文件与图片            │              │
│                              └─────────────────────────┘              │
│  资源目录 %APPDATA%/template-print/                                    │
│    ├─ app.db              本地数据库                                    │
│    ├─ assets/<模板id>/    模板图片                                     │
│    └─ thumbs/             打印成品缩略图                               │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.1 关键架构原则

1. **渲染进程只负责 UI**。文件、打印、数据库全部经 IPC 调用主进程服务。服务接口以业务能力为粒度（如 `templates.list`、`print.submit`），未来多机版可把 IPC 实现替换为 HTTP 客户端而 UI 不变。
2. **编辑与打印分离，共用同一份元素模型**。Konva 只负责设计交互；打印输出由纯函数模块 `print-core/render-print-html.ts` 生成严格按毫米排版的 HTML。打印预览就是该 HTML 的等比缩放展示，保证"所见即所打"，文字为矢量输出。
3. **仓储层隔离**。所有 Drizzle SQL 收敛在 `db/repositories/` 内；服务层只依赖仓储接口。SQLite → PostgreSQL 的切换只改这一层与连接配置。
4. **安全边界**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox` 渲染进程；preload 只暴露白名单 API；打印窗口加载本地受控 HTML。

## 4. 数据模型

共 5 张表。模板画布内容以 JSON 文档存储（由代码中的 TS/zod 类型约束），不拆关系表，便于设计器迭代。

### 4.1 templates（模板）

| 字段 | 说明 |
|---|---|
| id | 文本主键 |
| name | 模板名称 |
| category | 分类（如"证书/标签/票据"），可空 |
| paper | JSON 纸张定义 `{ widthMm, heightMm, orientation, marginMm:{t,r,b,l} }` |
| content | JSON 画布文档（见 4.2） |
| print_mode | `"silent"` 静默直打 \| `"dialog"` 系统对话框 |
| printer_name | 直打目标打印机名；空表示系统默认 |
| is_builtin | 是否内置示例模板 |
| version | 模板结构版本号，用于未来迁移 |
| created_at / updated_at | 时间戳 |

### 4.2 content 画布文档结构

```ts
interface TemplateContent {
  elements: TemplateElement[];
}

type TemplateElement =
  | { id: string; type: 'text';    x:number; y:number; w:number; h:number;
      rotation:number; locked:boolean; zIndex:number;
      props: { text:string /* 可含 {{参数名称}} 占位符 */; fontFamily:string; fontSizeMm:number;
               bold:boolean; italic:boolean; align:'left'|'center'|'right';
               color:string; lineHeight:number } }
  | { id: string; type: 'image';   /* 几何字段同上（条码/二维码以此元素承载） */
      props: { assetId:string; fit:'contain'|'cover'|'fill'; opacity:number } }
  | { id: string; type: 'shape';   /* 几何字段同上 */
      props: { shape:'line'|'rect'|'ellipse';
               strokeColor:string; strokeWidthMm:number; fillColor:string|null } };
```

所有几何字段单位均为毫米（mm）。**content.version = 2（2026-09-24 改造）**：参数不再是画布元素，而是文本中的 `{{参数名称}}` 占位符；v1 数据在启动时一次性迁移（param 元素转含 token 的文本）。

### 4.3 template_params（参数定义，v2）

参数只有一个"参数名称"，同时承担字段标识与显示名（模板内唯一，允许中文，1–30 字，不含 `{}`）。复合主键 `(template_id, name)`。

| 字段 | 说明 |
|---|---|
| template_id / name / sort_order | 所属模板、参数名称（唯一）、表单排序 |
| type | `text` \| `textarea` \| `date` \| `number` |
| required | 是否必填 |
| default_value | 默认值；date 类型支持特殊值 `"today"` |
| date_format | 日期输出格式，如 `yyyy-MM-dd`、`yyyy年M月d日` |
| max_length | 文本最大长度 |
| min / max | 数字范围 |
| decimals / thousands_separator | 数字格式（小数位、千分位） |
| print_on_empty | 空值处理：`blank` 留空白 \| `line` 占位横线 |

引用方式：文本元素 props.text 中写 `{{参数名称}}`（括号内侧空白忽略）；打印时按名称替换，未定义名称替换为空串；改名时同步替换全部文本 token。删除模板时级联删除参数定义。

### 4.4 assets（模板图片）

| 字段 | 说明 |
|---|---|
| id / template_id | 主键、所属模板 |
| file_path | 相对应用资源目录的路径 |
| original_name / mime / size_bytes | 原始文件名、类型、大小 |
| width_px / height_px | 像素尺寸 |

约束：删除模板时级联删除记录并删除磁盘文件。

### 4.5 print_jobs（打印历史）

| 字段 | 说明 |
|---|---|
| id | 主键 |
| template_id | 来源模板 id（模板删除后保留为空引用） |
| template_name_snapshot | 打印时模板名冗余 |
| template_snapshot | JSON：打印时刻完整模板副本（paper + content + params） |
| param_values | JSON：`{ key: 用户填写值 }` |
| thumb_path | 渲染成品缩略图路径 |
| printer_name / copies / print_mode | 输出设置 |
| status | `success` \| `failed` \| `cancelled` |
| error_message | 失败原因 |
| created_at | 时间戳 |

设计决策：

1. **历史存模板快照**：模板以后被修改甚至删除，历史仍能还原当时成品并支持一键重打。
2. **历史永久保留**：首版不自动删除；M3 提供"清理 N 个月前记录"。

## 5. 核心业务流程

### 5.1 使用模板打印（主流程）

1. 模板列表选择模板（搜索/分类筛选），点"使用"。
2. 进入打印填写页：按 `template_params` 动态生成表单；日期默认今天；必填校验不过禁止打印。
3. 右侧实时预览：参数即时填入，按 `print-core` 渲染；参数文字超出元素框时，`autoFit=true` 自动缩字号，否则高亮提示溢出。
4. 选择打印机与份数；按模板配置默认静默直打或弹框，可临时切换。
5. 打印前状态检查：离线/异常则拦截提醒，可"强制继续"（网络打印机状态可能读不到）。
6. 提交打印管线（见第 7 节）；同时生成缩略图并写 `print_jobs`。
7. 打印成功后：本次无版式改动（`dirty=false`）则直接结束；有改动（`dirty=true`）则弹出三选一：
   - **保存改动**：覆盖原模板；
   - **另存为新模板**：复制 paper + content + 参数定义，命名后成为独立模板；
   - **不保存**：改动仅本次生效。

### 5.2 工作副本与 dirty 机制

- 进入打印页时把模板文档载入为内存工作副本。
- "调整版式"进入画布微调，所有修改只作用于副本并置 `dirty=true`。
- 参数值变化不属于版式改动，不置 dirty。
- 取消打印/打印失败时不弹保存决策；工作副本随页面关闭丢弃。

### 5.3 设计新模板

1. 新建 → 选纸张：A4/A3、58mm、80mm、常见标签预设或自定义毫米尺寸；设置方向与边距。
2. 三栏设计器中添加元素并排版。
3. 在"参数定义"中维护参数（仅登记，不上画布）；在文本里以 `{{参数名称}}` 引用（右栏"插入参数"或手写）；改名时同步替换文本 token；删除参数时提示文本中未替换的 token 打印时将留空（元素保留）。
4. 保存后进入模板列表；设计中可随时保存。

### 5.4 模板维护

- 复制：一键复制为"xxx 副本"，进入可编辑状态。
- 导入/导出：模板打包为单个 `.tplx` 文件（JSON + 图片资源的 zip 包），导出含全部参数定义与纸张设置；导入时校验 version 与结构，冲突时让用户选择"新建/覆盖"。
- 删除：二次确认，提示将删除图片资源但保留历史记录。

### 5.5 历史与重打

- 列表时间倒序，列：时间、缩略图、模板名、参数摘要、打印机、状态、操作。
- 筛选：模板、时间范围、参数关键字（如搜"张三"）。
- 重打：载入 `template_snapshot` + `param_values` 到打印填写页，可直接输出或微改参数；重打产生新的历史记录。
- 失败记录标红显示错误，提供"重试"（用原参数重新提交）。

## 6. 界面设计

应用外壳：左侧固定导航（模板列表 / 打印历史 / 打印机设置）+ 右侧内容区。

### 6.1 模板设计器（经典三栏）

- **左栏**：上半元素库（文本/图片/图形），下半图层面板（按 zIndex 列出全部元素，支持拖拽排序、显隐、锁定/解锁、删除）。参数定义在右栏维护。
- **中间**：顶部工具条（撤销/重做、模板名称与分类、纸张尺寸、缩放、网格开关、保存）；下方画布按纸张真实比例显示，网格、对齐辅助线、吸附。
- **右栏**：属性面板，随选中元素类型变化：几何（X/Y/宽高/旋转，毫米）、文本（字体/字号/加粗斜体/对齐/颜色/行高）、参数绑定、图片填充方式、图形描边填充等。

### 6.2 模板列表页

顶部：分类下拉、搜索框、"新建模板"、"导入"。
主体：模板卡片网格，卡片含纸张比例缩略图、名称、分类、纸张尺寸、直打/弹框标记；操作按钮"使用 / 编辑"与"⋯"菜单（复制、导出、重命名、删除）。

### 6.3 打印填写页

- 左侧：参数表单（动态字段、必填星号、日期选择器默认今天）；分隔线下方为打印机下拉（显示就绪状态）、静默直打开关、份数；底部按钮"打印"（主）与"调整版式"。
- 右侧：100% 实时预览，可缩放查看。
- 打印成功且 dirty 时弹保存决策对话框。

### 6.4 打印历史页

顶部筛选条（模板 / 时间范围 / 参数关键字）；高密度表格展示记录；失败行标红；行操作"重打/重试"，点击缩略图可放大查看成品。

### 6.5 打印机设置页

列出系统打印机：名称、状态点（就绪/离线/缺纸/异常/未知）、默认标记、支持纸张；操作：设为默认、打印测试页。提供自定义纸张检测引导入口（见 7.5）。

## 7. 打印管线

```
模板 JSON + 参数值
  → ① 参数求值与格式化
  → ② 离屏窗口生成打印 HTML（@page 毫米尺寸，元素绝对定位，mm 单位）
  → ③ webContents.print({ silent, deviceName, copies, pageSize(微米), margins:none })
  → ④ 结果处理：缩略图 + 写 print_jobs；成功且 dirty 弹保存决策；失败可重试
```

### 7.1 参数求值（v2）

- 文本中的 token 语法：`{{参数名称}}`，正则 `/\{\{\s*([^{}]+?)\s*\}\}/g`（允许中文，括号内侧空白忽略）；按名称查求值结果，未定义名称替换为空串，所有插入值做 HTML 转义。
- date：按 `date_format` 格式化；默认值 `today` 在打开填写页时解析为当天。
- number：按小数位/千分位输出。
- 空值：`blank` 输出空串；`line` 输出下划线片段（行内 token）。

### 7.2 打印 HTML 渲染

- 独立离屏、隐藏的 `BrowserWindow`（`show:false`），加载本地 print-renderer 页面。
- `@page { size: <w>mm <h>mm; margin: 0 }`；body 尺寸等于纸张；元素全部 `position:absolute`，坐标/尺寸用 mm。
- `html, body { margin:0; -webkit-print-color-adjust: exact; print-color-adjust: exact }`，保证背景色与印章色输出。
- 图片用本地 `file://` 路径或 dataURL（条码/二维码以图片元素形式提供，不做专门生成）。
- `print-core/render-print-html.ts` 为纯函数（输入模板+参数，输出 HTML 字符串），无 Electron/DOM 依赖，可独立单测；预览页通过 iframe/容器加载同一输出。

### 7.3 单位与精度

- 内部唯一单位为毫米；Chromium `pageSize` 使用微米（1mm = 1000μm）。
- 设计器屏幕显示按当前缩放比换算 px，不存储 px 值。
- 字号属性同时提供 mm 存储与 pt 显示（1pt = 0.3527mm）。

### 7.4 打印机枚举与状态

- 枚举：主进程 `webContents.getPrintersAsync()` 获取驱动名、是否默认、驱动信息。
- 状态：执行 PowerShell
  `Get-Printer -Name '<name>' | Select-Object PrinterStatus, WorkflowStatus`
  映射为 就绪/离线/缺纸/异常；命令加 3 秒超时；失败或读不到时显示"状态未知"，不拦截打印。
- 打印机名做严格转义，避免命令注入（经参数数组方式调用，禁止拼字符串进 shell）。

### 7.5 自定义纸张

- 优先在 `webContents.print` 的 `pageSize` 传 `{ width: 微米, height: 微米 }`（多数新版驱动支持）。
- 若驱动不支持运行时自定义尺寸（典型部分标签机），在打印机设置页提供引导：提示用户先在 Windows 打印首选项/打印服务器属性中注册"用户自定义纸张"，并给出当前模板要求的毫米尺寸；注册后在该模板选择该纸张形式。
- 首次对某打印机使用新尺寸直打前做一次兼容性提示。

### 7.6 错误处理

| 场景 | 处理 |
|---|---|
| 指定打印机不存在（改名/删除） | 弹窗重选打印机，历史记 failed |
| 状态离线/异常 | 警告并可强制继续 |
| 图片资源丢失 | 打印前报错，不发任务 |
| 静默直打回调失败 | 写 failed + error_message，提供重试 |
| 用户在系统对话框取消 | 写 cancelled，不算失败 |
| 渲染异常 | 捕获并提示具体元素 id，便于修正模板 |

### 7.7 测试页

固定生成一张含打印机名、纸张宽高（mm）、方向、边距、10mm 标尺边框与色块的测试页，用于核对物理输出尺寸与色彩。

## 8. 项目结构

```
template-print/
├─ electron/
│  ├─ main/
│  │  ├─ index.ts               窗口生命周期
│  │  ├─ ipc/                   IPC 通道注册（薄封装：校验 + 转发）
│  │  └─ services/              TemplateService / PrintService /
│  │                            HistoryService / PrinterService / AssetService
│  ├─ preload/index.ts          window.api 白名单（类型共享）
│  └─ print-window/             离屏打印窗口与 print-renderer
├─ src/                         渲染进程 React
│  ├─ pages/                    templates / designer / print / history / settings
│  ├─ designer/                 ElementLibrary / LayersPanel / Canvas(Konva) /
│  │                            PropertyPanel
│  └─ components/
├─ shared/                      两端共享类型、常量、毫米换算
├─ print-core/                  ★ 纯逻辑核心（无 DOM / 无 Electron 依赖）
│  ├─ template-model.ts         元素/纸张/参数 TS 类型 + zod 校验
│  ├─ param-evaluator.ts        参数求值与格式化
│  └─ render-print-document.ts  模板 + 参数 → 打印 HTML
├─ db/
│  ├─ schema.ts                 Drizzle 5 张表
│  ├─ repositories/             所有 SQL 收敛于此
│  └─ migrations/
└─ tests/                       Vitest 单测 + 渲染快照
```

## 9. 测试策略

- **print-core 单元测试（重点）**：
  - 参数求值：日期格式、默认今天、数字千分位/小数位、空值空白/横线；
  - 毫米/微米/pt 换算；
  - `render-print-html` 输出快照（含各元素类型、旋转、超长文本 autoFit）；
  - zod 模型校验：非法元素、缺字段、参数 key 冲突。
- **repositories 集成测试**：临时 SQLite 文件，覆盖模板 CRUD 级联、历史快照存取、搜索筛选、.tplx 往返。
- **服务层测试**：以仓储接口 mock 测试 dirty 保存决策、重打快照载入等业务规则。
- **打印硬件（人工验收清单）**：静默直打/弹框；A4、标签自定义尺寸、58/80mm 小票；打印机离线/取消对话框；测试页尺寸核对。每项随版本人工验收并记录（硬件行为不纳入 CI 自动化）。

## 10. 分期计划

- **M1 核心闭环**
  数据库与迁移；模板 CRUD；三栏设计器（文本/参数/图片/图形、基础排版）；参数填写表单与实时预览；Chromium 直打/弹框；打印历史（快照、成品缩略图、按模板/时间/参数关键字的基础筛选、重打）；打印机枚举、设默认、测试页；Windows 安装包。
- **M2 完善能力**
  元素旋转；辅助线与网格吸附；图层拖拽排序/锁定；模板名称与分类编辑；导入导出（.tplx）；PowerShell 打印机状态检查与打印前拦截。
  - 条码/二维码生成器不做（2026-09-23 决策，由图片上传满足）。
- **M3 打磨**
  历史多条件组合筛选增强；自定义纸张驱动引导；失败重试；历史清理；数据库自动备份；内置示例模板。

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 标签驱动不支持运行时自定义纸张 | 直打尺寸错误 | pageSize 微米优先 + 驱动注册引导（7.5） |
| 网络打印机状态读不到 | 误拦截或误显示 | 状态未知不拦截，仅警告可强制（7.4） |
| 屏幕所见与打印输出有偏差 | 套打错位 | 编辑/打印共用同一元素模型与 print-core 输出；毫米为唯一单位；测试页标尺核对 |
| 模板结构未来演进 | 旧模板打不开 | content 带 version 字段，加载时做迁移；导入文件强制 zod 校验 |
| 未来需要多机共享 | 单机版返工 | IPC 服务边界 + 仓储层隔离，SQLite/PostgreSQL 仅切换仓储实现 |
