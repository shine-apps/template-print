import { ConfigProvider, Typography } from 'antd'
import zhCN from 'antd/locale/zh_CN'

export function App(): JSX.Element {
  return (
    <ConfigProvider locale={zhCN}>
      <div style={{ padding: 24 }}>
        <Typography.Title level={3}>模板打印 · M1 脚手架就绪</Typography.Title>
      </div>
    </ConfigProvider>
  )
}
