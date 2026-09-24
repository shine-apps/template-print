import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  main: {
    // electron-vite 5：externalizeDepsPlugin 已废弃，build.externalizeDeps 默认 true，自动外部化依赖
    build: { rollupOptions: { input: { index: r('electron/main/index.ts') } } }
  },
  preload: {
    build: { rollupOptions: { input: { index: r('electron/preload/index.ts') } } }
  },
  renderer: {
    root: r('src'),
    resolve: {
      alias: {
        '@shared': r('shared'),
        '@core': r('print-core')
      }
    },
    plugins: [react()],
    build: { rollupOptions: { input: { index: r('src/index.html') } } }
  }
})
