import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { addMessage, listMessages } from '@/app/api/v1/ai/_lib/chat-core'

/**
 * POST /api/v1/ai/conversations/create — 新建会话
 * 请求：{ conversation_id?, system_prompt? }
 * 响应：{ code, message, data: { conversation_id } }
 */
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, any> = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    // 指定则沿用，否则新生成
    const requested = typeof body.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const conversationId = requested || `conv_${randomUUID()}`

    // 仅在会话还没有任何消息时写入自定义 system 消息
    const systemPrompt = typeof body.system_prompt === 'string' ? body.system_prompt : ''
    if (systemPrompt && listMessages(conversationId, 1).length === 0) {
      addMessage(conversationId, 'system', systemPrompt)
    }

    return NextResponse.json({
      code: 0,
      message: '创建会话成功',
      data: { conversation_id: conversationId },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'CREATE_CONVERSATION_ERROR', message: e?.message || '创建会话失败', data: null },
      { status: 500 },
    )
  }
}
