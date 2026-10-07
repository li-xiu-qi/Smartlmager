import { NextResponse } from 'next/server'
import { inferenceHealth } from '@/lib/inference'
import { getDb, countDistinctTags } from '@/lib/db'
import { getInferenceUrl, readSettings } from '@/lib/settings'

// GET /api/v1/system/config —— 当前生效配置（对齐旧 FastAPI /system/config）
//
// inference_service_url 是可在线调整的项（见 lib/settings.ts）；推理服务侧的模型名
// 硬编码在远端服务里、不从请求读取，因此这里只展示、不可编辑。
export async function GET() {
  try {
    const db = getDb()
    let tagCount = 0
    let imageCount = 0
    try {
      tagCount = countDistinctTags()
      imageCount = (db.prepare('SELECT COUNT(*) as cnt FROM images').get() as { cnt: number }).cnt
    } catch {
      // 表未就绪则记 0
    }

    const inferenceOk = await inferenceHealth()

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: {
        vision_model: process.env.VISION_MODEL || 'glm-4.6v-flash',
        embedding_model: process.env.EMBEDDING_MODEL || 'jina-embeddings-v4',
        embedding_dimension: 2048,
        inference_service_url: getInferenceUrl(),
        // 用户是否已覆盖默认地址，供前端提示「当前为自定义配置」
        inference_service_overridden: Boolean(readSettings().inference_service_url),
        inference_service_status: inferenceOk ? 'ok' : 'unavailable',
        db_path: db.name,
        image_count: imageCount,
        tag_count: tagCount,
        backend: 'next.js',
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: e.message, data: null },
      { status: 500 }
    )
  }
}
