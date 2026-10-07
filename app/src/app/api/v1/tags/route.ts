import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET /api/v1/tags - 获取所有标签及计数
export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') || '').toLowerCase()

    const rows = db.prepare("SELECT tags FROM images WHERE tags IS NOT NULL AND tags != '[]' AND tags != ''").all() as any[]
    const tagCount = new Map<string, number>()

    for (const row of rows) {
      try {
        const tags: string[] = JSON.parse(row.tags || '[]')
        for (const t of tags) {
          if (search && !t.toLowerCase().includes(search)) continue
          tagCount.set(t, (tagCount.get(t) || 0) + 1)
        }
      } catch {}
    }

    const tags = Array.from(tagCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({ code: 0, message: 'success', data: tags, metadata: { total: tags.length } })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
