// 更新源配置。按优先级排列，check() 依次尝试，首个成功即用：
//   1) 国内对象存储镜像（腾讯云 COS）——国内直连快，清单与安装包同源；
//   2) GitHub Releases 的 latest 稳定地址（302 到 CDN，公开仓库免认证）——兜底。
// 清单 {base}/latest.json；安装包 {base}/TemplatePrint-<version>-Setup-x64.msi
// 仅 dev 构建允许环境变量 TP_UPDATE_BASE_URL 覆盖（本地 scripts/serve-update.ps1 走查用）；
// 打包构建恒用常量，防止被篡改指向恶意源。
const GITHUB_UPDATE_BASE_URL = 'https://github.com/shine-apps/template-print/releases/latest/download/'

// TODO(国内镜像): 建好 COS 桶后把这里换成真实桶域名（bucket 含 APPID），例如
//   'https://template-print-1250000000.cos.ap-shanghai.myqcloud.com/'
// 未替换时该源会立即失败（.invalid 是保留域，永不解析），自动回退 GitHub，不影响更新。
const COS_UPDATE_BASE_URL = 'https://template-print-1253321869.cos.ap-shanghai.myqcloud.com'

const env = (import.meta as { env?: Record<string, string | undefined> }).env
const isDev = !!env?.DEV
const envOverride = env?.TP_UPDATE_BASE_URL

/** 候选更新源（已按优先级排序；dev 覆盖时只走覆盖源） */
export const UPDATE_BASE_URLS: readonly string[] =
  isDev && envOverride ? [envOverride] : [COS_UPDATE_BASE_URL, GITHUB_UPDATE_BASE_URL]

// 更新请求统一携带的 Referer，配合 COS 防盗链（Referer 白名单 + 拒绝空 Referer）
// 使清单与安装包只能被本程序下载；这是可被伪造的弱门槛，不要当强鉴权用。
const UPDATE_REQUEST_REFERER = 'https://dl.templateprint.app/'

/** 更新请求（拉清单、下载安装包）统一携带的请求头 */
export function updateRequestHeaders(): Record<string, string> {
  return { Referer: UPDATE_REQUEST_REFERER }
}
