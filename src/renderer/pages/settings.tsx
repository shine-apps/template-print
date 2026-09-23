import { useEffect, useState } from 'react'
import { Button, Card, Space, Tag, message } from 'antd'
import { api } from '../api'
import type { PrinterInfoDto } from '../../../shared/ipc-contract'

export function SettingsPage(): JSX.Element {
  const [printers, setPrinters] = useState<PrinterInfoDto[]>([])
  const [appDefault, setAppDefault] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const [list, d] = await Promise.all([api.printers.list(), api.printers.getDefault()])
    setPrinters(list)
    setAppDefault(d)
  }
  useEffect(() => { void refresh() }, [])

  async function setDefault(name: string): Promise<void> {
    await api.printers.setDefault(name)
    setAppDefault(name)
    message.success(`已将“${name}”设为应用默认打印机`)
  }
  async function testPage(name: string): Promise<void> {
    await api.printers.testPage(name)
    message.success('测试页任务已发送')
  }

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <h3>打印机设置</h3>
      <Space direction="vertical" style={{ width: '100%' }}>
        {printers.map((p) => (
          <Card key={p.name} size="small">
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                <strong>{p.name}</strong>
                {p.isDefault && <Tag>系统默认</Tag>}
                {appDefault === p.name && <Tag color="blue">应用默认</Tag>}
              </Space>
              <Space>
                {appDefault !== p.name && <Button size="small" onClick={() => setDefault(p.name)}>设为应用默认</Button>}
                <Button size="small" onClick={() => testPage(p.name)}>打印测试页</Button>
              </Space>
            </Space>
          </Card>
        ))}
        {printers.length === 0 && <Card size="small">未检测到打印机，请先在 Windows 中安装打印机。</Card>}
      </Space>
      <p style={{ color: '#888', marginTop: 12 }}>
        应用默认打印机用于新建模板的默认输出目标；系统默认打印机由 Windows 设置决定。
      </p>
    </div>
  )
}
