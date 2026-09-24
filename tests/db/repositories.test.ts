import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb, type DbClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { TemplateRepository } from '../../db/repositories/template-repo'
import { JobRepository } from '../../db/repositories/job-repo'
import { createTemplate, createParamDef, createElement, type TemplateDocument } from '../../print-core/template-model'

let client: DbClient
let dbPath: string
let repo: TemplateRepository
let jobs: JobRepository

beforeEach(() => {
  dbPath = join(tmpdir(), `tp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  client = createDb(dbPath)
  runMigrations(client)
  repo = new TemplateRepository(client.db)
  jobs = new JobRepository(client.db)
})

afterEach(() => {
  client.sqlite.close()
  rmSync(dbPath, { force: true })
  rmSync(dbPath + '-wal', { force: true })
  rmSync(dbPath + '-shm', { force: true })
})

function sample(id: string): TemplateDocument {
  const tpl = createTemplate(id, '证书', { widthMm: 210, heightMm: 297 })
  tpl.category = '证书'
  tpl.params.push(createParamDef({ name: '姓名', type: 'text', order: 0 }))
  tpl.content.elements.push(createElement('text', { text: '标题' }, { x: 1, y: 1, w: 50, h: 8 }))
  return tpl
}

describe('TemplateRepository', () => {
  it('upsert 后能 get 回来且 JSON 字段结构一致', () => {
    repo.upsert(sample('t1'))
    const got = repo.getById('t1')
    expect(got?.name).toBe('证书')
    expect(got?.paper.widthMm).toBe(210)
    expect(got?.params[0].name).toBe('姓名')
    expect(got?.content.elements[0].type).toBe('text')
  })

  it('list 支持分类与名称关键字过滤', () => {
    const a = sample('a'); a.category = '证书'
    const b = sample('b'); b.name = '商品价签'; b.category = '标签'
    repo.upsert(a); repo.upsert(b)
    expect(repo.list({}).length).toBe(2)
    expect(repo.list({ category: '标签' })[0].id).toBe('b')
    expect(repo.list({ keyword: '证' })[0].id).toBe('a')
  })

  it('重复 upsert 更新而不新增，且参数整体替换', async () => {
    const t = sample('t1')
    repo.upsert(t)
    t.params.pop()
    t.params.push(createParamDef({ name: '日期', type: 'date' }))
    t.name = '证书2'
    repo.upsert(t)
    const got = repo.getById('t1')
    expect(got?.params.map((p) => p.name)).toEqual(['日期'])
    expect(repo.list({}).length).toBe(1)
  })

  it('删除模板级联删除参数', () => {
    repo.upsert(sample('t1'))
    repo.remove('t1')
    expect(repo.getById('t1')).toBeNull()
    expect(client.sqlite.prepare('SELECT COUNT(*) c FROM template_params').get() as { c: number })
      .toMatchObject({ c: 0 })
  })
})

describe('JobRepository', () => {
  it('insert 与按条件查询（模板/时间/参数关键字）', () => {
    const snap = sample('t1')
    jobs.insert({
      id: 'j1', templateId: 't1', templateNameSnapshot: '证书',
      templateSnapshot: snap, paramValues: { 姓名: '张三' }, thumbPath: null,
      printerName: 'HP', copies: 1, printMode: 'silent', status: 'success',
      errorMessage: null, createdAt: 1_700_000_000_000
    })
    jobs.insert({
      id: 'j2', templateId: 't1', templateNameSnapshot: '证书',
      templateSnapshot: snap, paramValues: { 姓名: '李四' }, thumbPath: null,
      printerName: 'HP', copies: 1, printMode: 'silent', status: 'failed',
      errorMessage: 'offline', createdAt: 1_700_000_100_000
    })
    expect(jobs.list({}).length).toBe(2)
    expect(jobs.list({ keyword: '张三' })[0].id).toBe('j1')
    expect(jobs.list({ templateId: 't1' }).length).toBe(2)
    expect(jobs.list({ from: 1_700_000_050_000 })[0].id).toBe('j2')
  })

  it('list 支持状态多选与打印机过滤的组合', () => {
    const snap = sample('s1')
    const mk = (id: string, status: 'failed' | 'success' | 'cancelled', printer: string, ts: number) => ({
      id, templateId: 't1', templateNameSnapshot: '证书', templateSnapshot: snap,
      paramValues: { 姓名: `X${id}` }, thumbPath: null, printerName: printer, copies: 1,
      printMode: 'silent' as const, status, errorMessage: status === 'failed' ? 'e' : null, createdAt: ts
    })
    jobs.insert(mk('j1', 'success', 'HP', 2000))
    jobs.insert(mk('j2', 'failed', 'HP', 1000))
    jobs.insert(mk('j3', 'cancelled', 'Epson', 3000))
    expect(jobs.list({ statuses: ['failed', 'cancelled'] }).map((j) => j.id).sort()).toEqual(['j2', 'j3'])
    expect(jobs.list({ printerName: 'HP' }).map((j) => j.id).sort()).toEqual(['j1', 'j2'])
    expect(jobs.list({ statuses: ['success'], printerName: 'HP' }).map((j) => j.id)).toEqual(['j1'])
  })

  it('deleteOlderThan/deleteAll/count', () => {
    const snap = sample('s1')
    const mk = (id: string, ts: number) => ({
      id, templateId: 't1', templateNameSnapshot: '证书', templateSnapshot: snap,
      paramValues: {}, thumbPath: null, printerName: 'HP', copies: 1,
      printMode: 'silent' as const, status: 'success' as const, errorMessage: null, createdAt: ts
    })
    jobs.insert(mk('old', 1000)); jobs.insert(mk('new', 5000))
    const removed = jobs.deleteOlderThan(2000)
    expect(removed.map((r) => r.id)).toEqual(['old'])
    expect(jobs.count()).toBe(1)
    expect(jobs.deleteAll().length).toBe(1)
    expect(jobs.count()).toBe(0)
  })
})

// v1 旧库 DDL（含 id/key/label 的 template_params；取自迁移改造前的建表语句）
const OLD_DDL = `
CREATE TABLE templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  paper TEXT NOT NULL, content TEXT NOT NULL,
  print_mode TEXT NOT NULL DEFAULT 'silent', printer_name TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE template_params (
  id TEXT NOT NULL, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1, default_value TEXT NOT NULL DEFAULT '',
  date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd', max_length INTEGER, min INTEGER, max INTEGER,
  decimals INTEGER NOT NULL DEFAULT 2, thousands_separator INTEGER NOT NULL DEFAULT 0,
  print_on_empty TEXT NOT NULL DEFAULT 'blank', sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, id)
);
CREATE TABLE assets (
  id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, width_px INTEGER NOT NULL, height_px INTEGER NOT NULL
);
CREATE TABLE print_jobs (
  id TEXT PRIMARY KEY, template_id TEXT, template_name_snapshot TEXT NOT NULL,
  template_snapshot TEXT NOT NULL, param_values TEXT NOT NULL, thumb_path TEXT,
  printer_name TEXT NOT NULL, copies INTEGER NOT NULL DEFAULT 1, print_mode TEXT NOT NULL,
  status TEXT NOT NULL, error_message TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX idx_jobs_created ON print_jobs(created_at);
CREATE INDEX idx_params_template ON template_params(template_id);
CREATE INDEX idx_assets_template ON assets(template_id);
`

describe('v1 旧库一次性升级', () => {
  it('升级后：参数表为 name 列、content 中 param 元素变文本 token；重复迁移幂等', () => {
    const legacyPath = join(tmpdir(), `tp-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    const legacy = createDb(legacyPath)
    try {
      legacy.sqlite.exec(OLD_DDL)
      const v1Content = {
        elements: [
          { id: 'e1', x: 1, y: 1, w: 50, h: 8, rotation: 0, locked: false, zIndex: 0, type: 'text',
            props: { text: '姓名：', fontFamily: 'Arial', fontSizeMm: 4, bold: false, italic: false, align: 'left', color: '#000', lineHeight: 1.2 } },
          { id: 'e2', x: 1, y: 10, w: 50, h: 8, rotation: 0, locked: false, zIndex: 1, type: 'param',
            props: { paramId: 'name', fontFamily: 'Arial', fontSizeMm: 4, bold: true, align: 'left', color: '#000', autoFit: true } }
        ]
      }
      legacy.sqlite.prepare(
        `INSERT INTO templates(id,name,category,paper,content,print_mode,printer_name,is_builtin,version,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,?)`
      ).run(
        'old1', '旧模板', '', JSON.stringify({ widthMm: 40, heightMm: 30 }),
        JSON.stringify(v1Content), 'silent', null, 0, 1, 2
      )
      legacy.sqlite.prepare(
        `INSERT INTO template_params(id,template_id,key,label,type,required,default_value,date_format,
          max_length,min,max,decimals,thousands_separator,print_on_empty,sort_order)
         VALUES ('p1','old1','name','姓名','text',1,'','yyyy-MM-dd',NULL,NULL,NULL,2,0,'blank',0)`
      ).run()

      runMigrations(legacy)

      // 表结构已重建为 name 列，旧列消失
      const cols = (legacy.sqlite.prepare('PRAGMA table_info(template_params)').all() as { name: string }[]).map((c) => c.name)
      expect(cols).toContain('name')
      expect(cols).not.toContain('key')
      expect(cols).not.toContain('label')
      expect(cols).not.toContain('id')

      const r = new TemplateRepository(legacy.db)
      const doc = r.getById('old1')!
      expect(doc.version).toBe(2)
      expect(doc.params.map((p) => p.name)).toEqual(['姓名'])
      const paramEl = doc.content.elements[1]
      expect(paramEl.type).toBe('text')
      if (paramEl.type === 'text') expect(paramEl.props.text).toBe('{{姓名}}')
      expect(doc.content.elements[0].type).toBe('text')

      // 幂等：再跑一次不报错、不重复改
      expect(() => runMigrations(legacy)).not.toThrow()
      const doc2 = r.getById('old1')!
      expect(doc2.version).toBe(2)
      expect(doc2.params.map((p) => p.name)).toEqual(['姓名'])
    } finally {
      legacy.sqlite.close()
      rmSync(legacyPath, { force: true })
      rmSync(legacyPath + '-wal', { force: true })
      rmSync(legacyPath + '-shm', { force: true })
    }
  })
})
