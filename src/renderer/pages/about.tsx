import { Card, Space, Tag, Typography } from 'antd'
import { APP_NAME, APP_VERSION } from '../../../shared/app-info'

const { Paragraph, Text } = Typography

export function AboutPage(): JSX.Element {
  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <Card>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space size={12} align="center">
            <strong style={{ fontSize: 20 }}>{APP_NAME}</strong>
            <Tag color="blue">v{APP_VERSION}</Tag>
          </Space>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            可视化模板设计与打印工具：自定义纸张尺寸，文本/图片/图形自由排版，
            参数占位自动填值，支持横排与竖排文本、仅打印文本（预印纸套打）、
            静默/弹框打印、打印历史与数据备份，适配标签机与普通办公打印机。
          </Paragraph>
        </Space>
      </Card>

      <Card size="small" title="开发与支持" style={{ marginTop: 12 }}>
        <Space direction="vertical" size={8}>
          <Space>
            <Text type="secondary" style={{ width: 110, display: 'inline-block' }}>开发公司</Text>
            <Text strong>上海祥和一文化科技有限公司</Text>
          </Space>
          <Space>
            <Text type="secondary" style={{ width: 110, display: 'inline-block' }}>联系人</Text>
            <Text>祥和</Text>
          </Space>
          <Space>
            <Text type="secondary" style={{ width: 110, display: 'inline-block' }}>电话 / 微信</Text>
            <Text copyable={{ text: '13564020007' }}>13564020007</Text>
          </Space>
        </Space>
      </Card>
    </div>
  )
}
