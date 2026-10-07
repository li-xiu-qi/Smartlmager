import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET /api/v1/images/export-all - 导出全部图片元数据为 JSON
export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM images ORDER BY id').all()
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="smartimager-export.json"',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
