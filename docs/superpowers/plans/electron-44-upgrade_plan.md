# Electron 31 → 44 框架升级实施计划（修订版）

> **目标版本：electron\@44.4.5**（npm dist-tag `latest` 与 `44-x-y` 均指向该版本，发布于 2026-09-23，2026-09-24 经 curl 直连 registry 单包接口与 dist-tags 接口核实）。
> 跨 13 个大版本：31 → 32 → … → 44；patch 版本不改变 ABI（Electron 44 全系 ABI 149）。
> 版本核实一律以 `registry.npmjs.org/-/package/electron/dist-tags` 与单包直查接口为准，不以网页版/CDN 快照为准。
>
> **执行中变更记录（2026-09-24，步骤 S12/typecheck 时发现）**：electron-vite 5 的类型定义直接 import
> vite 的 `BuildEnvironmentOptions` 且自身依赖 vite ^7.1.10；在 vite 5 下 `build.rollupOptions` 类型报错。
> 故根 **vite 升级至 ^7**（修正原“vite 保持不动”的假设）。vitest 2.1.9 以直接依赖方式自带 vite ^5，
> 安装后使用嵌套副本，测试不受影响。此变更仅涉及开发工具链，由 typecheck+build+52 项测试门禁覆盖。
>
> **修订版关键结论（v2）**：Electron 44（ABI 149）与系统 Node 24（ABI 137）**ABI 并不相等**；
> "单一二进制、删除切换机制"目标通过 **better-sqlite3 13.0.3（N-API 版）** 实现，而非 ABI 号对齐。

***

## 角色与责任

| 角色    | 承担人         | 职责                            |
| ----- | ----------- | ----------------------------- |
| 升级执行人 | 开发（AI 辅助执行） | 分支管理、依赖升级、API 适配、自动化验证、按本计划提交 |
| 验收人   | 用户本人        | 计划审批、人工功能走查、覆盖安装验证、终验批准与合并授权  |

***

## 一、仓库调研结论

### 1.1 当前版本基线

| 项                | 当前版本                                                      | 目标版本                                                               |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| electron         | ^31.4.0（内嵌 Node 20 / V8 12.2，ABI 125）                     | **^44.4.5**（内嵌 Node 24.21 系列 / V8 15.2 / Chromium 152，ABI **149**） |
| Node.js（系统）      | v24.20.0（ABI 137）                                         | 保持不变（electron 44.4.5 engines 要求 node >=22.12.0，满足）                 |
| electron-vite    | ^2.3.0                                                    | **^5.0.0**（需逐条核对 3/4/5 changelog）                                  |
| electron-builder | ^25.0.5                                                   | **^26.15.3**（按 v26 schema 重新校验配置）                                  |
| better-sqlite3   | ^12.11.1（V8 NAN 绑定，双 ABI 缓存切换）                            | **^13.0.3**（**N-API/node-addon-api**，二进制随包内置，无安装脚本）                |
| @types/node      | ^20.16.5                                                  | **^24.x**（electron 44 包本身也依赖 @types/node ^24.9.0）                  |
| typescript       | ^5.5.4                                                    | **保持 5.5.4 不升级**（@types/node 24 兼容，升级 TS 非必需，缩小变更面）                |
| 其他               | React 18 / Konva 9 / Drizzle 0.33 / vitest 2.1 / vite 5.4 | 全部保持不动                                                             |

> 内嵌 Node 精确小版本（24.21.x）以 S3 安装后 `npx electron -e "console.log(process.versions.node)"` 实测为准。

### 1.2 Electron API 使用盘点（全部受影响面）

| 文件                                                             | 使用的 Electron API                                                                                                                                                | 31→44 风险                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `electron/main/index.ts`                                       | `app.whenReady/on/getPath/quit`、`BrowserWindow`、`loadURL/loadFile`                                                                                              | 低                               |
| `electron/main/app-paths.ts`                                   | `app.getPath('userData')`                                                                                                                                       | 低                               |
| `electron/main/services/print-service.ts`                      | 隐藏 `BrowserWindow`、`webContents.print`（`WebContentsPrintOptions`：silent/deviceName/copies/pageSize 自定义微米尺寸/margins）、`capturePage`、`executeJavaScript`、`ipcMain` | **中高（重点回归）**                    |
| `electron/main/services/printer-service.ts`                    | `webContents.getPrintersAsync()`（读取 `p.isDefault`）、`ipcMain`、`execFile` PowerShell                                                                              | **高：`isDefault`** **已在 v36 移除** |
| `electron/main/services/template-service.ts`                   | `dialog.showSaveDialog/showOpenDialog`、`ipcMain`、adm-zip                                                                                                        | 中（默认目录行为变更）                     |
| `electron/main/services/asset-service.ts`                      | `ipcMain`、Node fs/path/url                                                                                                                                      | 低                               |
| `electron/main/services/history-service.ts`                    | `ipcMain`                                                                                                                                                       | 低                               |
| `electron/main/services/backup-service.ts`                     | `ipcMain`、`shell.openPath`、`sqlite.backup`                                                                                                                      | 低                               |
| `electron/main/services/settings-service.ts`、`seed-service.ts` | `ipcMain`                                                                                                                                                       | 低                               |
| `electron/preload/index.ts`                                    | `contextBridge`、`ipcRenderer.invoke`                                                                                                                            | **中：需新增 webUtils 桥接**           |
| `src/renderer/designer/element-library.tsx`                    | 读取 `(file as ...).path`（File.path）                                                                                                                              | **高：File.path 已在 v32 移除**       |
| `src/renderer/pages/print.tsx`、`settings.tsx`                  | 消费 `PrinterInfoDto.isDefault`                                                                                                                                   | 高（随上游修复）                        |

### 1.3 31→44 关键破坏性变更（已逐条比对官方文档）

1. **v32 Removed：`File.path`** → 必须用 `webUtils.getPathForFile(file)`，且只能在 preload 中桥接调用。
2. **v36 Removed：`PrinterInfo.isDefault`** **/** **`status`**（上游 Chromium 移除）→ 系统默认打印机改用 PowerShell CIM 查询。
3. **v42 Behavior Changed：electron 包不再通过 postinstall 自下载** → 首次运行 `npx electron` 时动态下载；可用 `npx install-electron` 预装；`ELECTRON_SKIP_BINARY_DOWNLOAD` 失效；跨平台改用 `ELECTRON_INSTALL_PLATFORM/ARCH`。
4. **v43 Behavior Changed：文件对话框未给** **`defaultPath`** **时默认定位到"下载"目录**，且系统不再记忆上次目录。
5. **v44 Removed：Windows 32 位（ia32）、Linux armv7l 支持**；本项目只打 x64，无影响。
6. **v44 Removed：渲染进程** **`clipboard`** **模块**（本项目未使用，渲染端只用浏览器 API）。
7. **v44 Behavior Changed：ANGLE 全平台静态链接，不再发布 libEGL/libGLESv2** → Konva/Canvas 与 GPU 路径需实测。
8. v44：macOS 12 不再支持（不打 macOS 包，仅记录）。
9. 其余已评估但**不影响本项目**的变更：v33 原生模块需 C++20（v13 用 N-API 预编译，不本地编译）、v34 全屏隐藏菜单栏（无菜单栏）、v38 `plugin-crashed` 移除（未监听）、v39 `window.open` 弹窗（未使用）、v41 PDF 渲染改为 OOPIF（未使用）、v42 OSR 默认缩放 1.0（本项目用普通隐藏窗口而非 OSR）、`NativeImage.toBitmap` 色彩归一化（只用 `toPNG`）。

### 1.4 ABI 事实与升级核心收益（已用一手来源核实）

**ABI 事实（node-abi 3.96.0 注册表实测）**：

| 运行时                            | ABI                       |
| ------------------------------ | ------------------------- |
| Node 24                        | 137                       |
| Electron 40 / 42 / 43 / **44** | 143 / 146 / 148 / **149** |

Electron 因 BoringSSL 等差异，ABI 始终独立于内嵌 Node 的编号——"Electron 44 内嵌 Node 24 ⇒ ABI 同为 137"的推断不成立。

**N-API 方案（已验证）**：

* better-sqlite3 **13.0.3**（v13.0.0 起）重构为 node-addon-api（N-API），官方声明预编译二进制跨 Node/Electron 版本通用；

* 已下载 tarball 实测：无任何 install/postinstall 脚本，8 个平台二进制直接位于 `prebuilds/{platform}-{arch}.node`，运行时由 `lib/binding.js` 按 `process.platform/process.arch` 直接 require；

* 因此 **win32-x64 单个 .node 文件可同时被 Electron 44（v149）与 vitest/Node 24（v137）加载**——双 ABI 切换机制可彻底删除，但底层原因是 N-API 的 ABI 稳定性，不是版本号对齐。

**其他收益**：13 个版本的 Chromium/V8 安全更新；v44.4.0 官方修复 `capturePage` 在离屏窗口的 deviceScaleFactor 重采样问题（与缩略图管线相关）。

***

## 二、升级前准备

### 2.1 分支冻结与基线采集

| #  | 动作                                                                                | 责任人 |
| -- | --------------------------------------------------------------------------------- | --- |
| P1 | 确认 M3 全部代码已提交、工作区干净（`git status`）                                                 | 执行人 |
| P2 | 在当前 HEAD 打基线标签 `pre-electron44`（不推送，仅本地回滚锚点）                                      | 执行人 |
| P3 | **采集升级前性能基线（在 Electron 31 上执行，仅此次机会）**：冷启动到主窗口可交互时间（3 次）、空闲内存、打开"测试"模板的耗时，记录数值与方法 | 执行人 |
| P4 | 新建并切换到升级分支 `chore/electron-44-upgrade`，升级工作全部在此分支进行                               | 执行人 |
| P5 | 关闭正在运行的 Electron / trae-preview / dev 进程（防止 .node 与 node\_modules 文件占用导致 EPERM）   | 执行人 |

### 2.2 数据备份（升级前必做）

| #  | 动作                                                                                   | 责任人 |
| -- | ------------------------------------------------------------------------------------ | --- |
| P6 | 手工复制 `%APPDATA%/template-print/app.db` 到安全位置（或先用当前应用执行一次"立即备份"）；确认 assets/ 目录完好      | 执行人 |
| P7 | 说明：本次**不涉及 DB schema 变更**；better-sqlite3 12→13 均为 SQLite 引擎同代文件格式，数据文件兼容，正常情况下无需数据回滚 | 执行人 |

### 2.3 风险评估

| 风险                                                 | 等级 | 说明与应对                                                                                                                                                           |
| -------------------------------------------------- | -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-API 二进制在 Electron 44 或 Node 24 一侧加载/行为异常         | 中  | N-API 的设计目标即跨版本稳定，但 v13.0.x 仍属新大版本。**升级后第一步双侧冒烟**（S5）；任一失败则回退 better-sqlite3 至 12.12.0（electron-v148，仅够 Electron 43）或改目标 Electron 43 + 保留切换脚本，并在分支记录决策          |
| drizzle-orm 0.33 与 better-sqlite3 13 不兼容           | 中  | drizzle 的 better-sqlite3 驱动只使用其稳定 JS API（prepare/run/all/get/pluck），v13 未移除这些接口；风险由现有 repositories 测试 + 全量 `npm test` 覆盖；发现不兼容则锁定 better-sqlite3 12 并触发上一行的降级路径 |
| 打印管线行为漂移（Chromium 打印在 13 个版本中多次改动）                 | 中高 | 打印 API 契约（pageSize 微米尺寸、margins、silent、回调 cancelled）逐一实测；重点测自定义纸张、取消、失败                                                                                         |
| `capturePage` 在隐藏窗口抓空白/尺寸异常                        | 中  | v44.4.0 已有相关修复（正面）；仍异常时调整等待节拍，备选 `printToPDF` 后栅格化                                                                                                              |
| Konva 画布渲染异常（ANGLE 静态链接/GPU 路径变化）                  | 中  | 设计器全元素渲染回归；必要时 `app.commandLine.appendSwitch`（如 `disable-gpu`）临时兜底                                                                                              |
| electron-vite 2 → 5、electron-builder 25 → 26 配置不兼容 | 中  | 升级前先核对 electron-vite 3/4/5 changelog（S6）；typecheck + build 验证；electron-builder 以 v26 schema 重新校验 yml                                                            |
| 首次运行 electron 动态下载超时（GitHub 源）                     | 中  | 统一 npmmirror：dev 走 dev.ps1 注入 `ELECTRON_MIRROR`；dist 先 `npx install-electron`                                                                                   |
| npm install 阶段 EPERM/EBUSY                         | 低  | 严格执行 P5；必要时整目录删除 node\_modules 后重装                                                                                                                              |
| 旧系统不可运行                                            | 低  | Electron 44/Chromium 152 要求 Windows 10 较新构建；目标机 Win10 22H2/Win11 满足，文档中写明最低系统要求                                                                                 |

### 2.4 回滚方案（三级）

1. **代码级（首选，10 分钟内）**：`git checkout` 回主分支 + `npm ci`，恢复 31.4.0 与锁文件；基线标签 `pre-electron44` 作为锚点。
2. **依赖级**：删除 `node_modules` 后 `npm ci`（升级前的 package-lock 已在主分支提交，保证可复现）。
3. **数据级（仅在数据文件被异常写坏时）**：用 P6 的 app.db 副本还原 `%APPDATA%/template-print/app.db`；assets/ 不受升级影响。
4. 升级分支在验收人终验通过、NSIS 包实机安装验证前**不合并主分支**。

***

## 三、具体升级步骤（按依赖顺序）

### 阶段 A：依赖升级

| #  | 动作                                                                                                                                                                                                           | 验证点          |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| S1 | 更新 `package.json` 版本：`electron: ^44.4.5`、`electron-vite: ^5.0.0`、`electron-builder: ^26.15.3`、`better-sqlite3: ^13.0.3`、`@types/node: ^24.x`；**typescript 保持 ^5.5.4**                                        | 仅改清单，暂不安装    |
| S2 | 更新 `allowScripts`：**移除** **`electron`** **条目**（v42 起无 postinstall）；**移除** **`better-sqlite3`** **条目**（13.0.3 无生命周期脚本）；保留 `esbuild`                                                                           | —            |
| S3 | 执行 `npm install`（若报 EPERM/解析错误，删 node\_modules 后重装）；设 `$env:ELECTRON_MIRROR='https://cdn.npmmirror.com/binaries/electron/'` 后 `npx electron --version` 触发动态下载；同时记录 `process.versions` 中内嵌 node/v8/chrome 实际值 | 版本输出 v44.4.5 |
| S4 | Node 侧冒烟：`npm test` 全绿（以执行时实际用例数为基线，**当前为 52 项**，数量不得减少）                                                                                                                                                     | 52 项测试通过     |

> 说明：electron-vite 5 peer 为 vite ^5||^6||^7，当前 vite 5.4 满足，**vite 保持不动**；
> @vitejs/plugin-react、vitest、React、Konva 等均不受影响，不升级，缩小变更面。

### 阶段 B：API 变更适配

#### B1. better-sqlite3 双侧冒烟（最先执行，决定后续路径）

| #  | 动作                                                                                                                                                     |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S5 | ① Node 侧：`node -e` 完成 better-sqlite3 建表/插入/查询；② Electron 侧：临时主进程脚本在 Electron 44 内加载同一 `prebuilds/win32-x64.node` 完成相同操作（结果写文件判定）。双侧成功才继续；失败按 2.3 风险表降级 |

#### B2. File.path → webUtils 桥接（v32 移除项）

| #  | 动作                                                                                                                                                |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6 | `electron/preload/index.ts`：`import { webUtils } from 'electron'`，新增桥接分组：`system: { pathForFile: (file: File) => webUtils.getPathForFile(file) }` |
| S7 | `shared/ipc-contract.ts` 的 `Api` 接口：新增 `system: { pathForFile(file: File): string }` 声明（同步返回）                                                     |
| S8 | `src/renderer/designer/element-library.tsx`：改为 `window.api.system.pathForFile(file)`，删除 `File & {path}` 断言                                        |
| S9 | 全局搜索确认无其他 `File.path` / `file.path` 用法                                                                                                            |

#### B3. PrinterInfo.isDefault 移除（v36 移除项）

| #   | 动作                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S10 | `printer-service.ts`：`list()` 不再读 `p.isDefault`；新增系统默认打印机查询：PowerShell `(Get-CimInstance -ClassName Win32_Printer -Filter 'Default=TRUE' \| Select-Object -First 1).Name`，沿用"绝不抛出、异常回落 null + 60 秒 Promise 缓存"模式，以结果标记各 `PrinterInfoDto.isDefault` |
| S11 | 保留 `getPrintersAsync()` 取打印机名列表；若 v44 出现废弃信号，启用备选：PowerShell `Get-CimInstance Win32_Printer` 枚举名称（以类型定义与运行时告警为准）                                                                                                                                   |

#### B4. electron-vite / electron-builder 升级核对

| #   | 动作                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S12 | 逐条核对 electron-vite 3、4、5 版 changelog（重点：配置项重命名、main/preload 外部化规则变化、HMR 行为）；按核对结果调整 `electron.vite.config.ts`（当前配置仅 externalize 了 three 与 better-sqlite3，保持最小改动）                                                              |
| S13 | electron-builder 配置更新（v26 schema）：① `asarUnpack` 原匹配 build/Release 下 better\_sqlite3.node 的条目，改为覆盖新路径 `**/node_modules/better-sqlite3/prebuilds/*.node`；② 保留 `npmRebuild: false`（N-API 二进制无需重建）；③ 注释更新为"N-API 单二进制，无需 ABI 切换" |

#### B5. Electron 下载方式变更适配（v42）

| #   | 动作                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S14 | 新增 `scripts/dev.ps1`（纯 ASCII）：设置 `$env:ELECTRON_MIRROR='https://cdn.npmmirror.com/binaries/electron/'` 后执行 `npx electron-vite dev`；`package.json` 的 `dev` 脚本改为调用该包装脚本 |
| S15 | 更新 `scripts/dist.ps1`：构建打包前先设 `ELECTRON_MIRROR` 并执行 `npx install-electron` 预装二进制                                                                                      |

#### B6. 对话框与注释清理（v43 等）

| #   | 动作                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| S16 | 导入 .tplx 的 `showOpenDialog` 显式传入合理 `defaultPath`（如用户目录），避免每次落在"下载"；导出对话框已有 defaultPath（模板名），确认即可                          |
| S17 | `print-service.ts` 注释中"Electron 31"表述更新；核对 v44 类型中 `WebContentsPrintOptions`（含 pageSize `{width,height}` 微米结构）仍支持，类型零断言通过 |

### 阶段 C：旧 ABI 机制删除（S5 双侧冒烟通过后执行）

| #   | 动作                                                                                |
| --- | --------------------------------------------------------------------------------- |
| S18 | 删除 `scripts/switch-sqlite.ps1`；删除 `package.json` 中 `bin:node` / `bin:electron` 脚本 |
| S19 | 精简 `scripts/dist.ps1`：移除 ABI 切换/切回步骤（保留镜像与 install-electron 逻辑）                   |
| S20 | 清理 `.native-bin/` 缓存与本次调研临时文件（目录已被 gitignore，纯本地清理）                               |
| S21 | 全局搜索确认仓库无 `switch-sqlite`、`bin:node`、`bin:electron`、`.native-bin` 残留引用            |

### 阶段 D：构建与提交

| #   | 动作                                                                                |
| --- | --------------------------------------------------------------------------------- |
| S22 | 依次执行：`npm run typecheck` → `npm test` → `npx electron-vite build`，全部通过            |
| S23 | 在升级分支按逻辑粒度分开提交（依赖升级 / 双侧冒烟 / webUtils 适配 / 默认打印机适配 / 构建配置 / 旧机制删除），不主动合并、不推送，等待验收 |

***

## 四、测试验证方案

### 4.1 自动化验证（强制门槛）

| 类别    | 内容                                                                          | 通过标准                                      |
| ----- | --------------------------------------------------------------------------- | ----------------------------------------- |
| 类型    | `npm run typecheck`                                                         | 零错误（类型系统是发现 API 移除的第一道闸）                  |
| 单元/集成 | `npm test`（当前 **52 项**：仓储、各 service、tplx 往返、print-core、renderer store、工具函数） | 全部通过，数量不减少                                |
| 构建    | `npx electron-vite build`                                                   | 主/预加载/渲染三段构建成功，无 import 解析错误              |
| 原生模块  | 双侧冒烟（S5）：Electron 44 与 Node 24 分别加载同一 N-API 二进制                             | CRUD 均成功                                  |
| 打包    | `npm run dist` 全流程（含镜像下载、NSIS）                                              | 产出 `TemplatePrint Setup 0.1.0.exe`，无未处理警告 |

### 4.2 功能测试（验收人人工走查清单）

**设计器**

* 新建模板（自定义尺寸/分类）；文本、直线、矩形、椭圆、图片、参数占位各元素添加/选中/拖拽/缩放/旋转/删除

* 网格吸附、图层排序与名称/分类编辑、属性面板编辑（字体/颜色/线宽/对齐等）

* 参数增删改、必填设置；保存后重新打开数据无损

* **图片上传走新 webUtils 路径**（重点：原 File.path 链路）

**模板管理**：列表筛选（分类/关键词）、复制、删除、.tplx 导出/导入（含图片资产）往返一致

**打印（最高优先级）**

* 对话框模式：真实打印机出纸内容/尺寸/边距正确；对话框点取消 → 历史状态 `cancelled`

* 静默模式：按应用默认打印机直接出纸；多份数 copies 生效

* 失败路径：指定不存在的打印机/打印机离线 → 状态 `failed` 且有原因

* Microsoft Print to PDF：生成 PDF，版式与纸张尺寸正确

* 自定义纸张（如 100×60mm）：pageSize 微米参数生效，不串纸、不缩放

* 打印前缩略图抓帧正常、非空白、比例正确

* 测试页打印：边框/色块/文字完整

**打印历史**：列表与组合筛选（M3）、详情、重打（携带原快照）、手动清理（按天数/全部）、计数正确、缩略图显示

**打印机设置**：打印机列表、系统默认标记（新 CIM 查询）、应用默认设置、运行时状态五态（ready/offline/paper-out/error/unknown）刷新、测试页

**设置与运维（含 M3）**：设置读写持久化；历史保留策略；失败重试引导；自定义纸张引导；立即备份 + 备份目录打开 + 每日自动备份（保留 7 份清理）；内置示例模板只播种一次

### 4.3 性能验证（对照 P3 基线）

| 指标                            | 方法                          |
| ----------------------------- | --------------------------- |
| 应用冷启动时间（进程起→主窗口可交互）           | 同 P3 方法测 3 次，与基线对比无显著劣化     |
| 空闲内存与连续打印 5 次后的内存             | 任务管理器，观察是否明显泄漏              |
| 打印管线耗时（loadFile → 缩略图 → 调起打印） | 与基线/主观记录对比，无数量级劣化           |
| dev 模式启动与 HMR                 | electron-vite 5 下功能正常、无显著变慢 |
| 大图（>10MB）上传与渲染                | 不卡死、尺寸读取正确                  |

### 4.4 兼容性验证（范围说明）

* **操作系统**：仅交付 Windows NSIS 包。验证 Windows 10 22H2 与 Windows 11；DPI 缩放 100% / 125% / 150% 下窗口与画布正常；文档明确最低系统要求（Chromium 152 约束，约 Windows 10 1809+）。

* **安装形态**：干净机器首装 NSIS 包；**在已装 0.1.0（Electron 31）的机器上覆盖安装**，确认 `%APPDATA%/template-print/` 数据（含用户真实模板"测试"）无损、seed 版本标记逻辑正常。

* **"浏览器环境"说明**：Electron 内嵌固定 Chromium 152，不存在跨浏览器（Chrome/Edge/Firefox）测试面；外部浏览器无法访问本应用。

* macOS / Linux：不构建、不交付，本次不做兼容性测试；相关破坏性变更仅在文档记录，作为未来扩展前置信息。

***

## 五、升级后优化建议与潜在问题处理

1. **长期维护**：每 2\~3 个 Electron 大版本评估一次升级，避免再次跨 13 个版本；关注 Chromium 打印变更预告。
2. **打印管线加固**：`capturePage` 若仍偶发空白，优先调整就绪等待；长期可改 `printToPDF` → PDF 首页栅格化的稳定方案。
3. **GPU/ANGLE 异常兜底**：Konva/设计器若花屏、不刷新，记录 GPU 型号，尝试 `disable-gpu` / `enable-unsafe-swiftshader`，确认问题后再固化代码。
4. **打印机枚举去 Chromium 依赖**：默认打印机已走 CIM，可评估将完整打印机列表（名称/默认/连接状态）统一由 PowerShell 枚举，摆脱 `getPrintersAsync` 未来被移除风险（后续可选任务，本次不做）。
5. **electron 动态下载**：换机文档写明首次 `npm run dev`/`npx electron` 会下载运行时且 dev.ps1 已走镜像；如引入 CI，用 `npx install-electron` 预装。
6. **签名与 SmartScreen**：未签名 NSIS 包在新机器可能有 SmartScreen 提示，属既有现象；如采购代码签名证书，同步在 electron-builder 配置。
7. **可选版本跟进（本次不纳入）**：vitest 3、vite 7 等在升级稳定后单独评估，不与本次混杂。
8. **已知无害提示**：沙箱下 Electron 访问系统输入法/色彩配置文件可能产生受限提示；Windows 控制台的 Node 弃用警告需甄别来源，发现即修。

***

## 六、项目文档更新要求

| #  | 文件                                                           | 更新内容                                                                                                                                                           | 时机    |
| -- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| D1 | `docs/superpowers/specs/2026-09-23-template-print-design.md` | 技术栈版本矩阵：Electron 31→44.4.5、内嵌 Node 24.21 系列、electron-vite 5、electron-builder 26、@types/node 24、better-sqlite3 13（N-API）；移除"双 ABI 切换"描述，改为"N-API 单二进制"；补充最低系统要求 | 终验通过后 |
| D2 | 项目记忆（memory：project\_memory.md）                              | 更新技术栈与 Windows 约定：删除 ABI 切换脚本与 bin:node/bin:electron 条目；记录 File.path/isDefault 两处适配、N-API 统一方案、版本核实的缓存教训                                                       | 终验通过后 |
| D3 | `electron-builder.yml`、`print-service.ts` 等注释                | 随 S13/S17 更新，不留过时版本引用                                                                                                                                          | 实施时同步 |
| D4 | M1/M2/M3 历史计划文档                                              | **保持原样不修改**（属历史记录）                                                                                                                                             | —     |
| D5 | 本计划文档                                                        | 作为升级正式记录留存 `.trae/documents/`；执行中步骤实质调整时同步更新并重新知会验收人                                                                                                           | 全程    |
| D6 | README                                                       | 仓库当前无 README，**本次不新建**                                                                                                                                         | —     |

***

## 七、验收标准（Definition of Done）

1. 升级分支上 typecheck / 52 项测试（数量不减少）/ electron-vite build / NSIS 打包全部通过。
2. N-API 二进制经 Electron 44 与 Node 24 双侧加载验证（S5）。
3. File.path（webUtils）、系统默认打印机（CIM）两处适配经人工实际操作验证。
4. 第 4.2 节功能走查清单全部通过，尤其打印四态（成功/取消/失败/Print to PDF）与自定义纸张。
5. 性能指标对照 P3 基线无显著劣化。
6. Win10、Win11 至少各一台完成覆盖安装，旧数据无损。
7. 双 ABI 切换机制（脚本、npm 脚本、缓存、引用）已全部删除。
8. D1、D2、D3 文档更新完成。
9. 验收人终验批准后，升级分支方可合并主分支。

