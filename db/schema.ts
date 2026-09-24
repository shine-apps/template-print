import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull().default(''),
  paper: text('paper', { mode: 'json' }).notNull(),
  content: text('content', { mode: 'json' }).notNull(),
  printMode: text('print_mode').notNull().default('silent'),
  printerName: text('printer_name'),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  version: integer('version').notNull().default(1),
  textOnly: integer('text_only', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

// 参数名称在单模板内唯一，主键 (template_id, name)
export const templateParams = sqliteTable('template_params', {
  templateId: text('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  required: integer('required', { mode: 'boolean' }).notNull().default(true),
  defaultValue: text('default_value').notNull().default(''),
  dateFormat: text('date_format').notNull().default('yyyy-MM-dd'),
  maxLength: integer('max_length'),
  min: integer('min'),
  max: integer('max'),
  decimals: integer('decimals').notNull().default(2),
  thousandsSeparator: integer('thousands_separator', { mode: 'boolean' }).notNull().default(false),
  printOnEmpty: text('print_on_empty').notNull().default('blank'),
  order: integer('sort_order').notNull().default(0)
}, (table) => ({
  pk: primaryKey({ columns: [table.templateId, table.name] })
}))

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  templateId: text('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  widthPx: integer('width_px').notNull(),
  heightPx: integer('height_px').notNull()
})

export const printJobs = sqliteTable('print_jobs', {
  id: text('id').primaryKey(),
  templateId: text('template_id'),
  templateNameSnapshot: text('template_name_snapshot').notNull(),
  templateSnapshot: text('template_snapshot', { mode: 'json' }).notNull(),
  paramValues: text('param_values', { mode: 'json' }).notNull(),
  thumbPath: text('thumb_path'),
  printerName: text('printer_name').notNull(),
  copies: integer('copies').notNull().default(1),
  printMode: text('print_mode').notNull(),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull()
})

export type TemplateRow = typeof templates.$inferSelect
export type JobRow = typeof printJobs.$inferSelect
