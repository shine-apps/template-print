import { useEffect, useState } from 'react'
import { Modal, Progress, Button, Space, Typography, message } from 'antd'
import {
  formatBytes,
  type UpdateManifest,
  type CheckResultPayload,
  type UpdateProgressPayload,
  type InstallFailedPayload
} from '../../../shared/update-manifest'

const { Paragraph, Text } = Typography

type View =
  | { kind: 'closed' }
  | { kind: 'notice'; manifest: UpdateManifest }
  | { kind: 'downloading'; downloaded: number; total: number | null; bytesPerMs: number }
  | { kind: 'verifying' }
  | { kind: 'error'; reason: string }

/** 守护脚本/服务端原因码 → 中文说明 */
const REASON_TEXT: Record<string, string> = {
  'net-error': '无法连接更新服务器，请检查网络后重试。',
  'bad-manifest': '更新信息异常，请联系开发者。',
  'download-failed': '下载失败，已保留进度，可重试断点续传。',
  'size-mismatch': '安装包下载不完整，请重新下载。',
  'checksum-mismatch': '安装包已损坏或被篡改，已自动删除，请勿在非官方渠道获取更新。',
  'no-manifest': '尚未获取到更新信息，请先检查更新。',
  interrupted: '上次更新未完成（程序被中断），已恢复到旧版本。',
  'wait-process-timeout': '安装失败：程序未能正常退出。请重启电脑后重新更新。',
  'backup-failed': '安装失败：无法创建备份，请检查磁盘空间和文件夹权限。',
  'installer-failed': '安装失败，已自动恢复到旧版本。如反复出现，请暂时关闭杀毒软件后重试。',
  'verify-failed': '安装后版本校验失败，已自动恢复到旧版本。'
}

function reasonText(code: string): string {
  return REASON_TEXT[code] ?? `更新失败（${code}），请联系开发者。`
}

export function UpdateModal(): JSX.Element | null {
  const [view, setView] = useState<View>({ kind: 'closed' })
  const [manifest, setManifest] = useState<UpdateManifest | null>(null)
  const [installFailed, setInstallFailed] = useState<InstallFailedPayload | null>(null)
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false)

  useEffect(() => {
    const offs = [
      window.api.update.on('update:checkResult', (p) => {
        const r = p as CheckResultPayload
        if (r.hasUpdate && r.manifest) {
          setManifest(r.manifest)
          setView({ kind: 'notice', manifest: r.manifest })
        } else if (r.manual) {
          if (r.reason === 'up-to-date') message.success('当前已是最新版本')
          else message.error(reasonText(r.reason ?? 'net-error'))
        }
      }),
      window.api.update.on('update:progress', (p) => {
        const r = p as UpdateProgressPayload
        switch (r.phase) {
          case 'downloading':
            setView({ kind: 'downloading', downloaded: r.downloaded, total: r.total, bytesPerMs: r.bytesPerMs })
            break
          case 'verifying':
            setView({ kind: 'verifying' })
            break
          case 'ready':
            setView({ kind: 'closed' })
            setInstallConfirmOpen(true)
            break
          case 'simulated':
            message.info(`开发环境模拟安装 v${r.version}（未实际退出）`)
            setView({ kind: 'closed' })
            break
          case 'error':
            setView({ kind: 'error', reason: r.reason })
            break
          case 'canceled':
            // 取消后回到更新通知态（.part 已保留，下次可续传）
            setManifest((m) => {
              if (m) setView({ kind: 'notice', manifest: m })
              return m
            })
            break
        }
      }),
      window.api.update.on('update:installFailed', (p) => {
        setInstallFailed(p as InstallFailedPayload)
      }),
      window.api.update.on('update:installed', (p) => {
        message.success(`已更新到 v${(p as { version: string }).version}`)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const startDownload = (): void => {
    setView({ kind: 'downloading', downloaded: 0, total: null, bytesPerMs: 0 })
    void window.api.update.download()
  }

  const percent = view.kind === 'downloading' && view.total
    ? Math.min(100, Math.round((view.downloaded / view.total) * 100))
    : null

  return (
    <>
      <Modal
        title={view.kind === 'notice' ? `发现新版本 v${view.manifest.version}` : '软件更新'}
        open={view.kind !== 'closed'}
        footer={null}
        maskClosable={false}
        width={520}
        onCancel={() => setView({ kind: 'closed' })}
      >
        {view.kind === 'notice' && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {view.manifest.releaseDate && <Text type="secondary">发布日期：{view.manifest.releaseDate}</Text>}
            <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0, maxHeight: 220, overflow: 'auto' }}>
              {view.manifest.releaseNotes || '本次更新包含稳定性与体验优化。'}
            </Paragraph>
            <Text type="secondary">
              安装包大小：{view.manifest.size !== undefined ? formatBytes(view.manifest.size) : '未知'}
            </Text>
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button type="primary" onClick={startDownload}>立即更新</Button>
              <Button onClick={() => setView({ kind: 'closed' })}>稍后更新</Button>
              <Button type="link" danger onClick={() => {
                void window.api.update.skipVersion(view.manifest.version).then(() => {
                  // 通知关于页等设置消费者刷新（跳过状态由主进程写入 settings.json）
                  window.dispatchEvent(new Event('tp:settings-changed'))
                })
                message.info(`已跳过 v${view.manifest.version}，可在"关于我们"中恢复检查`)
                setView({ kind: 'closed' })
              }}>跳过此版本</Button>
            </Space>
          </Space>
        )}

        {view.kind === 'downloading' && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Progress percent={percent ?? undefined} status="active" showInfo={percent !== null} />
            {percent === null && <Text type="secondary">正在下载…</Text>}
            <Text type="secondary">
              已下载 {formatBytes(view.downloaded)}
              {view.total !== null ? ` / ${formatBytes(view.total)}` : ''}
              {view.bytesPerMs > 0 && ` · ${(view.bytesPerMs * 1000 / 1048576).toFixed(1)} MB/s`}
            </Text>
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button onClick={() => void window.api.update.cancel()}>取消（保留进度）</Button>
            </Space>
          </Space>
        )}

        {view.kind === 'verifying' && (
          <Space direction="vertical" size={8}>
            <Progress percent={100} status="active" showInfo={false} />
            <Text>正在校验安装包完整性，请稍候…</Text>
          </Space>
        )}

        {view.kind === 'error' && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="danger">{reasonText(view.reason)}</Text>
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              {manifest && <Button type="primary" onClick={startDownload}>重试</Button>}
              <Button onClick={() => setView({ kind: 'closed' })}>稍后</Button>
            </Space>
          </Space>
        )}
      </Modal>

      <Modal
        title="准备安装更新"
        open={installConfirmOpen}
        okText="立即安装并重启"
        cancelText="取消"
        onOk={() => {
          setInstallConfirmOpen(false)
          void window.api.update.install()
        }}
        onCancel={() => setInstallConfirmOpen(false)}
      >
        <Paragraph>
          即将退出程序并运行安装程序，安装约需 1 分钟，期间请勿关机或断电。
        </Paragraph>
        <Paragraph type="warning" style={{ marginBottom: 0 }}>
          如出现「用户账户控制（UAC）」提示，请点击「是」。点击取消则安装包已保留，可稍后重新安装。
        </Paragraph>
      </Modal>

      <Modal
        title="更新失败，已恢复到旧版本"
        open={!!installFailed}
        footer={null}
        onCancel={() => setInstallFailed(null)}
      >
        {installFailed && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text>从 v{installFailed.from} 升级到 v{installFailed.to} 失败。</Text>
            <Text type="danger">{reasonText(installFailed.reason)}</Text>
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button onClick={() => void window.api.update.openLogDir()}>打开更新日志目录</Button>
              <Button type="primary" onClick={() => setInstallFailed(null)}>我知道了</Button>
            </Space>
          </Space>
        )}
      </Modal>
    </>
  )
}
