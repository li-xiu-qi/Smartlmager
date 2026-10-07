import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { vectorDelete } from '@/lib/inference'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ image_id: string }> }) {
  try {
    const { image_id } = await params
    const db = getDb()
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(Number(image_id))
    if (!row) return NextResponse.json({ code: 'NOT_FOUND', message: '图片不存在', data: null }, { status: 404 })
    return NextResponse.json({ code: 0, message: 'success', data: row })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ image_id: string }> }) {
  try {
    const { image_id } = await params
    const body = await req.json()
    const db = getDb()
    const now = new Date().toISOString()

    const fields: string[] = []
    const values: any[] = []
    for (const key of ['title', 'description', 'tags', 'metadata']) {
      if (key in body) {
        fields.push(`${key} = ?`)
        values.push(typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key])
      }
    }
    if (!fields.length) {
      return NextResponse.json({ code: 'NO_FIELDS', message: '没有要更新的字段', data: null }, { status: 422 })
    }
    fields.push('updated_at = ?')
    values.push(now, Number(image_id))

    db.prepare(`UPDATE images SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(Number(image_id))
    return NextResponse.json({ code: 0, message: 'success', data: row })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ image_id: string }> }) {
  try {
    const { image_id } = await params
    const db = getDb()
    // 删向量
    vectorDelete(Number(image_id)).catch(() => {})
    // 删 DB 记录
    const info = db.prepare('DELETE FROM images WHERE id = ?').run(Number(image_id))
    if (info.changes === 0) {
      return NextResponse.json({ code: 'NOT_FOUND', message: '图片不存在', data: null }, { status: 404 })
    }
    return NextResponse.json({ code: 0, message: 'success', data: { id: Number(image_id) } })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
