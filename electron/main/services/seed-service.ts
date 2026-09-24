import {
  createTemplate,
  createParamDef,
  TemplateDocumentSchema,
  type TemplateDocument,
  type TemplateElement
} from '../../../print-core/template-model'
import { loadSettings, saveSettings } from '../settings'
import type { TemplateService } from './template-service'

/** 播种版本：内置模板内容变更时递增，触发重新幂等播种（v2：参数改为文本 token 形态） */
export const SEED_VERSION = 'm3-v2-params'
/** 内置模板固定 id 前缀，便于幂等 */
export const SEED_PREFIX = 'builtin-'

const geo = (id: string, x: number, y: number, w: number, h: number, z: number) =>
  ({ id, x, y, w, h, rotation: 0, locked: false, zIndex: z })

function t(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  props: Record<string, unknown>
): TemplateElement {
  return { type: 'text', ...geo(id, x, y, w, h, z), props } as TemplateElement
}

function rect(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  strokeWidthMm = 0.3
): TemplateElement {
  return {
    type: 'shape',
    ...geo(id, x, y, w, h, z),
    props: { shape: 'rect', strokeColor: '#000000', strokeWidthMm, fillColor: null }
  } as TemplateElement
}

export function seedSpecs(): TemplateDocument[] {
  const now = Date.now()
  const base = createTemplate('', '', { widthMm: 210, heightMm: 297 })

  const cert: TemplateDocument = TemplateDocumentSchema.parse({
    ...base,
    id: SEED_PREFIX + 'cert',
    name: '示例 · A4 荣誉证书',
    category: '示例',
    paper: { widthMm: 210, heightMm: 297, orientation: 'portrait', marginMm: { t: 0, r: 0, b: 0, l: 0 } },
    params: [
      createParamDef({ name: '姓名', type: 'text', required: true, order: 0 }),
      createParamDef({ name: '日期', type: 'date', required: false, defaultValue: 'today', order: 1 })
    ],
    content: {
      elements: [
        rect('box', 10, 10, 190, 277, 0, 0.6),
        t('title', 30, 40, 150, 16, 2, { text: '荣 誉 证 书', fontSizeMm: 12, bold: true, align: 'center' }),
        t('l_name', 35, 130, 140, 8, 2, { text: '兹证明 {{姓名}} 同志：' }),
        t('line2', 30, 160, 150, 8, 2, { text: '在工作中表现优异，特发此证，以资鼓励。' }),
        t('l_date', 110, 250, 80, 8, 2, { text: '{{日期}}' })
      ]
    },
    createdAt: now,
    updatedAt: now
  })

  const receipt: TemplateDocument = TemplateDocumentSchema.parse({
    ...base,
    id: SEED_PREFIX + 'receipt',
    name: '示例 · 80mm 收银小票',
    category: '示例',
    paper: { widthMm: 80, heightMm: 200, orientation: 'portrait', marginMm: { t: 0, r: 0, b: 0, l: 0 } },
    params: [
      createParamDef({ name: '商品/客户', type: 'text', order: 0 }),
      createParamDef({ name: '金额', type: 'number', thousandsSeparator: true, order: 1 })
    ],
    content: {
      elements: [
        rect('box', 2, 2, 76, 196, 0),
        t('title', 5, 6, 70, 8, 2, { text: '收银小票', fontSizeMm: 5, bold: true, align: 'center' }),
        t('p_name', 5, 22, 70, 6, 2, { text: '商品：{{商品/客户}}' }),
        t('p_amt', 5, 32, 70, 6, 2, { text: '金额：￥{{金额}}' }),
        t('tip', 5, 180, 70, 6, 2, { text: '谢谢惠顾', align: 'center', color: '#666666' })
      ]
    },
    createdAt: now,
    updatedAt: now
  })

  const label: TemplateDocument = TemplateDocumentSchema.parse({
    ...base,
    id: SEED_PREFIX + 'label',
    name: '示例 · 40×30 价签',
    category: '示例',
    paper: { widthMm: 40, heightMm: 30, orientation: 'portrait', marginMm: { t: 0, r: 0, b: 0, l: 0 } },
    params: [
      createParamDef({ name: '品名', type: 'text', required: true, order: 0 }),
      createParamDef({ name: '价格', type: 'number', decimals: 2, order: 1 })
    ],
    content: {
      elements: [
        rect('box', 1, 1, 38, 28, 0),
        t('p_name', 2, 3, 36, 8, 2, { text: '品名：{{品名}}', fontSizeMm: 4.5 }),
        t('p_price', 2, 16, 36, 8, 2, { text: '价格：￥{{价格}}', fontSizeMm: 5 })
      ]
    },
    createdAt: now,
    updatedAt: now
  })

  return [cert, receipt, label]
}

export class SeedService {
  constructor(
    private dataDir: string,
    private templates: TemplateService
  ) {}

  /**
   * 首次启动（或种子版本升级）时幂等播种内置模板。
   * 版本不匹配时按固定 id 强制 upsert 全部规格：旧版内置模板被覆盖更新，
   * 用户自建模板 id 不同（builtin- 前缀），不受影响。
   * 返回的 inserted 为本次实际写入（插入或覆盖）的内置模板 id。
   */
  async seedIfNeeded(): Promise<{ inserted: string[] }> {
    const s = loadSettings(this.dataDir)
    if (s.seededTemplatesVersion === SEED_VERSION) return { inserted: [] }
    const inserted: string[] = []
    for (const doc of seedSpecs()) {
      await this.templates.save(doc)
      inserted.push(doc.id)
    }
    saveSettings(this.dataDir, { ...s, seededTemplatesVersion: SEED_VERSION })
    return { inserted }
  }
}
