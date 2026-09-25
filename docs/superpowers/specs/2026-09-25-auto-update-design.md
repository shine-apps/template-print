# 应用自动更新机制设计（2026-09-25）

## 1. 目标与约束

为桌面应用「模板打印」（Electron 44 + electron-vite + React 18，仅 Windows x64，NSIS 辅助安装包）设计一套轻量、尊重用户选择的版本更新机制。

核心原则：

- **用户拥有更新选择权**：自动只做"检查+通知"；下载、安装每一步都需用户显式确认；可关闭自动检查；可跳过版本；永不强制更新。
- **轻量化**：不引入 electron-updater 等新依赖；下载用 Electron `net`，校验用 node:crypto，压缩沿用已有 adm-zip（本方案实际不涉及解压）。
- **本地可完整走查、将来零代码改动上线**：更新地址为配置常量；提供本地静态更新服务器脚本（支持 Range）；上线时仅替换常量为真实 HTTPS 地址（如腾讯云 COS）。
- 安装方式：**NSIS 安装包静默安装**（复用现有产物与卸载链路），由独立 PowerShell 守护脚本完成备份→安装→校验→回滚。

明确不做（YAGNI）：增量/差分包、强制更新、macOS/Linux、代码签名校验（当前安装包本身也无签名；完整性靠 HTTPS + SHA256）、electron-updater。

## 2. 更新清单协议

静态 JSON 文件，由发布脚本生成，无需任何后端逻辑。

`GET {UPDATE_BASE_URL}/latest.json`（8s 连接/读取超时）：

```json
{
  "version": "0.2.0",
  "releaseDate": "2026-09-25",
  "releaseNotes": "1. 修复……\n2. 新增……",
  "url": "TemplatePrint-0.2.0-Setup-x64.exe",
  "size": 127432192,
  "sha256": "hex(64)"
}
```

- `url`：相对路径（相对 `UPDATE_BASE_URL`）或绝对 http(s) URL，均支持。
- zod 校验结构；任何字段不合法视为检查失败（自动检查静默、手动检查报错）。
- 版本比较：点分数字段语义化比较（缺段补 0，非数字段按 0 处理），`0.10.0 > 0.9.0`，相等不算可更新。纯函数 `compareVersions(a,b)` 返回 -1/0/1，附单测；不引 semver。
- 远端等于/低于本地：无更新。

## 3. 配置与设置

### 3.1 更新源配置 `shared/update-config.ts`

- `UPDATE_BASE_URL`：默认占位 `http://127.0.0.1:8765/`（本地走查服务器）。
- 仅当 `!!process.env.TP_UPDATE_BASE_URL` 且 `import.meta.env.DEV` 时允许环境变量覆盖；打包构建恒用常量，防止被篡改指向恶意源。
- 常量集中在一个文件，上线改一处即可。

### 3.2 settings.json 新增字段

`electron/main/settings.ts` 的 `AppSettings`：

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `autoCheckUpdates` | boolean | true | 是否启动后自动检查 |
| `skippedUpdateVersion` | string \| null | null | 用户点过"跳过此版本"的版本号；自动通知对该版本静默，手动检查不受影响 |
| `lastUpdateCheckAt` | number \| null | null | 上次检查时间戳（节流用） |

同步更新 `shared/settings-dto.ts`；`autoCheckUpdates` 加入 `SETTABLE_KEYS`（渲染端开关需要），另两个仅主进程内部写（通过专用 update IPC 写 skip）。

## 4. 模块划分

```
shared/
  update-manifest.ts        # zod schema + compareVersions + DTO（UpdateManifest/CheckResult/UpdatePhase）
  update-config.ts          # UPDATE_BASE_URL（dev 允许 env 覆盖）
electron/main/update/
  downloader.ts             # 断点续传下载器（Electron net，Range，回退重下，重试，进度回调）
  checksum.ts               # 流式 sha256（node:crypto）
  guardian-script.ts        # 生成纯 ASCII 守护脚本内容（不执行）
electron/main/services/
  update-service.ts         # 编排：检查/下载/取消/校验/安装；状态文件；自动检查节流
electron/preload/index.ts   # window.api.update.*
src/renderer/
  update/update-modal.tsx   # 更新通知 + 下载进度弹窗
  update/use-update.ts      # 订阅 IPC 事件的小 hook（或直接在页面内用，二选一取简）
  pages/about.tsx           # 检查更新按钮 + 自动检查开关 + 当前版本
```

### 4.1 下载器 `downloader.ts`

- 使用 Electron `net.request`（自动走系统代理、支持 session 证书策略）。
- 目标文件 `{userData}/updates/downloads/Setup-<version>.exe`；下载中写同名 `.part`。
- 断点续传：开始时若 `.part` 存在，带 `Range: bytes=<size>-`；
  - 响应 206 → append 续传；
  - 响应 200/其他 → 删除重下（服务端不支持 Range 的回退路径）。
- 进度：监听 IncomingMessage `data`，回调 `{ downloaded, total, bytesPerMs }`；total 取 content-range/content-length，未知时 total=null（UI 显示已下载 MB，不显示百分比）。
- 网络错误指数退避重试 3 次（500ms/1.5s/4s）；重试时保留 .part 重新走 Range 逻辑。
- 取消：`AbortController`（net.request 支持 signal）；取消视为正常结束，保留 .part。
- HTTP 非 2xx 直接失败（含错误码）；下载字节数与清单 size 不符则失败（size 仅作软校验，最终以 sha256 为准；size 缺失不拦）。
- 纯逻辑（Range 决策、URL 解析、重试调度）抽成不依赖 Electron 的函数，用 node 内置 http.Server 打桩单测；net 部分只做薄封装。

### 4.2 校验 `checksum.ts`

- `sha256File(path): Promise<string>` 流式（createReadStream + Hash），避免 120MB 包整读入内存。
- 与清单 sha256 做小写 hex 严格相等；不符：删除 .part/目标文件，返回失败，不进入安装。

### 4.3 编排服务 `update-service.ts`

状态（内存 + 文件）：

- `{userData}/updates/install-state.json`：
  `{ from, to, phase: 'installing'|'done'|'failed', reason, ts }`
- `{userData}/updates/guardian.log`：守护脚本写。
- 单例下载会话：同一时刻只允许一个下载；`download()` 幂等（已在校验通过态直接返回完成）。

方法：

- `check(manual: boolean)`：拉清单 → zod 解析 → 比版本 →
  - 无更新：manual 时回调"已是最新"，自动时静默；
  - 有更新且 `!manual && skippedUpdateVersion===version`：静默；
  - 其余：向渲染进程广播 `update:checkResult`（含 releaseNotes/size 格式化前的原始字节）。
  - 网络/解析失败：manual 广播错误，自动静默。
- `startAutoCheck()`：窗口创建后调用；`autoCheckUpdates && Date.now()-lastUpdateCheckAt>=24h` 才查；dev 模式（`app.isPackaged===false`）不自动查。
- `download(manifest)`：执行 4.1/4.2；广播 `update:progress`；成功广播 phase=`ready`。
- `cancelDownload()`。
- `skipVersion(version)`：写 settings。
- `install()`：前置确认在渲染端完成；主进程再次确认文件 sha256 → 写 install-state(installing) → 生成 guardian.ps1（4.4）→ `spawn('powershell.exe', ['-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File', ...], { detached:true, stdio:'ignore' })` → `app.quit()`。
- 启动时（主进程 ready 后、窗口创建后）读取 install-state：
  - `installing`（说明上次守护脚本没跑完，异常关机/被杀）：标记 failed，reason='安装中断'；
  - `failed`：广播 `update:installFailed`（reason），渲染端弹窗；
  - `done`：广播 `update:installed`（to，用于"已更新到 x"提示），删除旧备份目录（保留当前这次安装对应的备份，见 4.5），清状态文件。

### 4.4 守护脚本 `guardian-script.ts`

`buildGuardianScript(): string` 只负责输出脚本本体（路径全部运行时从 params 文件读取，不硬编码）。**输出必须为纯 ASCII**（有单测断言），规避 PowerShell 5.1 无 BOM UTF-8 乱码问题；所有中文文案不进脚本（失败原因写英文 code，由应用映射为中文）。

脚本步骤（每步写日志、失败即进入回滚）：

0. 读取同目录 `guardian-params.json`（主进程生成，**UTF-8**，脚本用 `Get-Content -Encoding UTF8 | ConvertFrom-Json` 读取——安装路径可能含中文用户名，脚本本体仍纯 ASCII，中文只出现在数据文件里）。参数：安装包绝对路径、当前 exe 绝对路径（其目录即安装目录/备份源）、fromVersion/toVersion（备份目录命名与状态写入用）、状态文件路径、备份根目录、日志路径。
1. 等待产品进程退出（匹配当前 exe 路径的进程，最多 60s 轮询 Get-Process；守护脚本自身路径在 updates 目录下，不会误匹配）。
2. robocopy 把安装目录（exe 所在目录）整体备份到 `{updates}/backup-<from>/`（robocopy 退出码 0-7 均视为成功）。
3. 运行安装包：`Start-Process setup.exe -ArgumentList '/S' -Wait`（NSIS `/S` 静默；装在 Program Files 时安装包自身触发 UAC）。
4. 校验：新 exe 存在且 `(Get-Item).VersionInfo.ProductVersion` 的数字部分 >= 目标版本。
5. 成功：状态写 done；启动新 exe；退出（备份保留）。
6. 任一步失败：状态写 failed+英文 reason；若备份存在则 robocopy 回滚（/MIR）到原目录；启动旧 exe；退出。

脚本文件每次安装时重新生成到 `{updates}/guardian.ps1`（不进 asar，不进安装包）。

### 4.5 备份保留

- 守护脚本只产生 `backup-<from版本>`；done 后应用在下次启动清理：只保留最近一个 backup-* 目录（按 ts/名称排序），其余删除。
- 用户数据（%APPDATA%/template-print 下的 app.db、assets）在安装目录之外，NSIS 升级不触碰，无需备份。

## 5. IPC 契约

`shared/ipc-contract.ts` 新增：

```ts
// channels
updateCheck        // (manual:boolean) => void（结果走事件）
updateDownload     // () => void
updateCancel       // () => void
updateInstall      // () => void
updateSkipVersion  // (version:string) => void
updateOpenLogDir   // () => void（shell.openPath updates 目录）

// 事件（主→渲，webContents.send）
update:checkResult   // { hasUpdate:boolean, manifest?, reason? }
update:progress      // { phase:'downloading', downloaded, total, bytesPerMs }
                      // | { phase:'verifying' }
                      // | { phase:'ready', filePath }
                      // | { phase:'error', reason }
                      // | { phase:'canceled' }
update:installFailed // { from,to,reason }
update:installed     // { version }
```

preload 暴露 `window.api.update.check(manual)/download()/cancel()/install()/skip(v)/openLogDir()` 与 `window.api.update.on(channel, cb)`（`ipcRenderer.on` 的薄封装，组件卸载时返回退订函数）。

## 6. 渲染端 UI

### 6.1 更新弹窗 `update-modal.tsx`（全局挂载，App 壳层）

- **有更新态**：标题"发现新版本 vX.Y.Z"；正文：发布日期、releaseNotes（保留换行，`white-space: pre-wrap`）、大小（`formatBytes`：>=1GB 显示 GB，否则 MB，一位小数）；按钮：`立即更新`（主）/ `稍后更新`（次）/ `跳过此版本`（文字按钮）。
- **下载态**：Progress 条（total 已知时百分比；未知时 indeterminate）+ "已下载 x MB / y MB · z MB/s"；`取消`按钮（取消后回到有更新态，.part 保留）。
- **校验态**："正在校验安装包完整性…"。
- **错误态**：错误原因 + `重试` / `稍后`。
- **ready→安装确认**（独立 Modal.confirm 式强提示）："即将退出程序并运行安装程序。安装约需 1 分钟，期间请勿关机；如出现用户账户控制（UAC）提示，请点击"是"。"按钮 `立即安装并重启` / `取消`（取消则安装包保留，关于页可再次安装）。
- 自动检查弹出的弹窗不抢焦点阻断操作（非模态通知样式或延迟到主窗口就绪后）；手动检查结果用 message/Modal 明确反馈（已是最新/失败原因）。

### 6.2 关于页 `pages/about.tsx`

- 当前版本号下方：`检查更新` 按钮（loading 态；结果 message 提示，有更新则开弹窗）；
- Switch「自动检查更新（每日一次）」绑 `autoCheckUpdates`；
- 被跳过的版本显示"已跳过 vX（恢复检查）"小字按钮（清空 skippedUpdateVersion）。

## 7. 发布与本地测试工具

- `scripts/build-update-manifest.ps1`（纯 ASCII）：
  - 参数 `-SetupPath`（默认 release 下最新 `*Setup*x64.exe`）、`-Version`（默认读 package.json）、`-OutDir`（默认 release/）；
  - 计算长度与 SHA256（`Get-FileHash -Algorithm SHA256`），读 productName 约定文件名，生成 `latest.json`（releaseNotes 从同目录 `release-notes.txt` 读取，无则空串）。
- `scripts/serve-update.ps1`（纯 ASCII）：.NET `HttpListener` 监听 `http://127.0.0.1:8765/`，静态托管指定目录（默认 release/），**实现 Range 206**（解析 Range 头、写 Content-Range/Accept-Ranges），用于完整走查断点续传。
- 上线步骤（写进设计文档，不做自动化）：`npm run dist` → 跑 manifest 脚本 → 上传 exe + latest.json 到 COS → 改 `UPDATE_BASE_URL` → 发版。

## 8. 错误处理与用户提示映射

| 场景 | reason code（内部） | 用户看到 |
|---|---|---|
| 清单拉取超时/网络断 | net-error | 手动：检查网络后重试；自动：静默 |
| 清单格式错 | bad-manifest | 更新信息异常，请联系开发者 |
| 下载中断重试耗尽 | download-failed | 下载失败，可断点续传重试 |
| 大小不符 | size-mismatch | 安装包下载不完整 |
| sha256 不符 | checksum-mismatch | 安装包已损坏或被篡改，已删除 |
| 守护脚本：进程未退出 | wait-process-timeout | 安装失败：程序未能正常退出，请重启电脑后重试 |
| 备份失败 | backup-failed | 安装失败：无法创建备份（磁盘空间/权限） |
| 安装包退出码非零 | installer-failed | 安装失败，已自动恢复到旧版本；如反复出现请关闭杀毒软件后重试 |
| 安装后版本不符 | verify-failed | 安装后校验失败，已自动恢复 |
| 安装中断（状态滞留 installing） | interrupted | 上次更新未完成，已恢复旧版本 |

所有 failed 弹窗提供：原因中文说明 + `打开更新日志目录` + `我知道了`。

## 9. 安全考虑

- 更新源仅 HTTPS（本地走查例外）；清单与包同目录，sha256 随清单走——能篡改清单者即可换包，因此上线务必 HTTPS + 不可写桶权限。文档中注明。
- 安装包文件名含版本，下载目录不接受路径穿越（url 解析后只取最终文件名，且必须匹配白名单后缀 `.exe`）。
- 守护脚本不用 Invoke-Expression 拼接远程内容；所有路径来自主进程生成时写入的参数（安装包绝对路径、状态文件绝对路径）。

## 10. 测试与验证

**vitest 单测：**

1. `compareVersions`：相等/主次版本/0.10>0.9/缺段/非数字段。
2. 清单 zod 解析：合法、缺字段、坏 URL、相对/绝对 URL 解析。
3. 下载器纯逻辑：Range 决策（有 part→206 续传、200→重下）、相对 URL 解析、重试次数与退避（注入假时钟/假 request）。
4. 下载器集成：node `http.createServer`（支持 Range）打桩，验证：首次全量、中断后续传字节正确、服务端忽略 Range 时回退重下、取消后 .part 保留、sha256 正确（用小 fixture 文件）。
5. checksum：已知内容 sha256 向量。
6. guardian-script：输出全 ASCII、包含备份/安装/校验/回滚/状态写入关键标记（用字符串断言，不执行 PS）。
7. settings 新字段默认值 + autoCheckUpdates 白名单 patch。
8. update-service 编排（注入假 downloader/checksum/net）：跳过版本仅影响自动、24h 节流、checksum 失败删文件、install-state 各启动分支。

**CDP 真机走查（本地 serve-update）：**

1. 伪造 99.0.0 清单 + 任意小 exe（哈希正确）：自动通知弹窗内容（版本/说明/大小）；稍后→不再弹（同次运行）；跳过→重启自动检查不弹、手动检查能看到。
2. 下载进度显示、取消后再次下载从断点继续（用日志服务器观察 Range 起始字节）。
3. 篡改包哈希场景：verifying→checksum-mismatch 错误态、文件被删。
4. ready 后安装确认弹窗文案/取消保留；**不真实退出安装**（走查到调 install 前打桩返回，或用 dev 拦截 install）。
5. 守护脚本演练：临时目录 + 假"安装程序"（成功 exe：写新文件/退出码 0；失败 exe：退出码 1）两种模式，实际执行 guardian.ps1，验证：备份目录生成、成功后状态 done+新版本文件、失败后回滚旧文件+状态 failed；不触碰真实安装目录。
6. 走完 tsc 0、全量 vitest、console error 0；清理测试文件。

## 11. 受影响文件清单（预计）

新增：`shared/update-manifest.ts`、`shared/update-config.ts`、`electron/main/update/{downloader,checksum,guardian-script}.ts`、`electron/main/services/update-service.ts`、`src/renderer/update/update-modal.tsx`、`scripts/build-update-manifest.ps1`、`scripts/serve-update.ps1`、对应 tests/ 下 8 个测试文件。

修改：`shared/ipc-contract.ts`、`shared/settings-dto.ts`、`electron/main/settings.ts`、`electron/main/index.ts`（实例化服务、启动自动检查/状态读取）、`electron/main/ipc/index.ts`（注册）、`electron/preload/index.ts`、`src/renderer/App.tsx`（挂弹窗）、`src/renderer/pages/about.tsx`。

版本号来源定为：主进程比较版本一律用 `app.getVersion()`（electron-builder 从 package.json 注入）；渲染端关于页继续用 `shared/app-info.ts` 的 `APP_VERSION` 常量。新增一个单测断言 `APP_VERSION === package.json.version`，防止手工同步漂移（顺手消除现有双来源隐患）。
