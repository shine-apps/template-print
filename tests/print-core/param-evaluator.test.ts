import { describe, it, expect } from 'vitest'
import { createParamDef } from '../../print-core/template-model'
import { evaluateParams, formatDate, formatNumber, applyEmpty } from '../../print-core/param-evaluator'

describe('参数求值', () => {
  it('日期按 dateFormat 格式化', () => {
    expect(formatDate('2026-09-03', 'yyyy年M月d日')).toBe('2026年9月3日')
  })
  it('数字千分位与小数位', () => {
    expect(formatNumber('1234567.5', 2, true)).toBe('1,234,567.50')
    expect(formatNumber('12.3', 0, false)).toBe('12')
  })
  it('空值：blank 返回空串；line 返回占位横线标记', () => {
    expect(applyEmpty('', 'blank')).toBe('')
    expect(applyEmpty('   ', 'line')).toBe('{{__EMPTY_LINE__}}')
  })
  it('evaluateParams 汇总各类型默认值与 today', () => {
    const defs = [
      createParamDef({ key: 'name', label: '姓名', type: 'text', defaultValue: '张三' }),
      createParamDef({ key: 'date', label: '日期', type: 'date', defaultValue: 'today' }),
      createParamDef({ key: 'amount', label: '金额', type: 'number', decimals: 2, thousandsSeparator: true })
    ]
    const out = evaluateParams(defs, { amount: '99.9' }, new Date(2026, 8, 23))
    expect(out.name).toBe('张三')
    expect(out.date).toBe('2026-09-23')
    expect(out.amount).toBe('99.90')
  })
  it('必填校验返回错误键集合', () => {
    const defs = [createParamDef({ key: 'name', label: '姓名', type: 'text', required: true })]
    const out = evaluateParams(defs, { name: '' }, new Date(2026, 8, 23))
    expect(out.__errors).toContain('name')
  })
})
