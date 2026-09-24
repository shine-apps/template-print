import { z } from 'zod'

export const CONTENT_VERSION = 3

// ---------- 几何（单位 mm） ----------
const GeometrySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number().finite().default(0),
  locked: z.boolean().default(false),
  zIndex: z.number().int().default(0)
})
export type Geometry = z.infer<typeof GeometrySchema>

// ---------- 各元素 ----------
export const TextElementSchema = GeometrySchema.extend({
  id: z.string().min(1),
  type: z.literal('text'),
  props: z.object({
    text: z.string().default(''),
    fontFamily: z.string().default('Microsoft YaHei'),
    fontSizeMm: z.number().positive().default(5),
    bold: z.boolean().default(false),
    italic: z.boolean().default(false),
    align: z.enum(['left', 'center', 'right']).default('left'),
    color: z.string().default('#000000'),
    lineHeight: z.number().positive().default(1.2),
    underline: z.boolean().default(false),
    direction: z.enum(['horizontal', 'vertical']).default('horizontal')
  })
})

export type TextDirection = 'horizontal' | 'vertical'
/** 未显式指定字体时（fontFamily===''）画布与打印共用的系统默认字体栈 */
export const SYSTEM_FONT_STACK =
  'system-ui, "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif'

export const ImageElementSchema = GeometrySchema.extend({
  id: z.string().min(1),
  type: z.literal('image'),
  props: z.object({
    assetId: z.string().min(1),
    fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
    opacity: z.number().min(0).max(1).default(1)
  })
})

export const ShapeElementSchema = GeometrySchema.extend({
  id: z.string().min(1),
  type: z.literal('shape'),
  props: z.object({
    shape: z.enum(['line', 'rect', 'ellipse']),
    strokeColor: z.string().default('#000000'),
    strokeWidthMm: z.number().min(0).default(0.3),
    fillColor: z.string().nullable().default(null)
  })
})

export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema
])
export type TemplateElement = z.infer<typeof ElementSchema>
export type ElementType = TemplateElement['type']

// ---------- 参数定义 ----------
export const ParamTypeSchema = z.enum(['text', 'textarea', 'date', 'number'])
export type ParamType = z.infer<typeof ParamTypeSchema>

export const ParamDefSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '参数名称不能为空')
    .max(30, '参数名称最长 30 字符')
    .refine((n) => !/[{}]/.test(n) && !/[\r\n]/.test(n), '参数名称不能包含 { } 或换行'),
  type: ParamTypeSchema,
  required: z.boolean().default(true),
  defaultValue: z.string().default(''),
  dateFormat: z.string().default('yyyy-MM-dd'),
  maxLength: z.number().int().positive().nullable().default(null),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  decimals: z.number().int().min(0).max(6).default(2),
  thousandsSeparator: z.boolean().default(false),
  printOnEmpty: z.enum(['blank', 'line']).default('blank'),
  order: z.number().int().default(0)
})
export type ParamDef = z.infer<typeof ParamDefSchema>

// ---------- 纸张与模板 ----------
export const PaperSchema = z.object({
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  marginMm: z
    .object({
      t: z.number().min(0).default(0),
      r: z.number().min(0).default(0),
      b: z.number().min(0).default(0),
      l: z.number().min(0).default(0)
    })
    .default({ t: 0, r: 0, b: 0, l: 0 })
})
export type Paper = z.infer<typeof PaperSchema>

export const ContentSchema = z.object({
  elements: z.array(ElementSchema).default([])
})

export const PrintModeSchema = z.enum(['silent', 'dialog'])
export type PrintMode = z.infer<typeof PrintModeSchema>

export const TemplateDocumentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().default(''),
    paper: PaperSchema,
    content: ContentSchema.default({ elements: [] }),
    params: z.array(ParamDefSchema).default([]),
    printMode: PrintModeSchema.default('silent'),
    printerName: z.string().nullable().default(null),
    isBuiltin: z.boolean().default(false),
    version: z.literal(CONTENT_VERSION).default(CONTENT_VERSION),
    createdAt: z.number(),
    updatedAt: z.number()
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>()
    doc.params.forEach((p, i) => {
      if (seen.has(p.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['params', i, 'name'],
          message: `参数名称重复: ${p.name}`
        })
      }
      seen.add(p.name)
    })
  })
export type TemplateDocument = z.infer<typeof TemplateDocumentSchema>

// ---------- 工厂 ----------
let seq = 0
export function localId(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 8)}`
}

export function createTemplate(
  id: string,
  name: string,
  paper: { widthMm: number; heightMm: number },
  now: number = Date.now()
): TemplateDocument {
  return {
    id,
    name,
    category: '',
    paper: {
      widthMm: paper.widthMm,
      heightMm: paper.heightMm,
      orientation: 'portrait',
      marginMm: { t: 0, r: 0, b: 0, l: 0 }
    },
    content: { elements: [] },
    params: [],
    printMode: 'silent',
    printerName: null,
    isBuiltin: false,
    version: CONTENT_VERSION,
    createdAt: now,
    updatedAt: now
  }
}

export function createElement(
  type: ElementType,
  props: Record<string, unknown>,
  geo: { x: number; y: number; w: number; h: number }
): TemplateElement {
  // 经 zod 解析补全默认值，保证返回完整元素
  return ElementSchema.parse({
    id: localId('el'),
    type,
    ...geo,
    rotation: 0,
    locked: false,
    zIndex: 0,
    props
  })
}

export function createParamDef(
  input: Pick<ParamDef, 'name' | 'type'> & Partial<ParamDef>
): ParamDef {
  // name/type 显式前置、其余字段通过 rest 展开，避免同名属性重复指定（TS2783）
  const { name, type, ...rest } = input
  return ParamDefSchema.parse({
    name,
    type,
    required: true,
    defaultValue: '',
    dateFormat: 'yyyy-MM-dd',
    maxLength: null,
    min: null,
    max: null,
    decimals: 2,
    thousandsSeparator: false,
    printOnEmpty: 'blank',
    order: 0,
    ...rest
  })
}
