/**
 * AI 对话式推荐：核心业务逻辑
 *
 * 供 /api/v1/ai/recommend/chat 与 /api/v1/ai/recommend/chat/stream 共用。
 * 数据读写本地 SQLite（conversation_messages / request_sessions / images），
 * 向量召回走远程推理服务 8100（encodeText + vectorSearch）。
 */
import { randomUUID } from 'crypto'
import { getDb } from '@/lib/db'
import { encodeText, vectorSearch } from '@/lib/inference'

/** 可用的向量字段白名单，避免把中文标签当成向量表名 */
export const ALLOWED_VECTOR_TYPES = ['title', 'description', 'image']

export interface ChatFilters {
  tags?: string | string[]
  filename?: string
  start_date?: string
  end_date?: string
}

export interface ChatRequestBody {
  messages?: Array<{ role?: string; content?: string }>
  query?: string
  vector_targets?: string[]
  limit?: number
  filters?: ChatFilters
  conversation_id?: string
  user_id?: string
  request_id?: string
}

/** 生成 ISO 时间串（旧后端同一格式，便于按字符串排序比较） */
export function nowIso(): string {
  return new Date().toISOString()
}

/** 解析 limit：缺省 20，夹在 1~100 */
export function normalizeLimit(limit: unknown): number {
  const n = typeof limit === 'number' ? limit : parseInt(String(limit ?? ''), 10)
  if (!Number.isFinite(n)) return 20
  return Math.min(100, Math.max(1, n))
}

/** 取出本轮用户查询：优先 query，其次 messages 里最后一条非空 user */
export function extractUserQuery(body: ChatRequestBody): string {
  const q = (body?.query || '').trim()
  if (q) return q
  const msgs = Array.isArray(body?.messages) ? body.messages : []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m && m.role === 'user' && (m.content || '').trim()) return m.content!.trim()
  }
  return ''
}

/** 向量字段归一化：只保留白名单且去重，缺省 title */
export function normalizeVectorTargets(targets?: string[]): string[] {
  const list = Array.isArray(targets)
    ? targets.filter((t) => typeof t === 'string' && ALLOWED_VECTOR_TYPES.includes(t))
    : []
  const unique = Array.from(new Set(list))
  return unique.length ? unique : ['title']
}

/** 安全解析库里的 JSON 文本字段 */
export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value as T
  try {
    const parsed = JSON.parse(String(value))
    return parsed === null ? fallback : (parsed as T)
  } catch {
    return fallback
  }
}

/** 写入一条对话消息，返回自增 id */
export function addMessage(
  conversationId: string,
  role: string,
  content: string,
  imageIds?: number[] | null,
  metadata?: Record<string, unknown> | null,
): number {
  const db = getDb()
  return db
    .prepare(
      `INSERT INTO conversation_messages (conversation_id, role, content, image_ids, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conversationId,
      role,
      content ?? '',
      imageIds && imageIds.length ? JSON.stringify(imageIds) : null,
      metadata ? JSON.stringify(metadata) : null,
      nowIso(),
    ).lastInsertRowid as number
}

/** 读取会话消息：按时间正序，最多 limit 条（默认 40），image_ids/metadata 已解析 */
export function listMessages(conversationId: string, limit = 40): Array<Record<string, unknown>> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT * FROM conversation_messages WHERE conversation_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(conversationId, limit) as Array<Record<string, unknown>>
  // 反转为时间正序
  const ordered = rows.reverse()
  for (const r of ordered) {
    if (r.image_ids !== null && r.image_ids !== undefined) {
      r.image_ids = parseJsonField<number[]>(r.image_ids, [])
    }
    if (r.metadata !== null && r.metadata !== undefined) {
      r.metadata = parseJsonField<Record<string, unknown> | null>(r.metadata, null)
    }
  }
  return ordered
}

/** 只取 role + content，过滤空内容的 user/assistant（保留 system 空串） */
export function listMessagesOpenai(conversationId: string, limit = 40): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = []
  for (const r of listMessages(conversationId, limit)) {
    const role = String(r.role || 'user')
    const content = String(r.content || '')
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    if (!content && role !== 'system') continue
    result.push({ role, content })
  }
  return result
}

/** 会话列表：按最后一条消息时间倒序 */
export function listConversations(limit = 20, offset = 0): Array<Record<string, unknown>> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT conversation_id, MIN(created_at) AS first_at, MAX(created_at) AS last_at,
              COUNT(*) AS message_count
       FROM conversation_messages
       GROUP BY conversation_id
       ORDER BY last_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<Record<string, unknown>>
  for (const r of rows) {
    const last = db
      .prepare(
        `SELECT role, content FROM conversation_messages WHERE conversation_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(r.conversation_id) as { role?: string; content?: string } | undefined
    if (last) {
      r.last_role = last.role
      // 前 80 字符作为列表摘要
      r.last_content_preview = String(last.content || '').slice(0, 80)
    }
  }
  return rows
}

/** 删除会话全部消息，返回删除行数 */
export function deleteConversation(conversationId: string): number {
  const db = getDb()
  return db.prepare(`DELETE FROM conversation_messages WHERE conversation_id = ?`).run(conversationId).changes
}

/** 新建 request_sessions 审计记录 */
export function createRequestSession(data: {
  request_id: string
  conversation_id: string
  user_id?: string | null
  endpoint: string
  messages?: unknown
  state?: unknown
  vector_targets?: unknown
  filters?: unknown
  status?: string
}): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO request_sessions
       (request_id, conversation_id, user_id, endpoint, messages, state, vector_targets,
        filters, selected_ids, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.request_id,
    data.conversation_id,
    data.user_id ?? null,
    data.endpoint,
    data.messages !== undefined ? JSON.stringify(data.messages) : null,
    data.state !== undefined ? JSON.stringify(data.state) : null,
    data.vector_targets !== undefined ? JSON.stringify(data.vector_targets) : null,
    data.filters !== undefined ? JSON.stringify(data.filters) : null,
    null,
    data.status || 'pending',
    null,
    nowIso(),
    nowIso(),
  )
}

/** 按 request_id 更新审计记录（白名单字段，避免 SQL 注入） */
export function updateRequestSession(
  requestId: string,
  updates: { status?: string; error?: string; selected_ids?: number[] },
): void {
  const db = getDb()
  const fields: string[] = []
  const params: unknown[] = []
  if (updates.status !== undefined) {
    fields.push('status = ?')
    params.push(updates.status)
  }
  if (updates.error !== undefined) {
    fields.push('error = ?')
    params.push(updates.error)
  }
  if (updates.selected_ids !== undefined) {
    fields.push('selected_ids = ?')
    params.push(JSON.stringify(updates.selected_ids))
  }
  if (!fields.length) return
  fields.push('updated_at = ?')
  params.push(nowIso(), requestId)
  db.prepare(`UPDATE request_sessions SET ${fields.join(', ')} WHERE request_id = ?`).run(...params)
}

/** 新建会话 id */
export function newConversationId(): string {
  return `conv_${randomUUID()}`
}

/** 结构化过滤条件（标签/文件名/时间范围） */
function applyFilters(rows: Array<Record<string, any>>, filters: ChatFilters): Array<Record<string, any>> {
  const tagList = Array.isArray(filters.tags)
    ? filters.tags.map((t) => String(t).trim()).filter(Boolean)
    : filters.tags
      ? String(filters.tags).split(',').map((t) => t.trim()).filter(Boolean)
      : []
  const filenameKw = filters.filename ? String(filters.filename).toLowerCase() : ''
  const startDate = filters.start_date ? String(filters.start_date) : ''
  const endDate = filters.end_date ? String(filters.end_date) : ''

  return rows.filter((row) => {
    const tags = String(row.tags || '')
    // 标签存在 tags JSON 文本里，要求全部命中
    if (tagList.length && !tagList.every((t) => tags.includes(t))) return false
    if (filenameKw && !String(row.filename || '').toLowerCase().includes(filenameKw)) return false
    if (startDate && String(row.created_at || '') < startDate) return false
    if (endDate && String(row.created_at || '') > endDate) return false
    return true
  })
}

export interface SearchResult {
  images: Array<Record<string, any>>
  imageIds: number[]
  /** 有值表示本次检索不可用（如推理服务不可达） */
  error?: string
}

/**
 * 向量召回 + 结构化过滤。
 * 多路召回：每个向量字段各查一次，同一张图取最高分；再做 filters 过滤与 limit 截断。
 */
export async function searchRecommendedImages(
  query: string,
  opts: { vectorTargets: string[]; filters?: ChatFilters; limit: number },
): Promise<SearchResult> {
  const db = getDb()
  const { vectorTargets, filters = {}, limit } = opts
  // 多召回一些，给后续过滤留余量
  const recallLimit = Math.min(200, Math.max(limit * 4, limit + 20))

  const best = new Map<number, { score: number; vector_type: string }>()
  let encoded = false
  for (const vt of vectorTargets) {
    let vectors: number[][] | null = null
    try {
      vectors = await encodeText([query])
    } catch {
      vectors = null
    }
    const queryVector = vectors?.[0]
    if (!queryVector) continue
    encoded = true
    const results = await vectorSearch(queryVector, vt, recallLimit)
    for (const r of results) {
      const id = Number(r.image_id)
      if (!Number.isFinite(id)) continue
      const prev = best.get(id)
      if (!prev || r.score > prev.score) best.set(id, { score: r.score, vector_type: vt })
    }
  }

  if (!encoded || best.size === 0) {
    return {
      images: [],
      imageIds: [],
      error: encoded ? '未找到相似图片' : '推理服务不可用，无法生成查询向量',
    }
  }

  const ranked = Array.from(best.entries()).sort((a, b) => b[1].score - a[1].score)
  const candidates: Array<Record<string, any>> = []
  for (const [id, info] of ranked) {
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id) as Record<string, any> | undefined
    if (!row) continue
    candidates.push({
      ...row,
      score: Number(Number(info.score).toFixed(4)),
      vector_type: info.vector_type,
      public_url: `/api/v1/images/file/${encodeURIComponent(String(row.filename))}`,
    })
  }

  const images = applyFilters(candidates, filters).slice(0, limit)
  return { images, imageIds: images.map((img) => Number(img.id)) }
}

/** 生成助手回复文本（LLM 改写不可用时的兜底文案，同样用于流式分片） */
export function buildSummaryText(query: string, images: Array<Record<string, any>>): string {
  if (!images.length) return `没有找到与「${query}」匹配的图片，换个关键词试试。`
  const lines = images.map((img, i) => {
    const title = String(img.title || img.filename || `图片${img.id}`)
    const score = typeof img.score === 'number' ? `（相似度 ${(img.score * 100).toFixed(1)}%）` : ''
    return `${i + 1}. ${title}${score}`
  })
  return `已根据「${query}」为您找到 ${images.length} 张相关图片：\n${lines.join('\n')}`
}
