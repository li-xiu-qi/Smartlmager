import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getDb } from '@/lib/db'

// GET /api/v1/system/cache —— 缓存与向量库状态（对齐旧 FastAPI /system/cache）
export async function GET() {
  try {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)

    // 向量状态：本地驱动文件 + 远端推理服务可用性
    const localDriver = (() => {
      try {
        const v = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('title_vectors','desc_vectors','image_vectors','vectors')"
          )
          .all() as { name: string }[]
        return v.length > 0
      } catch {
        return false
      }
    })()

    // 向量库文件大小
    const vecDbPath = db.name
    let vecDbSize = 0
    try {
      const st = fs.statSync(vecDbPath)
      vecDbSize = st.size
    } catch {
      // 文件不可达则记为 0
    }

    const cachePath = process.env.CACHE_DIR || path.join(process.cwd(), 'data', 'cache')
    let cacheSize = 0
    try {
      if (fs.existsSync(cachePath)) {
        const walk = (p: string) => {
          const st = fs.statSync(p)
          if (st.isDirectory()) {
            for (const f of fs.readdirSync(p)) walk(path.join(p, f))
          } else {
            cacheSize += st.size
          }
        }
        walk(cachePath)
      }
    } catch {
      // 缓存目录不存在则记为 0
    }

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: {
        max_size_gb: 2,
        total_size_mb: Math.round(((cacheSize + vecDbSize) / (1024 * 1024)) * 100) / 100,
        text_vector_cache: { path: cachePath, size_mb: Math.round((cacheSize / (1024 * 1024)) * 100) / 100 },
        image_vector_cache: {
          path: vecDbPath,
          size_mb: Math.round((vecDbSize / (1024 * 1024)) * 100) / 100,
        },
        vector_engine: {
          enabled: localDriver,
          driver: { available: localDriver, path: 'built-in', error: '', version: 'sqlite-vec' },
          model: {
            available: false,
            path: process.env.INFERENCE_SERVICE_URL || 'http://192.168.1.170:8100',
            error: '',
            dimension: 2048,
          },
        },
        last_scan: now,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: e.message, data: null },
      { status: 500 }
    )
  }
}
