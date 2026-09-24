import { describe, it, expect } from 'vitest'
import { parseFontRegistryEntries, COMMON_FONTS, FALLBACK_FONTS, buildFontList, FontService, type FontListDto } from '../../electron/main/services/font-service'

describe('parseFontRegistryEntries', () => {
  it('去后缀、复合名拆分、去重、去空并排序', () => {
    const out = parseFontRegistryEntries([
      'Microsoft YaHei (TrueType)',
      '宋体 & 新宋体 (TrueType)',
      'SimHei',
      'Microsoft YaHei (TrueType)',
      'PSPath'
    ])
    expect(out).toContain('Microsoft YaHei')
    expect(out).toContain('宋体')
    expect(out).toContain('新宋体')
    expect(out).toContain('SimHei')
    expect(out).not.toContain('PSPath')
    expect(out.every((n) => !n.startsWith('PS'))).toBe(true)
    expect(out).toEqual([...out].sort((a, b) => a.localeCompare(b)))
    expect(out.length).toBe(new Set(out).size)
  })
})

describe('buildFontList', () => {
  it('兜底合并 + common 仅返回实际存在项', () => {
    const dto: FontListDto = buildFontList(
      parseFontRegistryEntries(['Microsoft YaHei & Microsoft YaHei UI (TrueType)', '某不存在字体 XYZ'])
    )
    expect(dto.defaultFont).toBe('')
    expect(dto.all).toEqual(expect.arrayContaining(FALLBACK_FONTS))
    expect(dto.common).toEqual(expect.arrayContaining(['Microsoft YaHei']))
    // 无检测结果时 common 即 COMMON_FONTS 全集，且每项都在 all 中
    expect(buildFontList([]).common).toEqual(COMMON_FONTS)
    expect(dto.common.every((c) => dto.all.includes(c))).toBe(true)
  })
})

describe('FontService.list', () => {
  it('注册表原值经 parse 清洗后输出：无 (TrueType) 后缀、复合名拆分、全部为可用家族名', async () => {
    const svc = new FontService() as unknown as {
      list(): Promise<FontListDto>
      queryRegistry: () => Promise<string[]>
    }
    svc.queryRegistry = async () => [
      'Arial (TrueType)',
      'Calibri Bold (TrueType)',
      'Microsoft YaHei & Microsoft YaHei UI (TrueType)',
      'PSPath'
    ]
    const dto = await svc.list()
    expect(dto.all).toContain('Arial')
    expect(dto.all).toContain('Calibri Bold')
    expect(dto.all).toContain('Microsoft YaHei')
    expect(dto.all.some((f: string) => f.includes('(TrueType)'))).toBe(false)
    expect(dto.all.some((f: string) => f.includes('&'))).toBe(false)
    expect(dto.common).toContain('Microsoft YaHei')
    expect(dto.common).toContain('Arial')
  })
})
