import { NextResponse } from 'next/server'
import { getDb, countDistinctTags } from '@/lib/db'
import path from 'path'

// GET /api/v1/system/storage —— 存储统计（对齐旧 FastAPI /system/storage）
export async function GET() {
  try {
    const db = getDb()

    const imgStats = db
      .prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(file_size), 0) as total FROM images')
      .get() as { cnt: number; total: number }
    const tagCount = countDistinctTags()

    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads')

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: {
        total_images: imgStats.cnt,
        total_size_mb: Math.round((imgStats.total / (1024 * 1024)) * 100) / 100,
        total_tags: tagCount,
        upload_dir: uploadDir,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: e.message, data: null },
      { status: 500 }
    )
  }
}
