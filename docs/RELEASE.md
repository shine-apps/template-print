# 发布手册（GitHub CI/CD）

本项目发版由 GitHub Actions 自动完成：推 tag 即打包、生成更新清单、发布 GitHub Release。
Release 资产（Setup exe + latest.json）即客户端自动更新源，无需任何服务器。

## 一、标准发版步骤

1. **改版本号（两处必须一致）**
   - `package.json` 的 `version`
   - `shared/app-info.ts` 的 `APP_VERSION`

   CI 会校验二者与 tag 一致（有单测 `tests/shared/app-version.test.ts` 与发布流水线双重把关）。

2. **写发布说明**：在 `RELEASE_NOTES.md` 顶部（`# 发布记录` 标题下）新增一节：

   ```markdown
   ## 0.2.0（2026-09-28）

   - 新增：……
   - 修复：……
   ```

3. **提交并推送 main**，等 CI（typecheck + vitest）变绿：
   <https://github.com/shine-apps/template-print/actions>

4. **打 tag 并推送**（这一步触发发布）：

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

   Release 流水线（windows-latest）会自动：版本校验 → 测试 → electron-vite build → electron-builder 打 NSIS 包 → 抽取发布说明 → 计算 size/SHA256 生成 latest.json → 创建/更新 GitHub Release。

5. **验证发布**
   - Release 页面出现 `v0.2.0`，含 `TemplatePrint-0.2.0-Setup-x64.exe` 与 `latest.json`：
     <https://github.com/shine-apps/template-print/releases>
   - 浏览器访问 <https://github.com/shine-apps/template-print/releases/latest/download/latest.json> 应能下载到清单（自动 302）。
   - 安装旧版客户端，在「关于我们 → 检查更新」确认能发现新版（自动检查为每日一次，可手动触发）。

## 二、手动触发（不打 tag 时）

Actions 页 → 选择 **Release** workflow → Run workflow → 输入版本号（如 `0.2.0`，须已与代码一致）。
action-gh-release 会以当前提交创建对应 tag 与 Release。日常发版仍推荐走 git tag，便于在历史中定位版本锚点。

## 三、重发/修补同一版本

- 同一 tag 重跑 Release workflow：Release 与资产幂等覆盖。
- 安装包内容有变化时务必重新核对 latest.json 中的 sha256（CI 自动重算）。

## 四、更新源地址（已内置，无需配置）

- 清单：`https://github.com/shine-apps/template-print/releases/latest/download/latest.json`
- 安装包：`https://github.com/shine-apps/template-print/releases/latest/download/TemplatePrint-<version>-Setup-x64.exe`

本地开发走查时可用环境变量覆盖（仅 dev 构建生效）：`TP_UPDATE_BASE_URL=http://127.0.0.1:8765/`，
配合 `scripts/serve-update.ps1` 提供本地 Range 静态服务器。

## 五、注意事项

- 当前安装包无代码签名，用户安装时可能看到 Windows SmartScreen 提示（与现状一致）；将来购买代码签名证书后，在仓库 Settings → Secrets 配置证书与密码并在 release.yml 中接入 electron-builder 签名即可。
- 版本号遵循 `X.Y.Z` 数字语义化格式（客户端按数字段比较，`0.10.0 > 0.9.0`）。
- 仓库为公开仓库，Release 资产任何人可下载，请勿在发布说明中包含私密信息。
