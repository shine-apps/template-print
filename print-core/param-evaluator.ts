import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import type { ParamDef } from './template-model'

dayjs.extend(customParseFormat)

export const EMPTY_LINE_TOKEN = '{{__EMPTY_LINE__}}'

export type EvaluatedValues = Record<string, string> & { __errors?: string[] }

/**
 * 参数定义使用 Java/element-ui 风格小写 token（yyyy/d），
 * 归一化为 dayjs token（YYYY/D）；M/MM 两边均为月份，保持不变。
 */
function toDayjsFormat(format: string): string {
  return format.replace(/yyyy|dd|d/g, (token) =>
    token === 'yyyy' ? 'YYYY' : token === 'dd' ? 'DD' : 'D'
  )
}

export function formatDate(raw: string, dateFormat: string): string {
  const d = dayjs(raw)
  return d.isValid() ? d.format(toDayjsFormat(dateFormat)) : raw
}

export function formatNumber(raw: string, decimals: number, sep: boolean): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  const fixed = n.toFixed(decimals)
  if (!sep) return fixed
  const [int, dec] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec ? `${grouped}.${dec}` : grouped
}

export function applyEmpty(raw: string, mode: 'blank' | 'line'): string {
  if (raw.trim() !== '') return raw
  return mode === 'line' ? EMPTY_LINE_TOKEN : ''
}

/**
 * 求全部参数的打印文本。
 * @param now 注入当前时间，便于测试
 */
export function evaluateParams(
  defs: ParamDef[],
  input: Record<string, string>,
  now: Date = new Date()
): EvaluatedValues {
  const out: EvaluatedValues = {}
  const errors: string[] = []

  for (const def of defs) {
    let raw = input[def.key]
    if (raw === undefined) {
      raw = def.defaultValue === 'today' && def.type === 'date'
        ? dayjs(now).format('YYYY-MM-DD')
        : def.defaultValue
    }

    if (raw.trim() === '' && def.required) errors.push(def.key)

    let value: string
    switch (def.type) {
      case 'date':
        value = raw.trim() === '' ? '' : formatDate(raw, def.dateFormat)
        break
      case 'number':
        value = raw.trim() === '' ? '' : formatNumber(raw, def.decimals, def.thousandsSeparator)
        break
      default:
        value = raw
    }
    out[def.key] = applyEmpty(value, def.printOnEmpty)
  }

  if (errors.length > 0) out.__errors = errors
  return out
}

/** 替换表达式中的 {{key}}（通用工具，保留供未来场景使用） */
export function interpolate(expr: string, values: Record<string, string>): string {
  return expr.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => values[key] ?? '')
}
