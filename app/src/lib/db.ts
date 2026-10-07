import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'smartimager.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    initTables(_db)
  }
  return _db
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      title TEXT,
      description TEXT,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT,
      tags TEXT
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )
  `)
}

/**
 * 去重标签总数。
 * 注意：标签实际存在 images.tags 字段（JSON 数组），tags 表是遗留空表。
 * 所有统计口径必须走这个函数，避免与 /api/v1/tags 路由的数字不一致。
 */
export function countDistinctTags(): number {
  const db = getDb()
  const rows = db
    .prepare("SELECT tags FROM images WHERE tags IS NOT NULL AND tags != '[]' AND tags != ''")
    .all() as { tags: string }[]
  const seen = new Set<string>()
  for (const row of rows) {
    try {
      const list = JSON.parse(row.tags || '[]')
      if (Array.isArray(list)) for (const t of list) seen.add(String(t))
    } catch {
      // 跳过解析失败的脏数据
    }
  }
  return seen.size
}
