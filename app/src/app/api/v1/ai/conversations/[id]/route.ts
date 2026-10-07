import { NextRequest, NextResponse } from 'next/server'
import { deleteConversation } from '@/app/api/v1/ai/_lib/chat-core'

/**
 * DELETE /api/v1/ai/conversations/[id] — 删除会话（删除其全部消息）
 * 响应：{ code, message, data: { conversation_id, deleted } }
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const deleted = deleteConversation(id)
    return NextResponse.json({
      code: 0,
      message: '删除会话成功',
      data: { conversation_id: id, deleted },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'DELETE_CONVERSATION_ERROR', message: e?.message || '删除会话失败', data: null },
      { status: 500 },
    )
  }
}
