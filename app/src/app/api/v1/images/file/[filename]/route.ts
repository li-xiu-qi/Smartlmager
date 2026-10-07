import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { getDb } from '@/lib/db'

// 反斜杠字符，用 charCode 构造避免转义困扰
const BACKSLASH = String.fromCharCode(92)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params

    // 防止路径穿越：只允许纯文件名
    const isUnsafe =
      filename.indexOf('..') !== -1 ||
      filename.indexOf('/') !== -1 ||
      filename.indexOf(BACKSLASH) !== -1
    if (isUnsafe) {
      return NextResponse.json({ error: 'illegal filename' }, { status: 400 })
    }

    const db = getDb()
    const row = db.prepare('SELECT filepath, file_type FROM images WHERE filename = ?').get(filename) as any
    if (!row || !fs.existsSync(row.filepath)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }

    const buffer = fs.readFileSync(row.filepath)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': row.file_type || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
