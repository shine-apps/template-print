/**
 * v1 → v2 读时迁移（幂等）：
 * - ParamDef 的 id/key/label 合并为 name（优先 label，空则 key，模板内重名加序号）
 * - type:'param' 元素转为含 {{名称}} 的 text 元素
 * - version 置 2
 * 非对象/已是 v2 的输入原样返回。
 */

interface V1ParamDef {
  id?: string
  key?: string
  label?: string
  [k: string]: unknown
}
interface V1Element {
  type?: string
  id?: string
  x?: number
  y?: number
  w?: number
  h?: number
  rotation?: number
  locked?: boolean
  zIndex?: number
  props?: Record<string, unknown>
  [k: string]: unknown
}

/** 从 v1 参数数组构造 name，并返回 name 列表与 key→name 映射 */
function buildNames(params: V1ParamDef[]): { names: Record<string, unknown>[]; map: Map<string, string> } {
  const used = new Set<string>()
  const map = new Map<string, string>()
  const names = params.map((p) => {
    let name = String(p.label ?? '').trim() || String(p.key ?? '').trim() || '参数'
    if (used.has(name)) {
      let n = 2
      while (used.has(`${name}${n}`)) n += 1
      name = `${name}${n}`
    }
    used.add(name)
    map.set(String(p.key ?? ''), name)
    const { id: _id, key: _key, label: _label, ...rest } = p
    return { name, ...rest }
  })
  return { names, map }
}

export function migrateDocument(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as { version?: number; params?: V1ParamDef[]; content?: { elements?: V1Element[] } }
  if (r.version === 2) return raw

  const params = Array.isArray(r.params) ? r.params : []
  const { names, map } = buildNames(params)

  const elements = (Array.isArray(r.content?.elements) ? r.content!.elements : []).map((el) => {
    if (el.type !== 'param') return el
    const props = el.props ?? {}
    const name = map.get(String(props.paramId ?? '')) ?? String(props.paramId ?? '')
    return {
      id: el.id, x: el.x, y: el.y, w: el.w, h: el.h,
      rotation: el.rotation ?? 0, locked: el.locked ?? false, zIndex: el.zIndex ?? 0,
      type: 'text',
      props: {
        text: `{{${name}}}`,
        fontFamily: props.fontFamily ?? 'Microsoft YaHei',
        fontSizeMm: props.fontSizeMm ?? 5,
        bold: props.bold ?? false,
        italic: false,
        align: props.align ?? 'left',
        color: props.color ?? '#000000',
        lineHeight: 1.2
      }
    }
  })

  return { ...r, version: 2, params: names, content: { elements } }
}

/** v1 打印历史的 paramValues 以 key 为键，迁移到以 name 为键；v2 原样返回 */
export function migrateParamValues(
  rawSnapshot: unknown,
  values: Record<string, string>
): Record<string, string> {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') return values
  const r = rawSnapshot as { version?: number; params?: V1ParamDef[] }
  if (r.version === 2) return values
  const params = Array.isArray(r.params) ? r.params : []
  const used = new Set<string>()
  const keyToName = new Map<string, string>()
  for (const p of params) {
    let name = String(p.label ?? '').trim() || String(p.key ?? '').trim() || '参数'
    if (used.has(name)) {
      let n = 2
      while (used.has(`${name}${n}`)) n += 1
      name = `${name}${n}`
    }
    used.add(name)
    keyToName.set(String(p.key ?? ''), name)
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) out[keyToName.get(k) ?? k] = v
  return out
}
