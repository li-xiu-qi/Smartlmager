import { NextRequest, NextResponse } from 'next/server'
import { listConversations } from '@/app/api/v1/ai/_lib/chat-core'

/**
 * GET /api/v1/ai/conversations — 会话列表（按最后一条消息时间倒序）
 * 查询参数：limit（默认 20）、offset（默认 0）
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '20', 10) || 20))
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0)
    const rows = listConversations(limit, offset)
    return NextResponse.json({
      code: 0,
      message: '获取会话列表成功',
      data: { items: rows, limit, offset, total: rows.length },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'LIST_CONVERSATIONS_ERROR', message: e?.message || '获取会话列表失败', data: null },
      { status: 500 },
    )
  }
}
