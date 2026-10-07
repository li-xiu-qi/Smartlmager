import { imageService } from '@/services/api'
import type { ImageDetail } from '@/services/api'

/**
 * AI 对话 / 推荐服务层
 *
 * 接口契约见仓库根 MIGRATION-NOTES.md「AI 对话/推荐接口契约」一节。
 * SSE 解析逻辑沿用旧前端（frontend/src/services/chatService.ts），
 * 事件名 rewrite_start / assistant_delta / complete / error 不得改动。
 */

/** AI 接口接入状态。后端 /api/v1/ai/* 路由已就位（2026-09-09 实测 conversations 200、
 *  recommend/chat 与 stream 均返回契约事件），故置 true 走真实接口。
 *  后端若临时下线，改回 false 即可退回本地 mock 流。 */
export const AI_API_ENABLED = true

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  image_ids?: number[]
  images_brief?: Array<{ id: number; score?: number; title?: string; tags?: string[]; public_url?: string }>
  /** 本地标记：尚未定稿的流式草稿 */
  draft?: boolean
}

export interface ChatStreamCompletePayload {
  request_id: string
  conversation_id: string
  image_ids: number[]
  images_brief: ChatMessage['images_brief']
  assistant_text: string
  total_found: number
  /** 完整图片行。契约只保证 images_brief，后端当前实现给的是完整 images，两者都兼容 */
  images?: Array<Record<string, any>>
  /** 查询改写信息（后端可选返回） */
  query_rewrite?: { original_query: string; optimized_query: string; rewrite_success: boolean }
}

export type ChatStreamEvent =
  | { type: 'rewrite_start'; raw: any }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'complete'; payload: ChatStreamCompletePayload }
  | { type: 'error'; message: string }

export interface StartChatStreamParams {
  query: string
  conversationId?: string
  userId?: string
  limit?: number
  abortController?: AbortController
}

export interface ChatStreamHandle {
  conversationId: string
  requestId: string
  cancel: () => void
}

export interface ConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

const BASE = '/api/v1/ai'

/**
 * 解析单个 SSE 分段（段内 event: 与 data: 各一行）。
 * fetch 流与 mock 流共用这一份解析逻辑，保证事件名一致。
 */
function parseSseSegment(segment: string, onEvent: (e: ChatStreamEvent) => void) {
  if (!segment.trim()) return
  const lines = segment.split('\n')
  let eventName = ''
  let dataLine = ''
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.replace('event:', '').trim()
    else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
    else dataLine += line.trim()
  }
  let dataObj: any = {}
  try {
    dataObj = dataLine ? JSON.parse(dataLine) : {}
  } catch {
    return // 解析失败直接跳过该段
  }
  if (eventName === 'rewrite_start') onEvent({ type: 'rewrite_start', raw: dataObj })
  else if (eventName === 'assistant_delta') onEvent({ type: 'assistant_delta', delta: dataObj.delta || '' })
  else if (eventName === 'complete') onEvent({ type: 'complete', payload: dataObj })
  else if (eventName === 'error') onEvent({ type: 'error', message: dataObj.message || '未知错误' })
}

/** 拼接 SSE 事件文本（mock 用，格式与后端契约一致） */
function sseEvent(name: string, data: unknown) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * 流式对话推荐。返回句柄含 cancel()。
 * AI_API_ENABLED 为 false 时走本地 mock 流（事件序列与真实接口一致）。
 */
export function startChatStream(
  params: StartChatStreamParams,
  onEvent: (e: ChatStreamEvent) => void
): ChatStreamHandle {
  const { query, conversationId, userId, limit = 20 } = params
  const controller = params.abortController || new AbortController()
  const reqId = 'req_' + Date.now()

  if (!AI_API_ENABLED) {
    void runMockStream({ query, conversationId, userId, limit }, onEvent, controller)
    return { conversationId: conversationId || '', requestId: reqId, cancel: () => controller.abort() }
  }

  const body = JSON.stringify({
    query,
    conversation_id: conversationId,
    user_id: userId,
    limit,
  })

  fetch(`${BASE}/recommend/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: controller.signal,
  })
    .then(async (resp) => {
      if (!resp.ok || !resp.body) {
        onEvent({ type: 'error', message: `响应异常（HTTP ${resp.status}）` })
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE 基于 \n\n 分段
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          parseSseSegment(chunk, onEvent)
        }
      }
      // 冲刷尾部残留分段
      if (buffer.trim()) parseSseSegment(buffer, onEvent)
    })
    .catch((err) => {
      if (controller.signal.aborted) return
      onEvent({ type: 'error', message: err?.message || '网络错误' })
    })

  return { conversationId: conversationId || '', requestId: reqId, cancel: () => controller.abort() }
}

/**
 * Mock 流：按契约事件序列输出，图片从本地图库取真实数据，
 * 保证图片网格、详情抽屉在无后端时也能跑通。
 */
async function runMockStream(
  params: { query: string; conversationId?: string; userId?: string; limit: number },
  onEvent: (e: ChatStreamEvent) => void,
  controller: AbortController
) {
  const convId = params.conversationId || 'conv_' + Date.now().toString(36)
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })

  try {
    onEvent({
      type: 'rewrite_start',
      raw: {
        conversation_id: convId,
        original_query: params.query,
        optimized_query: params.query,
        rewrite_success: false,
      },
    })
    await sleep(300)

    // 真实图库取图，构造 images_brief
    let images: ImageDetail[] = []
    try {
      const res = await imageService.getList({ page: 1, page_size: Math.min(params.limit, 8) })
      if (res.data) images = res.data
    } catch {
      images = []
    }
    const imageIds = images.map((i) => i.id)
    const brief = images.map((i, idx) => ({
      id: i.id,
      score: Number((0.92 - idx * 0.06).toFixed(3)),
      title: i.title,
      tags: typeof i.tags === 'string' ? safeParseTags(i.tags) : [],
      public_url: `/api/v1/images/file/${i.filename}`,
    }))

    const text =
      `已根据「${params.query}」完成检索，本轮命中 ${images.length} 张图片。\n\n` +
      `- 相似度按向量检索得分排序\n` +
      `- 点击缩略图可查看图片详情\n` +
      `- 当前为 **mock 流**，后端 /api/v1/ai 就绪后自动切换为真实接口`
    // 逐字输出，模拟 assistant_delta
    for (let i = 0; i < text.length; i += 2) {
      if (controller.signal.aborted) return
      onEvent({ type: 'assistant_delta', delta: text.slice(i, i + 2) })
      await sleep(24)
    }

    onEvent({
      type: 'complete',
      payload: {
        request_id: 'mock_' + Date.now().toString(36),
        conversation_id: convId,
        image_ids: imageIds,
        images_brief: brief,
        assistant_text: text,
        total_found: images.length,
      },
    })
    saveMockMessages(convId, params.query, text, imageIds, brief)
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    onEvent({ type: 'error', message: (err as Error)?.message || 'mock 流异常' })
  }
}

function safeParseTags(tags: string): string[] {
  try {
    const v = JSON.parse(tags)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/* ---------------- 会话管理（mock 落 localStorage） ---------------- */

const MOCK_CONV_KEY = 'ai_mock_conversations'

interface MockConversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  messages: ChatMessage[]
}

function readMockConvs(): MockConversation[] {
  try {
    const raw = localStorage.getItem(MOCK_CONV_KEY)
    return raw ? (JSON.parse(raw) as MockConversation[]) : []
  } catch {
    return []
  }
}

function writeMockConvs(list: MockConversation[]) {
  try {
    localStorage.setItem(MOCK_CONV_KEY, JSON.stringify(list.slice(-30)))
  } catch {
    /* 存储不可用时静默降级 */
  }
}

/** 会话列表，新的在前。
 *  真实接口返回 { data: { items: [...] } }，字段为 conversation_id / first_at / last_at；
 *  这里统一归一成 ConversationSummary，mock 与真实两种结构都能吃。 */
export async function getConversations(): Promise<ConversationSummary[]> {
  if (!AI_API_ENABLED) {
    return readMockConvs()
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(({ id, title, created_at, updated_at, messages }) => ({
        id, title, created_at, updated_at, message_count: messages.length,
      }))
  }
  const res = await fetch(`${BASE}/conversations`).then((r) => r.json())
  const items: any[] = res?.data?.items ?? res?.data ?? []
  return items.map((c) => ({
    id: c.conversation_id ?? c.id,
    title: c.last_content_preview ?? c.title ?? '未命名会话',
    created_at: c.first_at ?? c.created_at ?? '',
    updated_at: c.last_at ?? c.updated_at ?? '',
    message_count: c.message_count ?? 0,
  }))
}

export async function createConversation(title = '新对话'): Promise<ConversationSummary> {
  if (!AI_API_ENABLED) {
    const now = new Date().toISOString()
    const conv: MockConversation = { id: 'conv_' + Date.now().toString(36), title, created_at: now, updated_at: now, messages: [] }
    writeMockConvs([...readMockConvs(), conv])
    return { id: conv.id, title, created_at: now, updated_at: now, message_count: 0 }
  }
  const res = await fetch(`${BASE}/conversations/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }).then((r) => r.json())
  return res.data
}

export async function deleteConversation(id: string): Promise<void> {
  if (!AI_API_ENABLED) {
    writeMockConvs(readMockConvs().filter((c) => c.id !== id))
    return
  }
  await fetch(`${BASE}/conversations/${id}`, { method: 'DELETE' })
}

/** 会话消息（后端最多 40 条）。真实接口返回 { data: { messages: [...] } } */
export async function getMessages(id: string): Promise<ChatMessage[]> {
  if (!AI_API_ENABLED) {
    return readMockConvs().find((c) => c.id === id)?.messages ?? []
  }
  const res = await fetch(`${BASE}/conversations/${id}/messages`).then((r) => r.json())
  const raw: any[] = res?.data?.messages ?? res?.data ?? []
  return raw.map((m) => ({
    role: m.role,
    content: m.content,
    image_ids: m.image_ids ?? undefined,
    images_brief: Array.isArray(m.images_brief) ? m.images_brief : undefined,
  }))
}

/** mock 模式下把一轮问答写入本地会话，便于历史列表可回看 */
function saveMockMessages(
  convId: string,
  query: string,
  answer: string,
  imageIds: number[],
  brief: ChatMessage['images_brief']
) {
  const list = readMockConvs()
  const idx = list.findIndex((c) => c.id === convId)
  const userMsg: ChatMessage = { role: 'user', content: query }
  const assistantMsg: ChatMessage = {
    role: 'assistant', content: answer, image_ids: imageIds, images_brief: brief,
  }
  if (idx === -1) {
    const now = new Date().toISOString()
    list.push({
      id: convId, title: query.slice(0, 20), created_at: now, updated_at: now,
      messages: [userMsg, assistantMsg],
    })
  } else {
    list[idx].messages.push(userMsg, assistantMsg)
    list[idx].updated_at = new Date().toISOString()
    if (list[idx].title === '新对话') list[idx].title = query.slice(0, 20)
  }
  writeMockConvs(list)
}
