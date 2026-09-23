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
  tpl.params.push(createParamDef({ key: 'name', label: '姓名', type: 'text', order: 0 }))
  tpl.content.elements.push(createElement('text', { text: '标题' }, { x: 1, y: 1, w: 50, h: 8 }))
  return tpl
}

describe('TemplateRepository', () => {
  it('upsert 后能 get 回来且 JSON 字段结构一致', () => {
    repo.upsert(sample('t1'))
    const got = repo.getById('t1')
    expect(got?.name).toBe('证书')
    expect(got?.paper.widthMm).toBe(210)
    expect(got?.params[0].key).toBe('name')
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
    t.params.push(createParamDef({ key: 'date', label: '日期', type: 'date' }))
    t.name = '证书2'
    repo.upsert(t)
    const got = repo.getById('t1')
    expect(got?.params.map((p) => p.key)).toEqual(['date'])
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
      templateSnapshot: snap, paramValues: { name: '张三' }, thumbPath: null,
      printerName: 'HP', copies: 1, printMode: 'silent', status: 'success',
      errorMessage: null, createdAt: 1_700_000_000_000
    })
    jobs.insert({
      id: 'j2', templateId: 't1', templateNameSnapshot: '证书',
      templateSnapshot: snap, paramValues: { name: '李四' }, thumbPath: null,
      printerName: 'HP', copies: 1, printMode: 'silent', status: 'failed',
      errorMessage: 'offline', createdAt: 1_700_000_100_000
    })
    expect(jobs.list({}).length).toBe(2)
    expect(jobs.list({ keyword: '张三' })[0].id).toBe('j1')
    expect(jobs.list({ templateId: 't1' }).length).toBe(2)
    expect(jobs.list({ from: 1_700_000_050_000 })[0].id).toBe('j2')
  })
})
