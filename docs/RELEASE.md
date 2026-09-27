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

   Release 流水线（windows-latest）会自动：版本校验 → 测试 → electron-vite build → electron-builder 打 NSIS/MSI 包 → 抽取发布说明 →（若配置了 COS 镜像则上传安装包与清单）→ 计算 size/SHA256 生成 latest.json → 创建/更新 GitHub Release。

5. **验证发布**
   - Release 页面出现 `v0.2.0`，含 `TemplatePrint-0.2.0-Setup-x64.exe` 与 `latest.json`：
     <https://github.com/shine-apps/template-print/releases>
   - 浏览器访问 <https://github.com/shine-apps/template-print/releases/latest/download/latest.json> 应能下载到清单（自动 302）。
   - 若启用了国内镜像：清单里的 `url` 应是 COS 绝对地址，且该地址浏览器可直接下载（见「五、国内下载镜像」）。
   - 安装旧版客户端，在「关于我们 → 检查更新」确认能发现新版（自动检查为每日一次，可手动触发）。

## 二、手动触发（不打 tag 时）

Actions 页 → 选择 **Release** workflow → Run workflow → 输入版本号（如 `0.2.0`，须已与代码一致）。
action-gh-release 会以当前提交创建对应 tag 与 Release。日常发版仍推荐走 git tag，便于在历史中定位版本锚点。

## 三、重发/修补同一版本

- 同一 tag 重跑 Release workflow：Release 与资产幂等覆盖。
- 安装包内容有变化时务必重新核对 latest.json 中的 sha256（CI 自动重算）。

## 四、更新源地址

客户端按优先级依次尝试候选源（`shared/update-config.ts` 的 `UPDATE_BASE_URLS`），首个能拿到合法 `latest.json` 的源胜出：

1. 国内对象存储镜像（腾讯云 COS）——国内直连快；
2. GitHub Releases 的 latest 稳定地址——兜底。

清单里的 `url` 字段可以是相对路径（相对命中的源解析）或绝对 http(s) 地址；启用镜像后发布流水线写的是 COS 绝对直链，因此安装包尽量从国内下载。未配置镜像时两个源指向同一份 GitHub 清单，行为与历史版本一致。

本地开发走查时可用环境变量覆盖（仅 dev 构建生效，覆盖后只走该源）：`TP_UPDATE_BASE_URL=http://127.0.0.1:8765/`，
配合 `scripts/serve-update.ps1` 提供本地 Range 静态服务器。

## 五、国内下载镜像（可选）

国内直连 GitHub Release 资源（`release-assets.githubusercontent.com`）通常很慢甚至超时，因此发布流水线支持把安装包同步到腾讯云 COS，并让客户端从 COS 直链下载。

### 启用方式（一次性配置）

仓库 Settings → Secrets and variables → Actions 添加四个 secrets：

| Secret | 说明 | 示例 |
|---|---|---|
| `COS_SECRET_ID` | 子账号 SecretId，最小权限即可（目标桶的 `PutObject`，读权限按需） | `AKID...` |
| `COS_SECRET_KEY` | 对应 SecretKey | |
| `COS_BUCKET` | 桶名（含 APPID） | `template-print-1250000000` |
| `COS_REGION` | 地域 | `ap-shanghai` |

未配置时该环节自动跳过，行为与原来完全一致（清单与安装包都走 GitHub Release）。配好后无需改动 workflow。

建好桶后还要把 `shared/update-config.ts` 里的占位常量换成真实桶域名（客户端才会优先走国内源）：

```ts
// shared/update-config.ts
const COS_UPDATE_BASE_URL = 'https://template-print-1250000000.cos.ap-shanghai.myqcloud.com/'
```

占位未替换时该源会立即失败（`.invalid` 是保留域，永不解析），客户端自动回退 GitHub，**不会**把更新流程弄坏；常量属代码改动，随下一次发版生效。

### 行为

- 安装包（`TemplatePrint-<version>-Setup-x64.exe/.msi`）与 `latest.json` 上传到桶根目录，对象 ACL 为 `public-read`（客户端匿名下载，桶若开了「阻止公有访问」需先关闭）。
- 生成的 `latest.json` 中 `url` 为 `https://<COS_BUCKET>.cos.<COS_REGION>.myqcloud.com/TemplatePrint-<version>-Setup-x64.msi`。
- 上传或清单生成任一步失败都会中断流水线，不会发布指向空地址的清单。
- COS 支持 Range 请求，客户端断点续传照常工作。

### 防盗链（可选：让安装包只被本程序下载）

桶若设为公有读，任何拿到链接的人都能下。COS 原生防盗链会校验请求头 `Referer`，客户端已统一携带固定值（`shared/update-config.ts` 的 `UPDATE_REQUEST_REFERER`，默认 `https://dl.templateprint.app/`），清单请求与安装包下载都会带（Electron `net.request` 实测可送达）。

配置：控制台 → 存储桶 → **安全管理 → 防盗链设置** → 开启 → 类型**白名单** → **空 referer 选「拒绝」** → Referer 填 `dl.templateprint.app`（只需字符串匹配，不必真实持有该域名）→ 保存。

- 带签名的请求不做防盗链校验，因此 CI 上传（带签名）不受影响。
- 生效后：浏览器直接打开链接、curl/下载工具、被转发的链接一律 403，只有本程序能下。
- **这是弱门槛**：Referer 是明文，抓包或反编译即可伪造（`curl -H "Referer: dl.templateprint.app"` 就能绕过）。要强制防护只能用签名 URL 或云函数颁发临时凭证。
- **开启顺序很重要**：旧版本客户端不带 Referer，开启后它们从 COS 下载会 403。建议先发一版带 Referer 的客户端，等铺开后再开启防盗链；当前生成的清单 `url` 是 COS 绝对直链，旧版本即使从 GitHub 拿到清单也仍会去下 COS。
- 改 `UPDATE_REQUEST_REFERER` 时要同步改桶白名单，以及 `tests/main/update-downloader.test.ts` 里对该值的断言。

### 手动核对与本地补传

```powershell
# 1) 签名实现自检（无密钥、无网络）
./scripts/upload-to-cos.ps1 -SelfTest

# 2) 先看会传到哪些地址（同样不需要密钥）
$env:COS_BUCKET = 'template-print-1250000000'; $env:COS_REGION = 'ap-shanghai'
./scripts/upload-to-cos.ps1 -Path 'release/latest.json','release/TemplatePrint-0.2.0-Setup-x64.msi' -DryRun

# 3) 真正上传（密钥走环境变量，避免出现在命令行历史里）
$env:COS_SECRET_ID = '...'; $env:COS_SECRET_KEY = '...'
./scripts/upload-to-cos.ps1 -Path 'release/latest.json','release/TemplatePrint-0.2.0-Setup-x64.msi'

# 4) 本地重新生成指向 COS 的清单
powershell -ExecutionPolicy Bypass -File ./scripts/build-update-manifest.ps1 `
  -SetupPath 'release/TemplatePrint-0.2.0-Setup-x64.msi' `
  -AssetBaseUrl 'https://template-print-1250000000.cos.ap-shanghai.myqcloud.com/'
```

上述命令在 PowerShell 5.1 下验证通过（数组参数需直接调用脚本，不要用 `powershell -File` 传逗号列表）。

### 补救历史版本（不发新版也能加速）

老客户端只认 GitHub Release 里的 `latest.json`。把该清单的 `url` 改成 COS 绝对直链再覆盖上传，已发布版本无需更新即可从国内下载：

```bash
gh release download v0.2.0 --pattern latest.json --clobber -O latest.json
# 编辑 latest.json 的 url 为 COS 直链（size/sha256 保持不变）
gh release upload v0.2.0 latest.json --clobber
```

### 已知边界

- **清单也要能拿到才算脱离 GitHub**：替换 `COS_UPDATE_BASE_URL` 后客户端优先从 COS 取清单；未替换、或 COS 上还没有对应清单时自动回退 GitHub，这类用户仍需要能访问 GitHub 才能发现新版本。
- COS 上只有「启用镜像之后发布」的版本资产；更早的版本只有 GitHub 资产（可用上面的「补救历史版本」办法把旧清单的 `url` 指到 COS，前提是那份安装包也在 COS 上）。
- 开启防盗链后，未携带 Referer 的旧版本客户端从 COS 下载会 403（详见「防盗链」小节的开启顺序）。

## 六、注意事项

- 当前安装包无代码签名，用户安装时可能看到 Windows SmartScreen 提示（与现状一致）；将来购买代码签名证书后，在仓库 Settings → Secrets 配置证书与密码并在 release.yml 中接入 electron-builder 签名即可。
- 版本号遵循 `X.Y.Z` 数字语义化格式（客户端按数字段比较，`0.10.0 > 0.9.0`）。
- 仓库为公开仓库，Release 资产任何人可下载，请勿在发布说明中包含私密信息。
