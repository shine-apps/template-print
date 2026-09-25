/**
 * 从 RELEASE_NOTES.md 抽取指定版本的发布说明段落（纯函数，可单测）。
 * 标题格式：## 0.2.0（2026-09-25）  —— 行尾允许日期等附加文字，按版本号精确匹配。
 * 段落范围：该标题行之后到下一个二级标题（## ）之前，或文件末尾。
 */
export function extractReleaseNotes(markdown, version) {
  if (typeof markdown !== 'string' || !version) return null
  const lines = markdown.split(/\r?\n/)
  // 版本号边界：后一个字符不能是数字或点（保证 0.2 不命中 0.2.0），其余字符（空格、全角括号、行尾等）均可
  const heading = new RegExp(`^##\\s+${escapeRegExp(version)}(?![0-9.])`)
  const start = lines.findIndex((l) => heading.test(l.trim()))
  if (start === -1) return null
  const body = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) break
    body.push(lines[i])
  }
  const text = body.join('\n').trim()
  return text.length ? text : null
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
