import { NextRequest, NextResponse } from 'next/server'
import { listMessages, listMessagesOpenai } from '@/app/api/v1/ai/_lib/chat-core'

/**
 * GET /api/v1/ai/conversations/[id]/messages — 会话消息（最多 40 条，时间正序）
 * 查询参数：limit（默认 40，上限 100）、openai_only（true 时只返回 openai_messages）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sp = req.nextUrl.searchParams
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '40', 10) || 40))
    const openaiOnly = sp.get('openai_only') === 'true'

    const rows = listMessages(id, limit)
    const openai = listMessagesOpenai(id, limit)
    return NextResponse.json({
      code: 0,
      message: '获取会话消息成功',
      data: {
        conversation_id: id,
        messages: openaiOnly ? [] : rows,
        openai_messages: openai,
        total: rows.length,
        limit,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'CONVERSATION_HISTORY_ERROR', message: e?.message || '获取会话消息失败', data: null },
      { status: 500 },
    )
  }
}
