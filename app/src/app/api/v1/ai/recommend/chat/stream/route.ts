import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import {
  addMessage,
  buildSummaryText,
  createRequestSession,
  extractUserQuery,
  listMessages,
  normalizeLimit,
  normalizeVectorTargets,
  searchRecommendedImages,
  updateRequestSession,
} from '@/app/api/v1/ai/_lib/chat-core'

/**
 * POST /api/v1/ai/recommend/chat/stream — SSE 流式推荐
 * 事件名固定：rewrite_start / assistant_delta / complete / error
 * 分段符 \n\n，每段内 event: 与 data: 各一行
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
    return new Response(
      JSON.stringify({ code: 'NO_QUERY', message: '缺少用户查询', data: null }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const limit = normalizeLimit(body.limit)
  const vectorTargets = normalizeVectorTargets(body.vector_targets)
  const filters = body.filters || {}
  const requestId = body.request_id || randomUUID()
  const conversationId = body.conversation_id || `conv_${randomUUID()}`
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 发送一段 SSE
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // 本轮 user 消息入库
        addMessage(conversationId, 'user', query)

        // 审计记录（失败不影响主流程）
        try {
          const history = listMessages(conversationId, 40).map((m) => ({
            role: String(m.role || 'user'),
            content: String(m.content || ''),
          }))
          createRequestSession({
            request_id: requestId,
            conversation_id: conversationId,
            user_id: body.user_id ?? null,
            endpoint: '/api/v1/ai/recommend/chat/stream',
            messages: history,
            vector_targets: vectorTargets,
            filters,
            status: 'pending',
          })
        } catch { /* 审计表写入失败可忽略 */ }

        // 查询改写阶段：推理服务 8100 暂无 /chat 接口，跳过改写，直接用原始 query
        send('rewrite_start', {})

        const { images, imageIds, error } = await searchRecommendedImages(query, { vectorTargets, filters, limit })

        if (error) {
          addMessage(conversationId, 'assistant', error, null, { error: true })
          try {
            updateRequestSession(requestId, { status: 'error', error })
          } catch { /* 忽略审计更新失败 */ }
          send('error', { message: error, request_id: requestId, conversation_id: conversationId })
          return
        }

        // 分片推助手回复：先概述句，再逐条图片
        const assistantText = buildSummaryText(query, images)
        const [head, ...rest] = assistantText.split('\n')
        for (const piece of chunkText(head || '', 6)) {
          send('assistant_delta', { delta: piece })
          await new Promise((r) => setTimeout(r, 12))
        }
        for (const line of rest) {
          for (const piece of chunkText(line + '\n', 8)) {
            send('assistant_delta', { delta: piece })
            await new Promise((r) => setTimeout(r, 12))
          }
        }

        // 助手消息入库
        addMessage(conversationId, 'assistant', assistantText, imageIds, { vector_targets: vectorTargets })
        try {
          updateRequestSession(requestId, { status: 'done', selected_ids: imageIds })
        } catch { /* 忽略审计更新失败 */ }

        send('complete', {
          images,
          image_ids: imageIds,
          limit,
          conversation_id: conversationId,
          request_id: requestId,
          total_found: images.length,
          assistant_text: assistantText,
        })
      } catch (e: any) {
        const message = String(e?.message || e)
        try {
          updateRequestSession(requestId, { status: 'error', error: message })
        } catch { /* 忽略审计更新失败 */ }
        try {
          send('error', { message, request_id: requestId, conversation_id: conversationId })
        } catch { /* 流可能已关闭 */ }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/** 按固定长度切分文本，用于模拟流式输出 */
function chunkText(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out.length ? out : ['']
}
