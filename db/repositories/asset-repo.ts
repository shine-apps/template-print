import { eq } from 'drizzle-orm'
import { assets } from '../schema'
import type { DrizzleDb } from '../client'

export interface AssetRecord {
  id: string
  templateId: string
  filePath: string
  originalName: string
  mime: string
  sizeBytes: number
  widthPx: number
  heightPx: number
}

export class AssetRepository {
  constructor(private db: DrizzleDb) {}

  insert(rec: AssetRecord): void {
    this.db.insert(assets).values(rec).run()
  }
  listByTemplate(templateId: string): AssetRecord[] {
    return this.db.select().from(assets).where(eq(assets.templateId, templateId))
      .all() as unknown as AssetRecord[]
  }
  get(id: string): AssetRecord | null {
    const row = this.db.select().from(assets).where(eq(assets.id, id)).all()[0]
    return (row as AssetRecord | undefined) ?? null
  }
  removeByTemplate(templateId: string): AssetRecord[] {
    const old = this.listByTemplate(templateId)
    this.db.delete(assets).where(eq(assets.templateId, templateId)).run()
    return old
  }
}
