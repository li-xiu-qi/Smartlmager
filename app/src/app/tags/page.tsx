'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, ArrowUpDown, Eye, Image as ImageIcon, Search, Tags as TagsIcon, X } from 'lucide-react'

import AppShell from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { tagService, systemService } from '@/services/api'
import { cn } from '@/lib/utils'

type TagItem = { name: string; count: number }
type ToastState = { text: string; type: 'error' | 'success' } | null

// 标签云 6 档视觉：字号与配色按「使用次数 / 最高次数」的比例分档
const CLOUD_TIERS = [
  'border-border bg-muted text-muted-foreground text-xs',
  'border-primary/25 bg-primary/10 text-primary text-sm',
  'border-primary/30 bg-primary/15 text-primary text-sm',
  'border-primary/40 bg-primary/20 text-primary text-base',
  'border-primary/50 bg-primary/25 text-primary text-base font-semibold',
  'border-transparent bg-primary text-primary-foreground text-lg font-semibold',
]
const TIER_THRESHOLDS = [0.2, 0.4, 0.6, 0.8, 0.9]

function cloudTierClass(count: number, maxCount: number): string {
  const ratio = maxCount > 0 ? count / maxCount : 0
  let tier = 0
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (ratio >= TIER_THRESHOLDS[i]) tier = i + 1
  }
  return CLOUD_TIERS[tier]
}

// 固定位置提示，3 秒自动消失
function Toast({ toast, onClose }: { toast: NonNullable<ToastState>; onClose: () => void }) {
  const isError = toast.type === 'error'
  return (
    <div className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 animate-slide-up">
      <div
        className={cn(
          'flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur',
          isError ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-primary/40 bg-primary/10 text-primary'
        )}
        role="status"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="flex-1">{toast.text}</span>
        <button type="button" onClick={onClose} aria-label="关闭提示"
          className="shrink-0 rounded p-0.5 transition-opacity hover:opacity-70">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-5 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

export default function TagsPage() {
  const router = useRouter()

  const [tags, setTags] = useState<TagItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchValue, setSearchValue] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [tagTotal, setTagTotal] = useState(0)
  const [imageTotal, setImageTotal] = useState(0)
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [toast, setToast] = useState<ToastState>(null)

  const showToast = useCallback((type: 'error' | 'success', text: string) => setToast({ type, text }), [])
  const hideToast = useCallback(() => setToast(null), [])

  // 提示 3 秒自动消失
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(hideToast, 3000)
    return () => clearTimeout(timer)
  }, [toast, hideToast])

  // 搜索词防抖 300ms，由接口侧过滤
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchValue.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchValue])

  const loadTags = useCallback(async (query: string) => {
    setLoading(true)
    try {
      const res = await tagService.getAll(query || undefined)
      if (res.data) {
        setTags(res.data)
        // 标签总数只统计全量（未搜索）口径
        if (!query) setTagTotal(res.metadata?.total ?? res.data.length)
      } else {
        setTags([])
        showToast('error', '获取标签失败')
      }
    } catch (e) {
      console.error('获取标签失败:', e)
      setTags([])
      showToast('error', '获取标签失败')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadTags(debouncedSearch)
  }, [debouncedSearch, loadTags])

  // 图片总数
  useEffect(() => {
    systemService.getStatus()
      .then((res) => {
        if (res.data) setImageTotal(res.data.image_count ?? 0)
      })
      .catch((e) => console.error('获取系统状态失败:', e))
  }, [])

  // 搜索词、排序、分页大小变化后回到第一页
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, sortOrder, pageSize])

  const maxCount = useMemo(() => tags.reduce((max, t) => Math.max(max, t.count), 0), [tags])

  const sortedTags = useMemo(() => {
    return [...tags].sort((a, b) => {
      const diff = sortOrder === 'desc' ? b.count - a.count : a.count - b.count
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
  }, [tags, sortOrder])

  const totalPages = Math.max(1, Math.ceil(sortedTags.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageTags = sortedTags.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const goToImages = (tag: string) => router.push(`/images?tags=${encodeURIComponent(tag)}`)

  const renderCloud = () => {
    if (loading) {
      return (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 18 }).map((_, i) => (
            <Skeleton key={i} className="h-7 rounded-full" style={{ width: `${48 + ((i * 37) % 72)}px` }} />
          ))}
        </div>
      )
    }
    if (tags.length === 0) {
      return <p className="py-6 text-center text-sm text-muted-foreground">没有匹配的标签</p>
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <button
            key={tag.name}
            type="button"
            title={`${tag.count} 张图片使用此标签`}
            onClick={() => goToImages(tag.name)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 leading-6 transition-all hover:shadow-sm hover:brightness-95',
              cloudTierClass(tag.count, maxCount)
            )}
          >
            <span className="whitespace-nowrap">{tag.name}</span>
            <span className="text-[0.75em] tabular-nums opacity-70">{tag.count}</span>
          </button>
        ))}
      </div>
    )
  }

  const renderTable = () => {
    if (loading) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-md" />)}
        </div>
      )
    }
    if (tags.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <TagsIcon className="h-9 w-9 text-muted-foreground/50" strokeWidth={1.5} />
          <p className="text-sm font-medium text-foreground">
            {searchValue.trim() ? '没有匹配的标签' : '暂无标签'}
          </p>
          <p className="text-xs text-muted-foreground">
            {searchValue.trim() ? '换个关键词试试' : '上传图片并为它们添加标签后，标签将显示在此处'}
          </p>
        </div>
      )
    }
    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">标签</th>
              <th scope="col" className="px-4 py-3 font-medium">
                <button
                  type="button"
                  onClick={() => setSortOrder((v) => (v === 'desc' ? 'asc' : 'desc'))}
                  className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                >
                  使用次数
                  <ArrowUpDown className={cn('h-3.5 w-3.5', sortOrder === 'asc' && 'rotate-180')} strokeWidth={2} />
                </button>
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageTags.map((tag) => (
              <tr key={tag.name} className="border-b last:border-b-0 transition-colors hover:bg-muted/40">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => goToImages(tag.name)}
                    className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                  >
                    {tag.name}
                  </button>
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground">{tag.count}</td>
                <td className="px-4 py-3 text-right">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => goToImages(tag.name)}>
                    <Eye className="h-3.5 w-3.5" strokeWidth={2} />查看图片
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* 页头 */}
        <section className="space-y-1.5">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
            <TagsIcon className="h-6 w-6 text-primary" strokeWidth={1.9} />标签管理
          </h1>
          <p className="text-sm text-muted-foreground">查看并管理所有图片标签，点击标签可查看相关图片</p>
        </section>

        {/* 统计信息 */}
        <section className="grid gap-4 sm:grid-cols-2">
          <StatCard icon={<TagsIcon className="h-5 w-5" strokeWidth={1.9} />} label="标签总数" value={tagTotal} />
          <StatCard icon={<ImageIcon className="h-5 w-5" strokeWidth={1.9} />} label="图片总数" value={imageTotal} />
        </section>

        {/* 搜索框 */}
        <section className="space-y-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
            <Input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="搜索标签..."
              aria-label="搜索标签"
              className="pl-9 pr-9"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => setSearchValue('')}
                aria-label="清空搜索"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">输入关键词搜索标签</p>
        </section>

        {/* 标签云 */}
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">标签云</h2>
          {renderCloud()}
        </section>

        {/* 标签列表 */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">标签列表</h2>
            {!loading && tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>共 {sortedTags.length} 个标签</span>
                <label className="flex items-center gap-1.5">
                  每页
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    aria-label="每页条数"
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  条
                </label>
              </div>
            )}
          </div>
          {renderTable()}
          {!loading && tags.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>第 {currentPage} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  上一页
                </Button>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {toast && <Toast toast={toast} onClose={hideToast} />}
    </AppShell>
  )
}
