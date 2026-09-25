import { describe, it, expect } from 'vitest'
import { extractReleaseNotes } from '../../scripts/release/notes.mjs'

const md = `# 发布记录

## 0.2.0（2026-09-25）

- 新增：自动更新
- 修复：若干问题

## 0.1.0（2026-09-01）

- 首个版本
`

describe('extractReleaseNotes', () => {
  it('命中版本并去掉标题，返回正文（trim）', () => {
    expect(extractReleaseNotes(md, '0.2.0')).toBe('- 新增：自动更新\n- 修复：若干问题')
  })
  it('支持行尾带日期/其他文字的标题', () => {
    expect(extractReleaseNotes('## 0.1.0 2026-09-01\n首个版本', '0.1.0')).toBe('首个版本')
  })
  it('取到下一个二级标题为止；最后一节到文件末尾', () => {
    expect(extractReleaseNotes(md, '0.1.0')).toBe('- 首个版本')
  })
  it('精确匹配，0.2 不命中 0.2.0', () => {
    expect(extractReleaseNotes(md, '0.2')).toBeNull()
  })
  it('版本不存在 / 空输入 → null', () => {
    expect(extractReleaseNotes(md, '9.9.9')).toBeNull()
    expect(extractReleaseNotes('', '0.1.0')).toBeNull()
    expect(extractReleaseNotes(md, '')).toBeNull()
  })
  it('标题下无正文 → null', () => {
    expect(extractReleaseNotes('## 1.0.0\n\n## 0.9.0\n旧', '1.0.0')).toBeNull()
  })
})
