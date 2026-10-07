'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CircleAlert, Image as ImageIcon, ScanSearch, Type } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { imageService, systemService, tagService } from '@/services/api'
import type { ImageDetail } from '@/services/api'
import {
  fuzzySearch,
  searchByText,
  searchByUpload,
  searchSimilar,
  SEARCH_API_STATUS,
} from '@/services/searchClient'
import type {
  FuzzySearchParams,
  ImageSearchRequest,
  SearchOutcome,
  SearchResultItem,
  TextSearchParams,
  UploadImageSearchParams,
} from '@/services/searchClient'
import TextSearchForm from './components/TextSearchForm'
import ImageSearchForm from './components/ImageSearchForm'
import FuzzySearchForm from './components/FuzzySearchForm'
import SearchResults from './components/SearchResults'
import SearchToast from './components/SearchToast'

type TabKey = 'text' | 'image' | 'fuzzy'

type Toast = { message: string; type: 'success' | 'error' | 'info' }

const TAB_LABELS: Record<TabKey, string> = {
  text: '语义搜索',
  image: '以图搜图',
  fuzzy: '关键词搜索',
}

function SearchPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<TabKey>('text')
  const [loading, setLoading] = useState(false)
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [keyword, setKeyword] = useState('')
  const [tags, setTags] = useState<Array<{ name: string; count: number }>>([])
  /** null = 尚未探测到向量能力 */
  const [vectorEnabled, setVectorEnabled] = useState<boolean | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedImage, setSelectedImage] = useState<ImageDetail | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const notify = useCallback((message: string, type: Toast['type'] = 'info') => {
    setToast({ message, type })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  // URL → 初始 tab
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'text' || t === 'image' || t === 'fuzzy') setTab(t)
  }, [searchParams])

  const updateUrl = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString())
      Object.entries(patch).forEach(([key, value]) => {
        if (value) next.set(key, value)
        else next.delete(key)
      })
      router.replace(`/search?${next.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  // 标签 + 向量能力探测
  useEffect(() => {
    tagService
      .getAll()
      .then((res) => setTags(res.data ?? []))
      .catch(() => setTags([]))
    systemService
      .getStatus()
      .then((res) => setVectorEnabled(res.data?.inference_service === 'ok'))
      .catch(() => setVectorEnabled(false))
  }, [])

  // 向量不可用时自动回落到关键词搜索
  useEffect(() => {
    if (vectorEnabled === false && tab !== 'fuzzy') {
      setTab('fuzzy')
      updateUrl({ tab: 'fuzzy' })
    }
  }, [vectorEnabled, tab, updateUrl])

  /** 统一执行一次搜索，处理 loading 与错误提示 */
  const runSearch = useCallback(
    async (task: () => Promise<SearchOutcome>, searchKeyword?: string) => {
      setLoading(true)
      if (searchKeyword !== undefined) setKeyword(searchKeyword)
      try {
        setOutcome(await task())
      } catch (e) {
        setOutcome({ items: [], total: 0, searchTimeMs: 0, referenceImage: null, truncated: false })
        notify(e instanceof Error ? e.message : '搜索失败，请稍后重试', 'error')
      } finally {
        setLoading(false)
      }
    },
    [notify]
  )

  const handleTextSearch = (params: TextSearchParams) => {
    updateUrl({ tab: 'text', q: params.q })
    void runSearch(() => searchByText(params), params.q)
  }

  const handleImageSearch = (request: ImageSearchRequest) => {
    updateUrl({ tab: 'image', q: undefined })
    if (request.mode === 'reference') {
      void runSearch(() => searchSimilar(request.imageId, request.vectorType, request.limit))
      return
    }
    const params: UploadImageSearchParams = request.params
    void runSearch(() => searchByUpload(params))
  }

  const handleFuzzySearch = (params: FuzzySearchParams) => {
    updateUrl({ tab: 'fuzzy', q: params.q })
    void runSearch(() => fuzzySearch(params), params.q)
  }

  const handleResultClick = async (image: SearchResultItem) => {
    setDetailLoading(true)
    setDrawerOpen(true)
    try {
      const res = await imageService.getDetail(image.id)
      setSelectedImage(res.data)
    } catch {
      notify('加载图片详情失败', 'error')
      setDrawerOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleDrawerClose = () => {
    setDrawerOpen(false)
    setSelectedImage(null)
  }

  const handleDelete = (id: number) => {
    setDrawerOpen(false)
    setSelectedImage(null)
    setOutcome((prev) =>
      prev ? { ...prev, items: prev.items.filter((item) => item.id !== id), total: Math.max(0, prev.total - 1) } : prev
    )
  }

  const vectorUnavailable = vectorEnabled === false
  const tabDisabled = (key: TabKey) => vectorUnavailable && key !== 'fuzzy'

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">搜索图片</h1>
          <p className="text-sm text-muted-foreground">用自然语言描述、选择参考图，或按关键词检索你的收藏</p>
        </div>

        {vectorUnavailable && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
            <span>
              <span className="font-medium">语义搜索暂不可用</span>（推理服务未就绪）。请使用「关键词搜索」进行检索。
            </span>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => { setTab(v as TabKey); updateUrl({ tab: v }) }}>
          <TabsList>
            <TabsTrigger value="text" disabled={tabDisabled('text')} className="gap-1.5">
              <ScanSearch className="h-4 w-4" strokeWidth={1.9} />
              语义搜索
              {!SEARCH_API_STATUS.textSearch && <span className="text-[10px] text-muted-foreground">待接入</span>}
            </TabsTrigger>
            <TabsTrigger value="image" disabled={tabDisabled('image')} className="gap-1.5">
              <ImageIcon className="h-4 w-4" strokeWidth={1.9} />
              以图搜图
            </TabsTrigger>
            <TabsTrigger value="fuzzy" className="gap-1.5">
              <Type className="h-4 w-4" strokeWidth={1.9} />
              关键词搜索
            </TabsTrigger>
          </TabsList>

          <div className="mt-4 rounded-xl border bg-card p-5">
            <TabsContent value="text" className="mt-0">
              <TextSearchForm
                loading={loading}
                tags={tags}
                initialQ={searchParams.get('q') ?? ''}
                onSearch={handleTextSearch}
              />
            </TabsContent>
            <TabsContent value="image" className="mt-0">
              <ImageSearchForm loading={loading} tags={tags} onSearch={handleImageSearch} />
            </TabsContent>
            <TabsContent value="fuzzy" className="mt-0">
              <FuzzySearchForm
                loading={loading}
                tags={tags}
                initialQ={searchParams.get('q') ?? ''}
                onSearch={handleFuzzySearch}
              />
            </TabsContent>
          </div>
        </Tabs>

        <SearchResults
          loading={loading}
          outcome={outcome}
          keyword={keyword}
          onResultClick={handleResultClick}
          detailLoading={detailLoading}
          selectedImage={selectedImage}
          drawerOpen={drawerOpen}
          onDrawerClose={handleDrawerClose}
          onUpdate={(image) => setSelectedImage(image)}
          onDelete={handleDelete}
        />
      </div>

      {toast && <SearchToast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppShell>
  )
}

export default function SearchPage() {
  // useSearchParams 需要 Suspense 边界，否则静态渲染阶段会被迫退到客户端渲染
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="py-24 text-center text-sm text-muted-foreground">加载中…</div>
        </AppShell>
      }
    >
      <SearchPageContent />
    </Suspense>
  )
}
