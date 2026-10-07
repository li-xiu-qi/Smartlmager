import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import {
  addMessage,
  buildSummaryText,
  createRequestSession,
  extractUserQuery,
  normalizeLimit,
  normalizeVectorTargets,
  searchRecommendedImages,
  updateRequestSession,
} from '@/app/api/v1/ai/_lib/chat-core'

/**
 * POST /api/v1/ai/recommend/chat — 非流式推荐
 * 响应：{ code, message, data: { success, images, image_ids, limit, error? } }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, any> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const query = extractUserQuery(body)
  if (!query) {
    return NextResponse.json({ code: 'NO_QUERY', message: '缺少用户查询', data: null }, { status: 400 })
  }

  const limit = normalizeLimit(body.limit)
  const vectorTargets = normalizeVectorTargets(body.vector_targets)
  const filters = body.filters || {}
  const requestId = body.request_id || randomUUID()
  const conversationId = body.conversation_id || `conv_${randomUUID()}`

  try {
    // 写入本轮 user 消息
    addMessage(conversationId, 'user', query)

    // 审计记录（失败不影响主流程）
    try {
      createRequestSession({
        request_id: requestId,
        conversation_id: conversationId,
        user_id: body.user_id ?? null,
        endpoint: '/api/v1/ai/recommend/chat',
        vector_targets: vectorTargets,
        filters,
        status: 'pending',
      })
    } catch { /* 审计表写入失败可忽略 */ }

    const { images, imageIds, error } = await searchRecommendedImages(query, { vectorTargets, filters, limit })

    if (error) {
      try {
        updateRequestSession(requestId, { status: 'error', error })
      } catch { /* 忽略审计更新失败 */ }
      return NextResponse.json(
        {
          code: 'AI_RECOMMENDATION_ERROR',
          message: `对话式推荐暂时不可用: ${error}`,
          data: { success: false, images: [], image_ids: [], limit, error },
        },
        { status: 500 },
      )
    }

    const assistantText = buildSummaryText(query, images)
    addMessage(conversationId, 'assistant', assistantText, imageIds, { vector_targets: vectorTargets })
    try {
      updateRequestSession(requestId, { status: 'done', selected_ids: imageIds })
    } catch { /* 忽略审计更新失败 */ }

    return NextResponse.json({
      code: 0,
      message: 'AI对话式推荐成功',
      data: { success: true, images, image_ids: imageIds, limit },
    })
  } catch (e: any) {
    try {
      updateRequestSession(requestId, { status: 'error', error: String(e?.message || e) })
    } catch { /* 忽略审计更新失败 */ }
    return NextResponse.json(
      {
        code: 'AI_RECOMMENDATION_ERROR',
        message: `对话式推荐暂时不可用: ${e?.message || e}`,
        data: {
          success: false,
          images: [],
          image_ids: [],
          limit,
          error: String(e?.message || e),
        },
      },
      { status: 500 },
    )
  }
}
