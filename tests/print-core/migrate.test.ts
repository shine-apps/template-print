import { describe, it, expect } from 'vitest'
import { migrateDocument, migrateParamValues } from '../../print-core/migrate'
import { TemplateDocumentSchema } from '../../print-core/template-model'

const v1 = () => ({
  id: 't1', name: '旧模板', category: '',
  paper: { widthMm: 40, heightMm: 30 },
  content: { elements: [
    { id: 'e1', x: 1, y: 1, w: 10, h: 5, rotation: 0, locked: false, zIndex: 0, type: 'text',
      props: { text: '姓名：', fontFamily: 'Arial', fontSizeMm: 4, bold: false, italic: false, align: 'left', color: '#000', lineHeight: 1.2 } },
    { id: 'e2', x: 1, y: 10, w: 20, h: 6, rotation: 0, locked: false, zIndex: 1, type: 'param',
      props: { paramId: 'p_name', fontFamily: 'Arial', fontSizeMm: 4, bold: true, align: 'left', color: '#000', autoFit: true } }
  ] },
  params: [
    { id: 'p_name', key: 'p_name', label: '姓名', type: 'text', required: true, defaultValue: '',
      dateFormat: 'yyyy-MM-dd', maxLength: null, min: null, max: null, decimals: 2,
      thousandsSeparator: false, printOnEmpty: 'blank', order: 0 }
  ],
  printMode: 'silent', printerName: null, isBuiltin: false, version: 1,
  createdAt: 1, updatedAt: 2
})

describe('migrateDocument', () => {
  it('v1：param 元素转 {{名称}} 文本；参数 id/key/label 合并为 name；version=3', () => {
    const doc = TemplateDocumentSchema.parse(migrateDocument(v1()))
    expect(doc.version).toBe(3)
    expect(doc.params[0].name).toBe('姓名')
    expect('id' in doc.params[0]).toBe(false)
    const pe = doc.content.elements[1]
    expect(pe.type).toBe('text')
    if (pe.type === 'text') expect(pe.props.text).toBe('{{姓名}}')
  })

  it('label 为空时回退 key；重名自动加序号', () => {
    const raw = v1()
    raw.params = [
      { ...raw.params[0], id: 'a', key: 'a', label: '日期' },
      { ...raw.params[0], id: 'b', key: 'b', label: '日期' },
      { ...raw.params[0], id: 'c', key: 'c', label: '' }
    ]
    const doc = TemplateDocumentSchema.parse(migrateDocument(raw))
    expect(doc.params.map((p) => p.name)).toEqual(['日期', '日期2', 'c'])
  })

  it('v2 输入仅升版本号到 3，内容/参数原样', () => {
    const v2 = TemplateDocumentSchema.parse(migrateDocument(v1())) // 已是 3
    const rawV2 = JSON.parse(JSON.stringify({ ...v2, version: 2 }))
    const out = TemplateDocumentSchema.parse(migrateDocument(rawV2))
    expect(out.version).toBe(3)
    expect(out.params.map((p) => p.name)).toEqual(['姓名'])
    expect(out.content.elements[1].type).toBe('text')
  })

  it('v3 原样返回（同一引用）', () => {
    const v3 = TemplateDocumentSchema.parse(migrateDocument(v1()))
    expect(migrateDocument(v3)).toBe(v3)
  })
})

describe('migrateParamValues', () => {
  it('v1 快照的参数值按键→名称重映射；v2/v3 原样', () => {
    const raw = v1()
    expect(migrateParamValues(raw, { p_name: '张三' })).toEqual({ 姓名: '张三' })
    const v2 = TemplateDocumentSchema.parse(migrateDocument(raw))
    expect(migrateParamValues(v2, { 姓名: '李四' })).toEqual({ 姓名: '李四' })
  })
})
