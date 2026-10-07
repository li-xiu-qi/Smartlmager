import { NextResponse } from 'next/server'
import { getDb, countDistinctTags } from '@/lib/db'

// GET /api/v1/system/database —— 数据库状态（对齐旧 FastAPI /system/database）
export async function GET() {
  try {
    const db = getDb()

    const imgStats = db
      .prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(file_size), 0) as total FROM images')
      .get() as { cnt: number; total: number }
    const tagCount = countDistinctTags()

    // 向量表存在性：有表即视为向量功能可用
    const vectorTables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('title_vectors','desc_vectors','image_vectors','vectors')"
      )
      .all() as { name: string }[]

    const versionRow = db.prepare('SELECT sqlite_version() as v').get() as { v: string }

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: {
        status: 'connected',
        type: 'sqlite',
        path: db.name,
        image_count: imgStats.cnt,
        total_size: imgStats.total,
        tag_count: tagCount,
        vector_status: vectorTables.length > 0,
        db_version: versionRow.v,
        error: null,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: e.message, data: null },
      { status: 500 }
    )
  }
}
