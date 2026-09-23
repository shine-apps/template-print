import { useEffect, useState } from 'react'
import { Button, Card, Space, Tag, message } from 'antd'
import { api } from '../api'
import type { PrinterInfoDto, PrinterRuntimeStatus } from '../../../shared/ipc-contract'

const STATUS_META: Record<PrinterRuntimeStatus, { color: string; text: string }> = {
  ready: { color: '#52c41a', text: '就绪' },
  offline: { color: '#8c8c8c', text: '离线' },
  'paper-out': { color: '#faad14', text: '缺纸/耗材' },
  error: { color: '#ff4d4f', text: '异常' },
  unknown: { color: '#bfbfbf', text: '状态未知' }
}

export function SettingsPage(): JSX.Element {
  const [printers, setPrinters] = useState<PrinterInfoDto[]>([])
  const [appDefault, setAppDefault] = useState<string | null>(null)
  const [statusMap, setStatusMap] = useState<Record<string, PrinterRuntimeStatus>>({})
  const [statusLoading, setStatusLoading] = useState(false)

  async function loadStatus(list: PrinterInfoDto[]): Promise<void> {
    setStatusLoading(true)
    try {
      setStatusMap(await api.printers.status(list.map((p) => p.name)))
    } finally {
      setStatusLoading(false)
    }
  }

  async function refresh(): Promise<void> {
    const [list, d] = await Promise.all([api.printers.list(), api.printers.getDefault()])
    setPrinters(list)
    setAppDefault(d)
    await loadStatus(list)
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
      <Space style={{ justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>打印机设置</h3>
        <Button size="small" loading={statusLoading} onClick={() => void loadStatus(printers)}>刷新状态</Button>
      </Space>
      <Space direction="vertical" style={{ width: '100%' }}>
        {printers.map((p) => {
          const st = statusMap[p.name] ?? 'unknown'
          const m = STATUS_META[st]
          return (
            <Card key={p.name} size="small">
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space>
                  <span title={m.text} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: m.color, marginRight: 6 }} />
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
          )
        })}
        {printers.length === 0 && <Card size="small">未检测到打印机，请先在 Windows 中安装打印机。</Card>}
      </Space>
      <p style={{ color: '#888', marginTop: 12 }}>
        应用默认打印机用于新建模板的默认输出目标；系统默认打印机由 Windows 设置决定。状态每 60 秒刷新一次缓存，灰点表示当前无法获取状态。
      </p>
    </div>
  )
}
