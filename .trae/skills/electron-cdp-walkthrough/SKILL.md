---
name: electron-cdp-walkthrough
description: Drive the Electron app over CDP for end-to-end UI walkthroughs and print-iframe verification with zero dependencies. Use for CDP 走查、端到端走查、真实应用回归、设计器/打印预览实测. Not for ordinary vitest unit tests.
---

# Electron CDP 走查

对真实 Electron 应用做端到端走查（设计器交互、antd 组件、打印 iframe 输出、console 卫生）。
纯函数单测能覆盖的不要走 CDP；CDP 用于验证**集成接线点**（IPC、React 状态、Chromium 实际渲染）——
本项目文本框走查曾抓到 3 个单测全绿但实际坏掉的 bug，全在接线/渲染层。

全程 Node 24 内置 `WebSocket`/`fetch`，**零依赖**，不要引入 puppeteer/playwright。

## 1. 启动带调试端口的应用（后台任务）

```powershell
npx electron . --remote-debugging-port=9222 --remote-allow-origins=* --disable-features=CalculateNativeWinOcclusion
```

用 Shell 的 `run_in_background` 跑，记下 command_id。**必须带** `--disable-features=CalculateNativeWinOcclusion`：
窗口被遮挡或锁屏时 Chromium 会 `document.hidden=true` 并冻结 rAF/ResizeObserver，
打印预览的 ResizeObserver 不投递 → iframe 永不渲染，现象像应用 bug，实则是测试环境问题。

等 6–8 秒后验证：`Invoke-RestMethod http://127.0.0.1:9222/json/version`。

目标发现：`GET http://127.0.0.1:9222/json`，取 `type==='page'` 且 url 含 `index.html` 的 `webSocketDebuggerUrl`。

## 2. 关键事实（踩过的坑）

- **Electron 不暴露 Browser CDP domain**：`Browser.getWindowForTarget` 返回 -32601。
  窗口最小化时 `Page.bringToFront` 也救不了 visibilityState；用 Win32
  `ShowWindowAsync(hwnd, 9)`（SW_RESTORE）按窗口标题 `模板打印` 精确找进程，别批量杀 electron。
- **Runtime.evaluate 一律 `returnByValue:true`，完成值只能是可 JSON 序列化的原始值**。
  返回 DOM 元素报 `Object reference chain is too long`。waitFor 谓词要返回 `!!el` 而不是 `el`。
- **antd 交互靠可信事件序列**：mousedown → mouseup → click，只派 click 打不开 Select/Dropdown（监听 mousedown）。
- **rc-virtual-list（Select 下拉、长列表）**：脚本赋 `el.scrollTop=N` **不会**触发虚拟化。
  必须 CDP `Input.dispatchMouseEvent({type:'mouseWheel', x, y, deltaY})`（trusted），逐次滚动、逐次采集。
  只渲染可视节点，断言"某分组存在"要遍历多个滚动位置累积；滚回顶部后再点顶部选项（节点已卸载会 undefined）。
- **React 受控 input/textarea**：用原型 `value` setter 赋值再派 `input`+`change` 事件，直接 `.value=` 不生效。
- **React 内联样式经 DOM 读回是 rgb()**：选择器里写 `#1f2937` 匹配不到，用 `rgb(31, 41, 55)` 或结构定位。
- **等待用条件轮询，不要固定长 sleep**（>1s 的 sleep 只在无稳定可观察条件时用一次）：
  等按钮文本、等 `.ant-message-notice-content`、等 iframe `contentDocument.body.children.length`。
- **打印预览 iframe 是 srcDoc 同源**：`iframe.contentDocument` 直接可读；
  用 `defaultView.getComputedStyle` + `Range.getClientRects()` 做字级几何断言（竖排列数/贴边/旋转）。
- **结束时只 StopCommand 自己启动的后台 command_id**。绝不要 `Get-Process electron | Stop-Process -Force`
  —— 宿主 IDE 本身也是 Electron，会被误杀（沙箱也会拒绝）。

## 3. 本项目锚点

- 路由是 HashRouter：`#/templates`、`#/designer/:id`、`#/print/:id`、`#/history`、`#/settings`，直接改 `location.hash` 导航。
- 渲染端 IPC 挂在 `window.api.*`（templates.list/get/save/create/delete、fonts.list、printers.*、settings.*），
  可在页面内直接调用做测试数据准备与断言，比纯点 UI 快且稳。
- **真实数据红线**：模板"测试"和 `builtin-cert/receipt/label` 是用户数据，禁止删除。
  走查模板统一命名 `__CDP_*` 前缀，开场先清残留、结尾再清一次，并 `templates.list()` 核对剩余名单。
- 设计器状态可用 store 直读，但优先走真实 UI（添加元素菜单、属性面板）才能验证接线；
  数据准备/几何造数可直接 `api.templates.create` + 手工拼 content 后 `save`。
- 打印 HTML 断言要点（曾真实回归）：内联 `style="…"` 内字体名只允许**单引号**；
  横排文本内层必须有 `height:100%;overflow:hidden`；竖排必须有 `word-break:break-word`。
  断言不要只 match 源码字符串，用 iframe 内 computed style 验证最终效果。
- 截图存临时目录（如 `%TEMP%/tp-cdp/shots`），逐张用 Read 看图，几何数值 + 截图双重取证。

## 4. 执行步骤

1. 后台启动应用（第 1 节），轮询 `/json/version` 就绪。
2. 复制 `assets/cdp-harness.template.mjs` 到临时目录（**不要放仓库内**），按本次走查目标改 phases。
   模板含：连接/自动发现目标、console error 与 exception 采集、`ev()`、截图、
   页面内 driver（条件等待/可信点击/antd Select 开关/React 赋值）、开场清理与收尾核对。
3. `node <harness>.mjs` 运行；失败先看报告里的 `fatal`/`consoleErrors`/`exceptions`。
   - 报 "Object reference chain is too long" → 某处完成值返回了 DOM，改返回布尔/字符串。
   - 预览 iframe 超时 → 先查 `document.visibilityState`，hidden 说明启动 flag 漏了或窗口最小化。
   - antd 选项 undefined → 虚拟列表节点已卸载，可信滚轮归位后再点。
4. 走查通过后 `npm run typecheck`、`npx vitest run`、必要时 `npm run dist`，再按任务收尾。
5. StopCommand 停应用；删除临时 harness（在 %TEMP% 下即可，随系统清理）。

## 5. 走查脚本应包含的最小产物

- 结构化 `report.json`（每阶段输入/实际值/断言结果），打印到 stdout 并落盘；
- 全程 `Runtime.consoleAPICalled`（type=error）与 `Runtime.exceptionThrown` 计数，末尾必须为 0；
- 关键页面 `Page.captureScreenshot`（png）；
- 开始/结束两次测试数据清理与剩余数据名单；
- 任何"修复后重验"要重新 build（`npx electron-vite build`）并重启应用，out/ 不会热更新。
