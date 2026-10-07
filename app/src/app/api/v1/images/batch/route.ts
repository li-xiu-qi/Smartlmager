import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { vectorDelete } from '@/lib/inference'
import fs from 'fs'

// DELETE /api/v1/images/batch - 批量删除
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const ids: number[] = (body.image_ids || []).map((id: any) => Number(id))
    if (!ids.length) {
      return NextResponse.json({ code: 'NO_IDS', message: '没有要删除的 ID', data: null }, { status: 422 })
    }

    const db = getDb()
    const deleted: number[] = []
    const failed: number[] = []

    for (const id of ids) {
      try {
        const row = db.prepare('SELECT filepath FROM images WHERE id = ?').get(id) as any
        if (!row) { failed.push(id); continue }
        db.prepare('DELETE FROM images WHERE id = ?').run(id)
        try { fs.unlinkSync(row.filepath) } catch {}
        vectorDelete(id).catch(() => {})
        deleted.push(id)
      } catch { failed.push(id) }
    }

    return NextResponse.json({
      code: 0, message: 'success',
      data: { deleted_count: deleted.length, failed_count: failed.length, failed_ids: failed },
    })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
