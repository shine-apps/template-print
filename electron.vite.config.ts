import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: r('electron/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
