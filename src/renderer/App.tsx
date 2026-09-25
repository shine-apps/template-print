import { ConfigProvider, Layout, Menu } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { TemplatesPage } from './pages/templates'
import { DesignerPage } from './pages/designer'
import { PrintPage } from './pages/print'
import { HistoryPage } from './pages/history'
import { SettingsPage } from './pages/settings'

const { Sider, Content } = Layout

function Shell(): JSX.Element {
  const nav = useNavigate()
  const loc = useLocation()
  const selected = loc.pathname.startsWith('/history') ? '/history'
    : loc.pathname.startsWith('/settings') ? '/settings'
    : loc.pathname.startsWith('/designer') ? '/designer'
    : '/templates'
  return (
    <Layout style={{ height: '100vh' }}>
      <Sider theme="dark" width={150}>
        <div style={{ color: '#fff', fontWeight: 700, textAlign: 'left', padding: '16px 10px', fontSize: 18 }}>模板打印</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          onClick={(e) => nav(e.key)}
          items={[
            { key: '/templates', label: '模板列表' },
            { key: '/designer', label: '模板设计' },
            { key: '/history', label: '打印历史' },
            { key: '/settings', label: '打印机设置' }
          ]}
        />
      </Sider>
      <Content style={{ background: '#f5f5f5' }}>
        <Routes>
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/designer/:id" element={<DesignerPage />} />
          <Route path="/designer" element={<DesignerPage />} />
          <Route path="/print/:id" element={<PrintPage />} />
          <Route path="/print" element={<PrintPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/templates" replace />} />
        </Routes>
      </Content>
    </Layout>
  )
}

export function App(): JSX.Element {
  return (
    <ConfigProvider locale={zhCN}>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ConfigProvider>
  )
}
