import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Modal, Select, Space, Tag, message } from 'antd'
import dayjs from 'dayjs'
import { api } from '../api'
import type { PrinterInfoDto, PrinterRuntimeStatus } from '../../../shared/ipc-contract'

const STATUS_META: Record<PrinterRuntimeStatus, { color: string; text: string }> = {
  ready: { color: '#52c41a', text: '就绪' },
  offline: { color: '#8c8c8c', text: '离线' },
  'paper-out': { color: '#faad14', text: '缺纸/耗材' },
  error: { color: '#ff4d4f', text: '异常' },
  unknown: { color: '#bfbfbf', text: '状态未知' }
}

export function HistoryCard(): JSX.Element {
  const [count, setCount] = useState(0)
  const [days, setDays] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshCount = useCallback(() => { void api.jobs.count().then(setCount) }, [])
  useEffect(() => {
    refreshCount()
    void api.settings.get().then((s) => setDays(s.historyRetentionDays))
  }, [refreshCount])

  async function saveDays(v: number | null): Promise<void> {
    setDays(v)
    await api.settings.set({ historyRetentionDays: v })
    message.success('保留设置已保存；下次启动时自动清理')
  }
  async function doCleanup(olderThanDays?: number): Promise<void> {
    setBusy(true)
    try {
      const r = await api.jobs.cleanup({ olderThanDays })
      message.success(`已删除 ${r.deletedJobs} 条记录、${r.deletedThumbs} 张缩略图`)
      refreshCount()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card size="small" title="打印历史" style={{ marginBottom: 12 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <span style={{ color: '#666' }}>当前共 <b>{count}</b> 条打印记录</span>
        <Space wrap>
          <span>自动清理：</span>
          <Select size="small" style={{ width: 150 }} value={days ?? 0}
            onChange={(v: number) => void saveDays(v === 0 ? null : v)}
            options={[
              { value: 0, label: '不自动清理' },
              { value: 30, label: '保留 30 天' },
              { value: 90, label: '保留 90 天' },
              { value: 180, label: '保留 180 天' },
              { value: 365, label: '保留 1 年' }
            ]} />
        </Space>
        <Space wrap>
          <Button size="small" loading={busy}
            onClick={() => Modal.confirm({
              title: '清理 90 天前的记录？',
              content: '将同时删除对应的缩略图文件，此操作不可恢复。',
              okText: '清理', okButtonProps: { danger: true }, cancelText: '取消',
              onOk: () => doCleanup(90)
            })}>清理 90 天前</Button>
          <Button size="small" loading={busy}
            onClick={() => Modal.confirm({
              title: '清空全部打印历史？',
              content: '将删除所有记录与缩略图，此操作不可恢复。',
              okText: '全部清空', okButtonProps: { danger: true }, cancelText: '取消',
              onOk: () => doCleanup()
            })}>清空全部</Button>
        </Space>
      </Space>
    </Card>
  )
}

export function BackupCard(): JSX.Element {
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void api.settings.get().then((s) => setLastAt(s.lastBackupAt)) }, [])
  return (
    <Card size="small" title="数据备份" style={{ marginBottom: 12 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <span style={{ color: '#666' }}>
          上次自动备份：{lastAt ? dayjs(lastAt).format('YYYY-MM-DD HH:mm') : '尚未备份'}（每天首次启动自动备份，保留最近 7 份）
        </span>
        <Alert type="info" showIcon style={{ marginTop: 4 }} message="备份内容说明（单个 zip 压缩包，可整体拷贝到其他电脑恢复）" description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>包含您创建和导入的全部模板</b>（版式设计、参数定义），<b>也包含系统内置的示例模板</b></li>
            <li>包含打印历史记录，以及模板中插入的<b>图片源文件</b>和<b>应用设置</b>（默认打印机、自动更新开关等）</li>
            <li>不包含打印缩略图（可随打印历史重新生成）和自动更新下载的安装包</li>
          </ul>
        } />
        <Space>
          <Button size="small" type="primary" loading={busy} onClick={async () => {
            setBusy(true)
            try {
              const f = await api.backups.run()
              message.success('备份完成：' + f.split(/[\\/]/).pop())
              setLastAt(Date.now())
            } finally { setBusy(false) }
          }}>立即备份</Button>
          <Button size="small" onClick={() => void api.backups.openDir()}>打开备份目录</Button>
        </Space>
      </Space>
    </Card>
  )
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
      <BackupCard />
      <HistoryCard />
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
