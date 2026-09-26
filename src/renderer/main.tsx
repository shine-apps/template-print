import React from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'
import { App } from './App'
import logoUrl from './assets/logo.png'
import { APP_NAME, APP_VERSION } from '../../shared/app-info'

// 设置页面 favicon（与应用图标一致；Electron 无标签页，主要用于 Alt+Tab 预览与一致性）
const link = document.createElement('link')
link.rel = 'icon'
link.href = logoUrl
document.head.appendChild(link)

// 窗口标题栏显示应用名+版本（渲染端 document.title 会覆盖 BrowserWindow 的 title 选项，故在此设置）
document.title = `${APP_NAME} V${APP_VERSION}`

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
