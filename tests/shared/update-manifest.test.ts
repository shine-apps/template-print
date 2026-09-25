import { describe, it, expect } from 'vitest'
import {
  UpdateManifestSchema,
  compareVersions,
  resolveDownloadUrl,
  formatBytes
} from '../../shared/update-manifest'

const valid = {
  version: '0.2.0',
  releaseDate: '2026-09-25',
  releaseNotes: '修复若干问题',
  url: 'TemplatePrint-0.2.0-Setup-x64.exe',
  size: 123456789,
  sha256: 'a'.repeat(64)
}

describe('UpdateManifestSchema', () => {
  it('合法清单通过', () => {
    expect(UpdateManifestSchema.parse(valid).version).toBe('0.2.0')
  })
  it('releaseDate/releaseNotes/size 缺省时给默认/可选', () => {
    const m = UpdateManifestSchema.parse({ version: '1.0', url: 'a.exe', sha256: 'A'.repeat(64) })
    expect(m.releaseNotes).toBe('')
    expect(m.size).toBeUndefined()
  })
  it('sha256 非64位hex 拒绝', () => {
    expect(UpdateManifestSchema.safeParse({ ...valid, sha256: 'abc' }).success).toBe(false)
  })
  it('version/url 为空拒绝', () => {
    expect(UpdateManifestSchema.safeParse({ ...valid, version: '' }).success).toBe(false)
    expect(UpdateManifestSchema.safeParse({ ...valid, url: '' }).success).toBe(false)
  })
})

describe('compareVersions', () => {
  it('相等/主次比较', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1)
    expect(compareVersions('0.9', '1.0')).toBe(-1)
  })
  it('数字段按数值比较：0.10.0 > 0.9.0', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
  })
  it('缺段补 0；非数字段按 0', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.x', '1.0.0')).toBe(0)
  })
})

describe('resolveDownloadUrl', () => {
  it('绝对 http(s) URL 原样返回', () => {
    expect(resolveDownloadUrl('http://x/y/', 'https://cdn/a.exe')).toBe('https://cdn/a.exe')
  })
  it('相对路径拼 base，正确处理斜杠', () => {
    expect(resolveDownloadUrl('http://127.0.0.1:8765/', 'a.exe')).toBe('http://127.0.0.1:8765/a.exe')
    expect(resolveDownloadUrl('http://127.0.0.1:8765/rel', '/a.exe')).toBe('http://127.0.0.1:8765/rel/a.exe')
  })
})

describe('formatBytes', () => {
  it('按 MB/GB 格式化', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(1073741824)).toBe('1.00 GB')
  })
})
