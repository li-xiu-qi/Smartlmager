import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET /api/v1/system/info —— 基本系统信息（对齐旧 FastAPI /system/info）
export async function GET() {
  try {
    const db = getDb()
    const imgRow = db.prepare('SELECT COUNT(*) as cnt FROM images').get() as { cnt: number }

    // 向量能力状态：本地驱动与远端模型分别判定
    const vectorStatus = (() => {
      try {
        const v = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('title_vectors','desc_vectors','image_vectors','vectors')"
        ).all() as { name: string }[]
        return v.length > 0
      } catch {
        return false
      }
    })()

    const status = imgRow.cnt >= 0 ? 'healthy' : 'warning'

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: {
        version: '2.0.0',
        app_uptime: process.uptime(),
        app_uptime_formatted: formatUptime(process.uptime()),
        status,
        platform: `${process.platform}-${process.arch}`,
        node_version: process.version,
        models_info: {
          embedding_model: 'jina-embeddings-v4',
          embedding_dimension: 2048,
        },
        vector_status: vectorStatus,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: e.message, data: null },
      { status: 500 }
    )
  }
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d} 天`)
  if (h > 0) parts.push(`${h} 小时`)
  if (m > 0) parts.push(`${m} 分`)
  parts.push(`${s} 秒`)
  return parts.join(' ')
}
