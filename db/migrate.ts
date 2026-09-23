import type { DbClient } from './client'

const DDL = `
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  paper TEXT NOT NULL, content TEXT NOT NULL,
  print_mode TEXT NOT NULL DEFAULT 'silent', printer_name TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS template_params (
  id TEXT NOT NULL, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1, default_value TEXT NOT NULL DEFAULT '',
  date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd', max_length INTEGER, min INTEGER, max INTEGER,
  decimals INTEGER NOT NULL DEFAULT 2, thousands_separator INTEGER NOT NULL DEFAULT 0,
  print_on_empty TEXT NOT NULL DEFAULT 'blank', sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, id)
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

export function runMigrations(client: DbClient): void {
  client.sqlite.exec(DDL)
}
