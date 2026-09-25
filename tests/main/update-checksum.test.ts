import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { sha256File, verifySha256 } from '../../electron/main/update/checksum'

let dir: string
beforeEach(() => {
  dir = join(tmpdir(), `tp-checksum-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
})

const content = Buffer.from('template-print update checksum fixture\n'.repeat(1000))
const expectedHash = createHash('sha256').update(content).digest('hex')

describe('sha256File', () => {
  it('输出与 crypto 一致的小写 hex', async () => {
    const f = join(dir, 'a.bin')
    writeFileSync(f, content)
    expect(await sha256File(f)).toBe(expectedHash)
  })
})

describe('verifySha256', () => {
  it('匹配通过（大小写不敏感）', async () => {
    const f = join(dir, 'b.bin')
    writeFileSync(f, content)
    expect(await verifySha256(f, expectedHash.toUpperCase())).toBe(true)
  })
  it('内容被改 → false', async () => {
    const f = join(dir, 'c.bin')
    writeFileSync(f, 'tampered')
    expect(await verifySha256(f, expectedHash)).toBe(false)
  })
})
