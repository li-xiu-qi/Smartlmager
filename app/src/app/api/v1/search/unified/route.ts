import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { encodeText, vectorSearch } from '@/lib/inference'

// GET /api/v1/search/unified —— 文本语义搜索
// 契约对齐旧 FastAPI /api/v1/search/unified 与前端 searchClient.searchByText。
export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim()
    if (!q) {
      return NextResponse.json({ code: 'BAD_REQUEST', message: '缺少查询文本 q', data: null }, { status: 400 })
    }

    // vector_targets 兼容两种传法：FastAPI 风格的 vector_targets[]（可能带逗号）与 vector_targets
    const rawTargets = searchParams.get('vector_targets[]') ?? searchParams.get('vector_targets')
    let targets = (rawTargets ? rawTargets.split(',') : ['title', 'description', 'image'])
      .map((s) => s.trim())
      .filter((t): t is 'title' | 'description' | 'image' => t === 'title' || t === 'description' || t === 'image')
    if (!targets.length) targets = ['title', 'description', 'image']

    const limit = Math.min(Number(searchParams.get('limit') || 20), 100)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)
    const tags = searchParams.get('tags')
      ? searchParams.get('tags')!.split(',').map((s) => s.trim()).filter(Boolean)
      : []

    let weights: Record<string, number> = {}
    const rawWeights = searchParams.get('weights')
    if (rawWeights) {
      try {
        const parsed = JSON.parse(rawWeights)
        if (parsed && typeof parsed === 'object') weights = parsed
      } catch {
        // 权重格式非法时忽略，全部按 1 计
      }
    }
    const minScore = searchParams.get('min_score') ? Number(searchParams.get('min_score')) : null

    // 查询向量：语义查询走文本编码
    const vecs = await encodeText([q])
    const queryVector = vecs?.[0]
    if (!queryVector) {
      return NextResponse.json(
        { code: 'INFERENCE_UNAVAILABLE', message: '推理服务不可用，无法生成查询向量', data: null },
        { status: 503 }
      )
    }

    // 逐个向量目标检索，按权重累加得分（同一图片命中多个目标时累加）
    const merged = new Map<number, number>()
    // 每个目标多取一些，保证合并与分页后有足够结果
    const perTarget = Math.max(limit + offset + 10, 30)
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
    const page = candidates.slice(offset, offset + limit)

    // 补图片详情
    const db = getDb()
    const items = page
      .map((c) => {
        const img = db
          .prepare('SELECT id, filename, title, description, tags, created_at, filepath FROM images WHERE id = ?')
          .get(c.image_id) as any
        if (!img) return null
        // 标签过滤：命中标签需为查询标签的子集（多标签 AND）
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
        query: q,
        vector_targets: targets,
        total_results: total,
        execution_time_ms: Date.now() - startedAt,
        reference_image: null,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
