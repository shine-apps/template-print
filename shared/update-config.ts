// 更新源配置。上线时把 DEFAULT_UPDATE_BASE_URL 改为真实 HTTPS（如腾讯云 COS）即可。
// 仅 dev 构建允许环境变量 TP_UPDATE_BASE_URL 覆盖；打包构建恒用常量，防止被篡改指向恶意源。
const DEFAULT_UPDATE_BASE_URL = 'http://127.0.0.1:8765/'

const env = (import.meta as { env?: Record<string, string | undefined> }).env
const isDev = !!env?.DEV
const envOverride = env?.TP_UPDATE_BASE_URL

export const UPDATE_BASE_URL: string = isDev && envOverride ? envOverride : DEFAULT_UPDATE_BASE_URL
