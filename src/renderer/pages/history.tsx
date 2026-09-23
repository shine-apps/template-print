import { useEffect, useState } from 'react'
import { Button, DatePicker, Image, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { clearDraft, sessionDraft } from '../session-draft'
import type { JobListItem } from '../../../db/repositories/job-repo'

const { RangePicker } = DatePicker

function Thumb({ path }: { path: string | null }): JSX.Element {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    if (path) void api.thumbUrl(path).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [path])
  if (!path) return <span style={{ color: '#aaa' }}>无</span>
  return <Image width={36} height={Math.round(36 * 1.414)} style={{ objectFit: 'contain' }} src={url} />
}

export function HistoryPage(): JSX.Element {
  const nav = useNavigate()
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [templateId, setTemplateId] = useState<string | undefined>(undefined)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [keyword, setKeyword] = useState('')

  async function refresh(): Promise<void> {
    setJobs(
      await api.jobs.list({
        templateId,
        from: range?.[0] ? range[0].startOf('day').valueOf() : undefined,
        to: range?.[1] ? range[1].endOf('day').valueOf() : undefined,
        keyword: keyword || undefined
      })
    )
  }
  useEffect(() => { void refresh() }, [templateId, range, keyword])
  useEffect(() => {
    void api.templates.list({}).then((ts) => setTemplates(ts.map((t) => ({ id: t.id, name: t.name }))))
  }, [])

  function reprint(job: JobListItem): void {
    clearDraft()
    sessionDraft.doc = job.templateSnapshot
    sessionDraft.paramValues = job.paramValues
    sessionDraft.fromHistory = true
    sessionDraft.returnToPrint = false
    sessionDraft.baselineJson = JSON.stringify(job.templateSnapshot)
    nav('/print')
  }

  const columns: ColumnsType<JobListItem> = [
    { title: '时间', dataIndex: 'createdAt', width: 140, render: (v: number) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '缩略图', dataIndex: 'thumbPath', width: 80, render: (p: string | null) => <Thumb path={p} /> },
    { title: '模板', dataIndex: 'templateNameSnapshot', width: 140 },
    {
      title: '参数摘要', dataIndex: 'paramValues',
      render: (v: Record<string, string>) =>
        Object.entries(v).map(([k, val]) => `${k}=${val}`).join('，') || '—'
    },
    { title: '打印机', dataIndex: 'printerName', width: 160 },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (s: string, r) => {
        if (s === 'success') return <Tag color="green">成功</Tag>
        if (s === 'cancelled') return <Tag>已取消</Tag>
        return <Tooltip title={r.errorMessage ?? ''}><Tag color="red">失败</Tag></Tooltip>
      }
    },
    {
      title: '操作', width: 80,
      render: (_, r) => (
        <Button size="small" type="link" onClick={() => reprint(r)}>
          {r.status === 'failed' ? '重试' : '重打'}
        </Button>
      )
    }
  ]

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear placeholder="全部模板" style={{ width: 160 }} value={templateId}
          onChange={(v) => setTemplateId(v)}
          options={templates.map((t) => ({ value: t.id, label: t.name }))}
        />
        <RangePicker
          value={range as never}
          onChange={(v) => setRange((v as [Dayjs | null, Dayjs | null] | null) ?? null)}
        />
        <Input.Search
          placeholder="搜索参数内容，如：张三" allowClear style={{ width: 220 }}
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
        />
      </Space>
      <Table rowKey="id" size="small" columns={columns} dataSource={jobs} pagination={{ pageSize: 30 }} />
    </div>
  )
}
