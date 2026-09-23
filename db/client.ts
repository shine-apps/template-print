import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export function createDb(path: string) {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  return { sqlite, db }
}
export type DbClient = ReturnType<typeof createDb>
/** 仓储统一使用该类型，构造处无需任何 as 断言 */
export type DrizzleDb = DbClient['db']
