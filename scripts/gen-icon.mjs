// 由 build/icon.png 生成多尺寸 build/icon.ico（16/24/32/48/64/128/256）。
// 利用 Electron/Chromium 的 canvas 做高质量缩放，再封装为标准 ICO（PNG 压缩条目，Vista+）。
// 用法：先 `npm run dev` 启动应用（开 --remote-debugging-port=9223），再 `npm run gen:icon`。
import fs from 'node:fs'

const SRC = 'd:/projects/template-print/build/icon.png'
const OUT = 'd:/projects/template-print/build/icon.ico'
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const wsUrl = targets.find((t) => t.type === 'page' && t.url.includes('index.html'))?.webSocketDebuggerUrl
if (!wsUrl) throw new Error('未找到可连接的页面；请先用 --remote-debugging-port=9223 启动应用')
const ws = new WebSocket(wsUrl)
let mid = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++mid; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
})
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Runtime.enable')

const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    const img = new Image()
    img.src = 'file:///${SRC.replace(/\\/g, '/')}'
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
    const out = {}
    for (const s of ${JSON.stringify(SIZES)}) {
      const c = document.createElement('canvas'); c.width = s; c.height = s
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, s, s)
      out[s] = c.toDataURL('image/png')
    }
    return out
  })()`,
  awaitPromise: true,
  returnByValue: true
})
if (r.exceptionDetails) throw new Error('canvas error: ' + r.exceptionDetails.text)

const png = {}
for (const s of SIZES) png[s] = Buffer.from(r.result.value[s].split(',')[1], 'base64')

const headerSize = 6 + 16 * SIZES.length
const offsets = {}
let off = headerSize
for (const s of SIZES) { offsets[s] = off; off += png[s].length }

const header = Buffer.alloc(headerSize)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(SIZES.length, 4)
let p = 6
for (const s of SIZES) {
  header.writeUInt8(s >= 256 ? 0 : s, p)
  header.writeUInt8(s >= 256 ? 0 : s, p + 1)
  header.writeUInt8(0, p + 2)
  header.writeUInt8(0, p + 3)
  header.writeUInt16LE(1, p + 4)
  header.writeUInt16LE(32, p + 6)
  header.writeUInt32LE(png[s].length, p + 8)
  header.writeUInt32LE(offsets[s], p + 12)
  p += 16
}
fs.writeFileSync(OUT, Buffer.concat([header, ...SIZES.map((s) => png[s])]))
console.log('generated', OUT, SIZES.length, 'sizes')
ws.close()
