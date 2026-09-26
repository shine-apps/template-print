import React from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'
import { App } from './App'
import logoUrl from './assets/logo.png'

// 设置页面 favicon（与应用图标一致；Electron 无标签页，主要用于 Alt+Tab 预览与一致性）
const link = document.createElement('link')
link.rel = 'icon'
link.href = logoUrl
document.head.appendChild(link)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
