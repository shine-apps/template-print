// 更新源配置。生产更新源为 GitHub Releases 的 latest 稳定地址（302 到 CDN，公开仓库免认证）：
//   清单 {base}/latest.json，安装包 {base}/TemplatePrint-<version>-Setup-x64.msi
// 仅 dev 构建允许环境变量 TP_UPDATE_BASE_URL 覆盖（本地 scripts/serve-update.ps1 走查用）；
// 打包构建恒用常量，防止被篡改指向恶意源。
const DEFAULT_UPDATE_BASE_URL = 'https://github.com/shine-apps/template-print/releases/latest/download/'

const env = (import.meta as { env?: Record<string, string | undefined> }).env
const isDev = !!env?.DEV
const envOverride = env?.TP_UPDATE_BASE_URL

export const UPDATE_BASE_URL: string = isDev && envOverride ? envOverride : DEFAULT_UPDATE_BASE_URL
