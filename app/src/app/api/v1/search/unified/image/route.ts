import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { encodeImage, vectorSearch } from '@/lib/inference'
import fs from 'fs'
import os from 'os'
import path from 'path'

// POST /api/v1/search/unified/image —— 上传图片语义搜索（以图搜图）
// 契约对齐旧 FastAPI /api/v1/search/unified/image 与前端 searchClient.searchByUpload。
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  let tmp: string | null = null
  try {
    const form = await req.formData()
    const file = form.get('file')

    // 兼容两种传法：FormData 里的多值字段（前端做法）与逗号分隔字符串（curl 测试友好）
    const pick = (key: string): string[] => {
      const all = form.getAll(key)
      if (all.length > 1) return all.map(String)
      const one = all[0]
      if (typeof one === 'string') return one.split(',').map((s) => s.trim()).filter(Boolean)
      return []
    }

    let targets = pick('search_targets').filter(
      (t): t is 'title' | 'description' | 'image' => t === 'title' || t === 'description' || t === 'image'
    )
    if (!targets.length) targets = ['title', 'description', 'image']

    const limit = Math.min(Number(form.get('limit') || 20), 100)
    const tags = pick('tags')
    const rawWeights = form.get('weights')
    let weights: Record<string, number> = {}
    if (typeof rawWeights === 'string') {
      try {
        const parsed = JSON.parse(rawWeights)
        if (parsed && typeof parsed === 'object') weights = parsed
      } catch {
        // 权重格式非法时忽略
      }
    }
    const rawMin = form.get('min_score')
    const minScore = typeof rawMin === 'string' && rawMin !== '' ? Number(rawMin) : null

    if (!(file instanceof Blob)) {
      return NextResponse.json({ code: 'BAD_REQUEST', message: '缺少上传文件 file', data: null }, { status: 400 })
    }

    // encodeImage 读的是本机路径，先把上传内容落临时文件
    const buf = Buffer.from(await file.arrayBuffer())
    const ext = path.extname(file instanceof File && file.name ? file.name : '') || '.jpg'
    tmp = path.join(os.tmpdir(), `si-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
    fs.writeFileSync(tmp, buf)

    const vecs = await encodeImage([tmp])
    const queryVector = vecs?.[0]
    if (!queryVector) {
      return NextResponse.json(
        { code: 'INFERENCE_UNAVAILABLE', message: '推理服务不可用，无法编码查询图片', data: null },
        { status: 503 }
      )
    }

    const merged = new Map<number, number>()
    const perTarget = Math.max(limit + 10, 30)
    for (const target of targets) {
      const w = typeof weights[target] === 'number' ? weights[target] : 1
      if (w <= 0) continue
      const hits = await vectorSearch(queryVector, target, perTarget)
      for (const hit of hits) {
        const prev = merged.get(hit.image_id) || 0
        merged.set(hit.image_id, prev + (hit.score ?? 0) * w)
      }
    }

    let candidates = Array.from(merged.entries()).map(([image_id, score]) => ({ image_id, score }))
    if (minScore !== null && !Number.isNaN(minScore)) {
      candidates = candidates.filter((c) => c.score >= minScore)
    }
    candidates.sort((a, b) => b.score - a.score)
    const total = candidates.length
    const page = candidates.slice(0, limit)

    const db = getDb()
    const items = page
      .map((c) => {
        const img = db
          .prepare('SELECT id, filename, title, description, tags, created_at, filepath FROM images WHERE id = ?')
          .get(c.image_id) as any
        if (!img) return null
        if (tags.length) {
          let imgTags: string[] = []
          try {
            const parsed = JSON.parse(img.tags || '[]')
            imgTags = Array.isArray(parsed) ? parsed.map(String) : []
          } catch {
            imgTags = []
          }
          if (!tags.every((t) => imgTags.includes(t))) return null
        }
        return { ...img, score: c.score }
      })
      .filter(Boolean)

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: items,
      metadata: {
        search_targets: targets,
        total_results: total,
        execution_time_ms: Date.now() - startedAt,
        reference_image: null,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  } finally {
    if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp)
  }
}
