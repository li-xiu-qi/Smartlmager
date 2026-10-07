import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { encodeText, encodeImage, vectorSearch } from '@/lib/inference'
import fs from 'fs'

// GET /api/v1/search/similar/[id] - 找相似图片
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const vectorType = searchParams.get('vector_type') || 'image'
    const limit = Number(searchParams.get('limit') || 10)

    const db = getDb()
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(Number(id)) as any
    if (!row) return NextResponse.json({ code: 'NOT_FOUND', message: '图片不存在', data: null }, { status: 404 })

    // 编码查询向量
    let queryVector: number[] | null = null
    if (vectorType === 'image' && row.filepath && fs.existsSync(row.filepath)) {
      const vecs = await encodeImage([row.filepath])
      queryVector = vecs?.[0] || null
    } else if (vectorType === 'title' && row.title) {
      const vecs = await encodeText([row.title])
      queryVector = vecs?.[0] || null
    } else if (vectorType === 'description' && row.description) {
      const vecs = await encodeText([row.description])
      queryVector = vecs?.[0] || null
    }

    if (!queryVector) {
      return NextResponse.json({ code: 'NO_QUERY', message: '无法生成查询向量', data: null }, { status: 422 })
    }

    // 搜索
    const results = await vectorSearch(queryVector, vectorType, limit + 1)
    // 排除自己
    const filtered = results.filter((r) => r.image_id !== Number(id)).slice(0, limit)

    // 补充图片信息
    const enriched = filtered.map((r) => {
      const img = db.prepare('SELECT id, filename, title, description, filepath, tags FROM images WHERE id = ?').get(r.image_id) as any
      return { ...r, image: img || null }
    })

    return NextResponse.json({
      code: 0, message: 'success',
      data: enriched,
      metadata: { query_id: Number(id), vector_type: vectorType, total: enriched.length }
    })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
