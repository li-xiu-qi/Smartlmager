import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { vectorDelete } from '@/lib/inference'
import fs from 'fs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const db = getDb()
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(parseInt(id))
    if (!row) return NextResponse.json({ code: 'NOT_FOUND', message: '图片不存在', data: null }, { status: 404 })
    return NextResponse.json({ code: 0, message: 'success', data: row })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const imageId = parseInt(id)
    const db = getDb()
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId) as any
    if (!row) return NextResponse.json({ code: 'NOT_FOUND', message: '图片不存在', data: null }, { status: 404 })
    db.prepare('DELETE FROM images WHERE id = ?').run(imageId)
    await vectorDelete(imageId)
    try { fs.unlinkSync(row.filepath) } catch {}
    return NextResponse.json({ code: 0, message: 'success', data: { id: imageId } })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
    values.push(now, Number(id))

    db.prepare(`UPDATE images SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(Number(id))
    return NextResponse.json({ code: 0, message: 'success', data: row })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
