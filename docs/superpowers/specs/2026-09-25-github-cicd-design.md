# GitHub CI/CD 自动化发布与更新对接设计（2026-09-25）

## 1. 目标与约束

- 每次推送 main / PR 自动跑类型检查与全量测试（质量门禁）。
- 推送语义化 tag（v*）自动完成 Windows NSIS 打包、生成更新清单、发布 GitHub Release；也支持 Actions 页手动触发。
- Release 资产（Setup exe + latest.json）即自动更新源，客户端把 `UPDATE_BASE_URL` 指向 GitHub Releases 的稳定 latest 下载地址，零服务器、零额外密钥。
- 发布说明单一来源：仓库根目录 `RELEASE_NOTES.md`，CI 抽取当前版本段落，同时用于 latest.json 的 releaseNotes 与 Release 页面正文。
- 用户拥有发版控制权：只有推 tag（或手动 dispatch）才发布；不做 main 提交自动发版、不做自动累加版本号。

仓库事实：`github.com/shine-apps/template-print`（public），仅 main 分支，无现存 workflow，gh 已登录，有 package-lock.json（可用 npm ci）。electron-builder 产物当前名为 `TemplatePrint 0.1.0.exe`（含空格）。

不做（YAGNI）：代码签名（保持现状，将来购证后加 secrets）、COS 双传、beta 预发布通道、自动 bump 版本、macOS/Linux。

## 2. 工作流一：`.github/workflows/ci.yml`

- 触发：push 到 main、所有 pull_request。
- runs-on：windows-latest（项目含 PowerShell 相关主进程代码与测试，与目标平台一致）。
- 步骤：checkout@v4 → setup-node@v4（node-version 24、cache npm）→ `npm ci` → `npm run typecheck` → `npx vitest run`。
- concurrency group `ci-${{ github.ref }}` + cancel-in-progress，取消同一引用的冗余运行。
- permissions: contents: read（最小权限）。

## 3. 工作流二：`.github/workflows/release.yml`

- 触发：
  - push tags `v*`（形如 `v0.2.0`，正则 `^v\d+\.\d+\.\d+$` 校验）；
  - workflow_dispatch，输入 `version`（不含 v）；此时不要求 tag 已存在，action-gh-release 会以当前提交创建该 tag。
- permissions: contents: write（创建 Release/标签所需；不授其他权限）。
- 环境变量推导（PowerShell 步骤写 $GITHUB_ENV）：
  - tag 触发：`TAG=${GITHUB_REF_NAME}`；手动：`TAG=v<input.version>`；
  - `VERSION=${TAG#v}`。
- 步骤：
  1. checkout@v4（普通深度即可）。
  2. setup-node@v4（24 + npm 缓存）、`npm ci`。
  3. **版本一致性校验** `node scripts/release/check-version.mjs %VERSION%`：VERSION 必须同时等于 package.json#version 与 shared/app-info.ts 的 APP_VERSION，否则失败退出（防止 tag 与代码版本错配）。
  4. `npm run typecheck`、`npx vitest run`（发布前再跑一次门禁）。
  5. `npx electron-vite build`。
  6. `npx electron-builder --win nsis`（CI 网络直连 GitHub，不用本地 npmmirror 镜像；better-sqlite3 为 N-API 包内预编译、npmRebuild:false，无需构建工具链）。
  7. `node scripts/release/prepare-notes.mjs %VERSION%`：从 RELEASE_NOTES.md 抽取该版本段落写入 `release/release-notes.txt`（段落缺失则失败）。
  8. `powershell -File scripts/build-update-manifest.ps1`：扫描 release 下 Setup exe，算 size/SHA256，结合 release-notes.txt 生成 `release/latest.json`。
  9. `softprops/action-gh-release@v2`：tag_name=$TAG、name=`模板打印 v$VERSION`、body_path=release/release-notes.txt、files=`release/*Setup*x64.exe`、`release/latest.json`；同 tag 重跑幂等覆盖（不额外上传 blockmap，latest.json 只引用 exe；YAGNI）。
- 不配置 electron/electron-builder 额外缓存（首版 YAGNI；npm 缓存已能覆盖依赖；后续慢再加 actions/cache）。

## 4. 打包命名固定

electron-builder.yml 顶层增加：

```yaml
artifactName: ${productName}-${version}-Setup-${arch}.${ext}
```

产物变为 `TemplatePrint-0.2.0-Setup-x64.exe`（无空格、含架构）：与清单脚本 `*Setup*x64.exe` 过滤一致、URL 无需编码、与更新清单设计中的命名一致；不改变 NSIS 安装行为与 appId。

## 5. 客户端对接

`shared/update-config.ts` 默认地址改为：

```
https://github.com/shine-apps/template-print/releases/latest/download/
```

- 清单：`…/latest/download/latest.json`；安装包：`…/latest/download/TemplatePrint-0.2.0-Setup-x64.exe`。
- GitHub 对该路径 302 到 objects.githubusercontent.com CDN；Electron net 自动跟随跳转；公开仓库免认证。
- dev 覆盖机制（TP_UPDATE_BASE_URL，仅 DEV）保留，本地 serve-update.ps1 走查方式不变（启动时带该环境变量）。

## 6. RELEASE_NOTES.md 与抽取脚本

根目录 `RELEASE_NOTES.md` 按版本倒序分节：

```markdown
# 发布记录

## 0.2.0（2026-09-25）

- 新增：……
- 修复：……

## 0.1.0（2026-09-25）

- ……
```

- 纯函数 `extractReleaseNotes(markdown, version)`（scripts/release/notes.mjs）：定位 `## <version>` 标题行（允许行尾括号日期/其他文字，按版本号精确匹配），取到下一个同级 `## ` 或文件末尾，trim 后返回；找不到返回 null。附 vitest 单测。
- `scripts/release/prepare-notes.mjs <version>`：调用纯函数，null 则报错退出；写入 release/release-notes.txt（UTF-8 无 BOM，复用清单脚本读取）。
- `scripts/release/check-version.mjs <version>`：读 package.json 与 app-info.ts 正则提取 APP_VERSION，三者一致 exit 0 否则 exit 1。

## 7. 发布操作手册 `docs/RELEASE.md`

标准发版步骤：
1. 改 package.json#version；同步 shared/app-info.ts 的 APP_VERSION（有单测与 CI 校验把关）。
2. RELEASE_NOTES.md 顶部新增版本段落。
3. 提交 main 并推送（CI 必须绿）。
4. `git tag vX.Y.Z` → `git push origin vX.Y.Z`；release 流水线自动完成打包→清单→Release。
5. 安装旧版客户端验证自动检查能发现新版；或直接访问 Release 页面。
紧急重发同版本：删 Release 资产后重跑 workflow（action-gh-release 幂等覆盖）。

## 8. 验证策略

- CI 环境无法本地完整模拟：YAML 经语法/逻辑审查；所有可离线验证的逻辑下沉为 Node 脚本并加单测：
  - notes.mjs：命中、行尾日期、缺失版本、多版本取对段落、trim。
  - check-version.mjs：用临时目录构造（或直接对当前仓库跑：传当前 0.1.0 应成功）。
- 本地实跑：prepare-notes（0.1.0 段落）→ build-update-manifest.ps1 生成 latest.json，核对字段；tsc 0；全量 vitest 绿。
- 推送 workflow 文件后观察 CI 在 main 上真实通过。
- 首个 release tag 的推送时机由用户决定（不擅自发版）；推送后按 docs/RELEASE.md 验证 Release 资产与 latest.json 可下载。

## 9. 受影响文件

新增：`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`RELEASE_NOTES.md`、`docs/RELEASE.md`、`scripts/release/notes.mjs`、`scripts/release/prepare-notes.mjs`、`scripts/release/check-version.mjs`、`tests/release/notes.test.ts`。
修改：`electron-builder.yml`（artifactName）、`shared/update-config.ts`（默认 URL）。
