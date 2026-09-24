import { describe, it, expect } from 'vitest'
import { createParamDef } from '../../print-core/template-model'
import { evaluateParams, formatDate, formatNumber, applyEmpty, interpolate } from '../../print-core/param-evaluator'

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
      createParamDef({ name: '姓名', type: 'text', defaultValue: '张三' }),
      createParamDef({ name: '日期', type: 'date', defaultValue: 'today' }),
      createParamDef({ name: '金额', type: 'number', decimals: 2, thousandsSeparator: true })
    ]
    const out = evaluateParams(defs, { 金额: '99.9' }, new Date(2026, 8, 23))
    expect(out['姓名']).toBe('张三')
    expect(out['日期']).toBe('2026-09-23')
    expect(out['金额']).toBe('99.90')
  })
  it('必填校验返回错误名称集合', () => {
    const defs = [createParamDef({ name: '姓名', type: 'text', required: true })]
    const out = evaluateParams(defs, { 姓名: '' }, new Date(2026, 8, 23))
    expect(out.__errors).toContain('姓名')
  })
  it('interpolate 支持中文 token、忽略括号内空白、未知名为空', () => {
    expect(interpolate('你好{{ 姓名 }}，金额￥{{金额}}', { 姓名: '张三', 金额: '88.00' })).toBe('你好张三，金额￥88.00')
    expect(interpolate('{{未知}}x', {})).toBe('x')
  })
})
