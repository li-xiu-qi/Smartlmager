import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    const sp = req.nextUrl.searchParams
    const page = Math.max(1, parseInt(sp.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '20')))
    const tagFilter = sp.get('tags')
    const keyword = sp.get('keyword') || sp.get('search')

    let where = ''
    const params: (string | number)[] = []
    if (tagFilter) {
      where += ` AND (tags LIKE ? OR title LIKE ? OR description LIKE ?)`
      const like = `%${tagFilter}%`
      params.push(like, like, like)
    }
    if (keyword) {
      where += ` AND (title LIKE ? OR description LIKE ? OR filename LIKE ?)`
      const like = `%${keyword}%`
      params.push(like, like, like)
    }

    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM images WHERE 1=1${where}`).get(...params) as any).cnt
    const totalPages = Math.ceil(total / pageSize)
    const offset = (page - 1) * pageSize
    const rows = db.prepare(`SELECT * FROM images WHERE 1=1${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset)

    return NextResponse.json({
      code: 0, message: 'success',
      data: rows,
      metadata: { pagination: { page, page_size: pageSize, total_items: total, total_pages: totalPages } }
    })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
