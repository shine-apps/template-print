import type { DbClient } from './client'
import { migrateDocument, migrateParamValues } from '../print-core/migrate'

const DDL = `
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  paper TEXT NOT NULL, content TEXT NOT NULL,
  print_mode TEXT NOT NULL DEFAULT 'silent', printer_name TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  text_only INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS template_params (
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL, type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1, default_value TEXT NOT NULL DEFAULT '',
  date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd', max_length INTEGER, min INTEGER, max INTEGER,
  decimals INTEGER NOT NULL DEFAULT 2, thousands_separator INTEGER NOT NULL DEFAULT 0,
  print_on_empty TEXT NOT NULL DEFAULT 'blank', sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, name)
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, width_px INTEGER NOT NULL, height_px INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY, template_id TEXT, template_name_snapshot TEXT NOT NULL,
  template_snapshot TEXT NOT NULL, param_values TEXT NOT NULL, thumb_path TEXT,
  printer_name TEXT NOT NULL, copies INTEGER NOT NULL DEFAULT 1, print_mode TEXT NOT NULL,
  status TEXT NOT NULL, error_message TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON print_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_params_template ON template_params(template_id);
CREATE INDEX IF NOT EXISTS idx_assets_template ON assets(template_id);
`

/**
 * ① 旧库文档/历史快照一次性升级为 v3（幂等）。
 * 必须在旧 template_params 关系表（仍含 key/label）重建之前执行——
 * content 中 param 元素转 token 需要 paramId(key)→名称 映射。
 */
function upgradeDocumentsToV2(client: DbClient): void {
  const cols = client.sqlite.prepare("PRAGMA table_info(template_params)").all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'name')) return // 新库或已升级

  const tRows = client.sqlite.prepare('SELECT * FROM templates').all() as Record<string, unknown>[]
  const updT = client.sqlite.prepare('UPDATE templates SET content = ?, version = 3 WHERE id = ?')
  for (const r of tRows) {
    if (Number(r.version) >= 3) continue
    const pRows = client.sqlite
      .prepare('SELECT * FROM template_params WHERE template_id = ?')
      .all(r.id) as Record<string, unknown>[]
    const raw = { ...r, content: JSON.parse(String(r.content)), params: pRows }
    const migrated = migrateDocument(raw) as { content: unknown }
    updT.run(JSON.stringify(migrated.content), r.id)
  }

  const jRows = client.sqlite.prepare('SELECT id, template_snapshot, param_values FROM print_jobs').all() as
    { id: string; template_snapshot: string; param_values: string }[]
  const updJ = client.sqlite.prepare('UPDATE print_jobs SET template_snapshot = ?, param_values = ? WHERE id = ?')
  for (const j of jRows) {
    let snap: unknown = null
    try { snap = JSON.parse(j.template_snapshot) } catch { snap = null }
    if (snap && (snap as { version?: number }).version !== 2) {
      let values: Record<string, string> = {}
      try { values = JSON.parse(j.param_values) as Record<string, string> } catch { values = {} }
      updJ.run(JSON.stringify(migrateDocument(snap)), JSON.stringify(migrateParamValues(snap, values)), j.id)
    }
  }
}

/**
 * ③ 旧关系表（id/key/label）重建为 name 结构（幂等）。
 * label 为空、或同模板内 label 重复时回退 key。
 */
function migrateParamsTable(client: DbClient): void {
  const cols = client.sqlite.prepare("PRAGMA table_info(template_params)").all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'name')) return
  client.sqlite.exec(`
    CREATE TABLE template_params_v2 (
      template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      name TEXT NOT NULL, type TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1, default_value TEXT NOT NULL DEFAULT '',
      date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd', max_length INTEGER, min INTEGER, max INTEGER,
      decimals INTEGER NOT NULL DEFAULT 2, thousands_separator INTEGER NOT NULL DEFAULT 0,
      print_on_empty TEXT NOT NULL DEFAULT 'blank', sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (template_id, name)
    );
    INSERT INTO template_params_v2(template_id,name,type,required,default_value,date_format,
      max_length,min,max,decimals,thousands_separator,print_on_empty,sort_order)
    SELECT template_id,
      CASE
        WHEN COALESCE(label,'') = '' THEN key
        WHEN label IN (SELECT label FROM template_params q WHERE q.template_id = p.template_id GROUP BY label HAVING COUNT(*) > 1) THEN key
        ELSE label
      END,
      type,required,default_value,date_format,max_length,min,max,decimals,thousands_separator,print_on_empty,sort_order
    FROM template_params p;
    DROP TABLE template_params;
    ALTER TABLE template_params_v2 RENAME TO template_params;
    CREATE INDEX IF NOT EXISTS idx_params_template ON template_params(template_id);
  `)
}

/**
 * ④ templates 增加 text_only 列（幂等）。
 * 旧库 ALTER ADD COLUMN ... DEFAULT 1：存量模板一次性默认"仅打印文本"（用户已确认的统一规则）。
 */
function addTextOnlyColumn(client: DbClient): void {
  const cols = client.sqlite.prepare("PRAGMA table_info(templates)").all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'text_only')) return
  client.sqlite.exec('ALTER TABLE templates ADD COLUMN text_only INTEGER NOT NULL DEFAULT 1')
}

/**
 * 启动时一次性升级（顺序不可调换）：
 * ① 旧库：文档/历史快照升级为 v3（需要旧 key/label）
 * ② 新库建表（全部 IF NOT EXISTS；旧库不受影响）
 * ④ 旧库：templates 增加 text_only 列
 * ③ 旧库：template_params 由 id/key/label 重建为 name
 */
export function runMigrations(client: DbClient): void {
  upgradeDocumentsToV2(client)
  client.sqlite.exec(DDL)
  addTextOnlyColumn(client)
  migrateParamsTable(client)
}
