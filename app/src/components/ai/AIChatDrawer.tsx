'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, MessageSquarePlus, Send, Square, Trash2, History, Loader2 } from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import GalleryImageCard from '@/components/GalleryImageCard'
import ImageDetailSheet from '@/components/ImageDetailSheet'
import { imageService } from '@/services/api'
import type { ImageDetail } from '@/services/api'
import {
  startChatStream,
  getConversations,
  deleteConversation,
  getMessages,
  type ChatMessage,
  type ChatStreamEvent,
  type ConversationSummary,
} from '@/services/chatService'

/** 迷你 markdown：只覆盖助手回复常用语法，避免引入 react-markdown 依赖 */
function MiniMarkdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const inline = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-[12px]">$1</code>')

    const blocks: string[] = []
    const lines = text.split('\n')
    let list: string[] = []
    const flushList = () => {
      if (list.length) {
        blocks.push(`<ul class="my-2 list-disc space-y-1 pl-5">${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`)
        list = []
      }
    }
    for (const raw of lines) {
      const line = raw.trimEnd()
      if (!line.trim()) { flushList(); continue }
      if (line.startsWith('### ')) { flushList(); blocks.push(`<h4 class="mb-1 mt-3 text-sm font-semibold">${inline(line.slice(4))}</h4>`); continue }
      if (line.startsWith('## ')) { flushList(); blocks.push(`<h3 class="mb-1 mt-3 text-base font-semibold">${inline(line.slice(3))}</h3>`); continue }
      if (line.startsWith('# ')) { flushList(); blocks.push(`<h2 class="mb-1 mt-3 text-lg font-semibold">${inline(line.slice(2))}</h2>`); continue }
      if (/^[-*]\s+/.test(line)) { list.push(inline(line.replace(/^[-*]\s+/, ''))); continue }
      flushList()
      blocks.push(`<p class="my-1.5">${inline(line)}</p>`)
    }
    flushList()
    return blocks.join('')
  }, [text])

  return <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
}

interface ToastState { msg: string; type: 'success' | 'error' | 'info' }

/** 后端可能给 JSON 字符串或数组形式的 tags，统一成 string[] */
function safeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags
  if (typeof tags === 'string') {
    try {
      const v = JSON.parse(tags)
      return Array.isArray(v) ? v : []
    } catch { return [] }
  }
  return []
}

/** 带相似度得分的图片数据，匹配 GalleryImageCard 的 props 类型 */
type ScoredImage = ImageDetail & { score?: number }

export default function AIChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailImage, setDetailImage] = useState<ImageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  /** 消息索引 -> 已补全的完整图片数据（brief 只带 id/title/tags，网格需要 filename） */
  const [hydrated, setHydrated] = useState<Record<number, ScoredImage[]>>({})

  const abortRef = useRef<AbortController | null>(null)
  const bufferRef = useRef('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const hydratedRef = useRef<Set<string>>(new Set())

  const showToast = useCallback((msg: string, type: ToastState['type'] = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2600)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, loading])

  /** brief 只有 id/title/tags，GalleryImageCard 需要完整 ImageDetail 才能出图 */
  const hydrate = useCallback(async (index: number, brief: NonNullable<ChatMessage['images_brief']>) => {
    const key = `${index}:${brief.map((b) => b.id).join(',')}`
    if (hydratedRef.current.has(key)) return
    hydratedRef.current.add(key)
    const results = await Promise.all(
      brief.map(async (b): Promise<ScoredImage> => {
        try {
          const res = await imageService.getDetail(b.id)
          if (res.data) return { ...res.data, score: b.score }
        } catch { /* 单张失败则回退到 brief 构造的占位数据 */ }
        return {
          id: b.id, filename: '', filepath: '', title: b.title ?? `图片#${b.id}`,
          description: '', file_size: 0, file_type: '', width: 0, height: 0,
          created_at: '', updated_at: '', metadata: '',
          tags: JSON.stringify(b.tags ?? []), score: b.score,
        }
      })
    )
    setHydrated((prev) => ({ ...prev, [index]: results }))
  }, [])

  // 助手消息带出图片 brief 时，补全完整数据以渲染 GalleryImageCard
  useEffect(() => {
    messages.forEach((m, idx) => {
      if (m.role === 'assistant' && m.images_brief?.length && !hydrated[idx]) {
        hydrate(idx, m.images_brief)
      }
    })
  }, [messages, hydrate, hydrated])

  const applyEvent = useCallback((evt: ChatStreamEvent) => {
    if (evt.type === 'rewrite_start') {
      if (!conversationId && evt.raw?.conversation_id) setConversationId(evt.raw.conversation_id)
      if (evt.raw?.optimized_query && evt.raw?.rewrite_success
        && evt.raw.optimized_query !== evt.raw.original_query) {
        showToast(`AI 已优化检索：${evt.raw.original_query} → ${evt.raw.optimized_query}`, 'info')
      }
    } else if (evt.type === 'assistant_delta') {
      bufferRef.current += evt.delta
      const text = bufferRef.current
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant' && last.draft) {
          copy[copy.length - 1] = { ...last, content: text }
        } else {
          copy.push({ role: 'assistant', content: text, draft: true })
        }
        return copy
      })
    } else if (evt.type === 'complete') {
      const payload = evt.payload
      // 真实接口给完整 images，契约里的 images_brief 可能缺失，两种都兼容
      const brief: NonNullable<ChatMessage['images_brief']> = payload.images_brief?.length
        ? payload.images_brief
        : (payload.images ?? []).map((img: Record<string, any>) => ({
          id: Number(img.id),
          score: typeof img.score === 'number' ? img.score : undefined,
          title: img.title,
          tags: typeof img.tags === 'string' ? safeTags(img.tags) : (img.tags ?? []),
          public_url: img.public_url,
        }))
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        const final: ChatMessage = {
          role: 'assistant',
          content: payload.assistant_text || bufferRef.current,
          image_ids: payload.image_ids,
          images_brief: brief,
        }
        if (last && last.role === 'assistant' && last.draft) copy[copy.length - 1] = final
        else copy.push(final)
        return copy
      })
      setLoading(false)
      if (brief.length) showToast(`本轮推荐 ${brief.length} 张图片`, 'success')
    } else if (evt.type === 'error') {
      setError(evt.message)
      setLoading(false)
      showToast(evt.message, 'error')
    }
  }, [conversationId, showToast])

  const handleSend = useCallback(() => {
    const query = input.trim()
    if (!query || loading) return
    setError(null)
    setLoading(true)
    bufferRef.current = ''
    setMessages((prev) => [...prev, { role: 'user', content: query }])
    setInput('')

    const controller = new AbortController()
    abortRef.current = controller
    startChatStream(
      { query, conversationId: conversationId ?? undefined, abortController: controller },
      applyEvent
    )
  }, [input, loading, conversationId, applyEvent])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
    setMessages((prev) => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      // 草稿定稿，避免留下半个流式气泡
      if (last && last.role === 'assistant' && last.draft) {
        copy[copy.length - 1] = { ...last, draft: false, content: last.content || '（已停止生成）' }
      }
      return copy
    })
    showToast('已停止生成', 'info')
  }, [showToast])

  const resetConversation = useCallback(() => {
    abortRef.current?.abort()
    bufferRef.current = ''
    setConversationId(null)
    setMessages([])
    setError(null)
    setLoading(false)
    setHydrated({})
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryOpen(true)
    try {
      setConversations(await getConversations())
    } catch (e) {
      showToast((e as Error)?.message || '历史会话加载失败', 'error')
    }
  }, [showToast])

  const openConversation = useCallback(async (id: string) => {
    try {
      const msgs = await getMessages(id)
      setConversationId(id)
      setMessages(msgs.map((m) => ({ ...m, draft: false })))
      setError(null)
      setHistoryOpen(false)
    } catch (e) {
      showToast((e as Error)?.message || '消息加载失败', 'error')
    }
  }, [showToast])

  const removeConversation = useCallback(async (id: string) => {
    try {
      await deleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (conversationId === id) resetConversation()
    } catch (e) {
      showToast((e as Error)?.message || '删除失败', 'error')
    }
  }, [conversationId, resetConversation, showToast])

  const openDetail = useCallback(async (id: number) => {
    setDetailOpen(true)
    setDetailLoading(true)
    try {
      const res = await imageService.getDetail(id)
      if (res.data) setDetailImage(res.data)
      else showToast('获取图片详情失败', 'error')
    } catch (e) {
      showToast((e as Error)?.message || '加载失败', 'error')
    } finally {
      setDetailLoading(false)
    }
  }, [showToast])

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
          <SheetHeader className="border-b px-5 py-4">
            <div className="flex items-center justify-between pr-8">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Bot className="h-5 w-5 text-primary" />
                AI 对话推荐
                {conversationId && (
                  <span className="text-xs font-normal text-muted-foreground">#{conversationId.slice(0, 8)}</span>
                )}
              </SheetTitle>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={loadHistory}>
                  <History className="h-3.5 w-3.5" />历史
                </Button>
                <Button
                  size="sm" variant="outline" className="h-8 gap-1.5"
                  disabled={loading}
                  onClick={() => {
                    if (!messages.length) { resetConversation(); return }
                    if (window.confirm('将清空当前对话记录，确定要继续吗？')) resetConversation()
                  }}
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />新建会话
                </Button>
              </div>
            </div>
          </SheetHeader>

          {historyOpen ? (
            <ScrollArea className="flex-1 px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium">历史会话</h3>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setHistoryOpen(false)}>返回对话</Button>
              </div>
              {conversations.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">暂无历史会话</p>
              ) : (
                <ul className="space-y-2">
                  {conversations.map((c) => (
                    <li key={c.id} className="flex items-center justify-between rounded-lg border p-3">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openConversation(c.id)}>
                        <p className="truncate text-sm font-medium">{c.title || '未命名会话'}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {c.message_count} 条消息 · {new Date(c.updated_at).toLocaleString('zh-CN')}
                        </p>
                      </button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeConversation(c.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          ) : (
            <>
              <ScrollArea className="flex-1 px-5 py-4">
                {messages.length === 0 && !loading ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
                    <Bot className="h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">用自然语言描述你想找的图片</p>
                    <p className="text-xs text-muted-foreground/70">例如：找一些有海滩日落的照片</p>
                  </div>
                ) : (
                  <ul className="space-y-4">
                    {messages.map((m, idx) => {
                      const isUser = m.role === 'user'
                      const brief = m.images_brief ?? []
                      const cards = hydrated[idx] ?? []
                      return (
                        <li key={idx} className={isUser ? 'flex justify-end' : ''}>
                          <div className={isUser ? 'max-w-[85%]' : 'w-full'}>
                            <div className="mb-1.5 flex items-center gap-2">
                              <Badge variant={isUser ? 'default' : 'secondary'} className="text-[11px]">
                                {isUser ? '我' : '助手'}
                              </Badge>
                              {m.draft && (
                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />生成中
                                </span>
                              )}
                            </div>
                            <div className={
                              isUser
                                ? 'rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground'
                                : 'rounded-2xl rounded-tl-sm border bg-card px-3.5 py-2.5'
                            }>
                              {isUser
                                ? <p className="whitespace-pre-wrap break-words">{m.content}</p>
                                : <MiniMarkdown text={m.content} />}
                            </div>

                            {!isUser && brief.length > 0 && (
                              <div className="mt-3">
                                <div className="mb-2 flex items-center gap-2">
                                  <Separator className="flex-1" />
                                  <span className="text-xs text-muted-foreground">本轮推荐 {brief.length} 张</span>
                                  <Separator className="flex-1" />
                                </div>
                                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                                  {cards.length > 0
                                    ? cards.map((img) => (
                                      <GalleryImageCard
                                        key={img.id}
                                        image={img}
                                        showTags
                                        showSimilarity
                                        onClick={() => openDetail(img.id)}
                                      />
                                    ))
                                    : brief.map((b) => (
                                      <button
                                        key={b.id} type="button"
                                        onClick={() => openDetail(b.id)}
                                        className="group overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-foreground/20"
                                      >
                                        <div className="aspect-[4/3] w-full animate-pulse bg-muted" />
                                        <div className="px-2 py-1.5">
                                          <p className="truncate text-xs font-medium">{b.title || `图片#${b.id}`}</p>
                                          {b.score !== undefined && (
                                            <p className="text-[11px] text-muted-foreground">{(b.score * 100).toFixed(1)}%</p>
                                          )}
                                        </div>
                                      </button>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </li>
                      )
                    })}
                    {loading && messages[messages.length - 1]?.role === 'user' && (
                      <li>
                        <Badge variant="secondary" className="text-[11px]">助手</Badge>
                        <div className="mt-1.5 flex items-center gap-2 rounded-2xl rounded-tl-sm border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />正在思考…
                        </div>
                      </li>
                    )}
                  </ul>
                )}
                {error && (
                  <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                )}
                <div ref={bottomRef} />
              </ScrollArea>

              <div className="border-t px-5 py-3.5">
                <Textarea
                  rows={3}
                  placeholder="输入你的需求，例如：找一些有海滩日落的照片"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                  }}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Enter 发送，Shift + Enter 换行</span>
                  {loading ? (
                    <Button size="sm" variant="destructive" className="gap-1.5" onClick={handleStop}>
                      <Square className="h-3.5 w-3.5" />停止生成
                    </Button>
                  ) : (
                    <Button size="sm" className="gap-1.5" disabled={!input.trim()} onClick={handleSend}>
                      <Send className="h-3.5 w-3.5" />发送
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ImageDetailSheet
        image={detailImage}
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetailImage(null) }}
        onUpdate={(img) => setDetailImage(img)}
        onDelete={() => { setDetailOpen(false); setDetailImage(null) }}
      />
      {detailLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/20">
          <Loader2 className="h-6 w-6 animate-spin text-primary-foreground" />
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4">
          <div className={
            'pointer-events-auto rounded-lg px-4 py-2 text-sm text-white shadow-lg ' +
            (toast.type === 'error' ? 'bg-destructive' : toast.type === 'success' ? 'bg-emerald-600' : 'bg-primary')
          }>
            {toast.msg}
          </div>
        </div>
      )}
    </>
  )
}
