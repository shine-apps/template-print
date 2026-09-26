import { useEffect, useState } from 'react'
import { Button, Card, Space, Switch, Tag, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { APP_NAME, APP_VERSION } from '../../../shared/app-info'
import type { AppSettingsDto } from '../../../shared/settings-dto'
import logoUrl from '../assets/logo.png'

const { Paragraph, Text } = Typography

export function AboutPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettingsDto | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    const refresh = (): void => { void window.api.settings.get().then(setSettings) }
    // 检查结果由全局更新弹窗展示；这里仅在结果返回后结束 loading
    const off = window.api.update.on('update:checkResult', () => setChecking(false))
    // 更新弹窗写入跳过状态后会广播该事件
    window.addEventListener('tp:settings-changed', refresh)
    return () => {
      off()
      window.removeEventListener('tp:settings-changed', refresh)
    }
  }, [])

  const checkNow = (): void => {
    setChecking(true)
    void window.api.update.check(true)
  }

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <Card>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space size={12} align="center">
            <img src={logoUrl} alt={APP_NAME} style={{ width: 128, height: 128, borderRadius: 12 }} />
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

      <Card size="small" title="版本更新" style={{ marginTop: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space>
            <Button type="primary" icon={<ReloadOutlined />} loading={checking} onClick={checkNow}>
              检查更新
            </Button>
            <Text type="secondary">当前版本 v{APP_VERSION}</Text>
          </Space>
          <Space>
            <Switch
              checked={settings?.autoCheckUpdates ?? true}
              onChange={async (checked) => {
                const next = await window.api.settings.set({ autoCheckUpdates: checked })
                setSettings(next)
                message.success(checked ? '已开启自动检查' : '已关闭自动检查')
              }}
            />
            <Text>自动检查更新（每日启动时检查一次，可随时跳过）</Text>
          </Space>
          {settings?.skippedUpdateVersion && (
            <Space>
              <Text type="secondary">已跳过 v{settings.skippedUpdateVersion}</Text>
              <Button type="link" size="small" onClick={async () => {
                await window.api.update.skipVersion(null)
                setSettings(await window.api.settings.get())
                message.success('已恢复更新提醒')
              }}>恢复检查</Button>
            </Space>
          )}
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
