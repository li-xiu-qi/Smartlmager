'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, List, Trash2, Download, CheckSquare, X, Search, Filter, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import GalleryImageCard from '@/components/GalleryImageCard'
import ImageDetailSheet from '@/components/ImageDetailSheet'
import AppShell from '@/components/layout/AppShell'
import { imageService, tagService } from '@/services/api'
import type { ImageDetail } from '@/services/api'

const PAGE_SIZES = [20, 40, 60, 100]

function ImagesPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState<ImageDetail[]>([])
  const [tags, setTags] = useState<Array<{ name: string; count: number }>>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedImage, setSelectedImage] = useState<ImageDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [gridCols, setGridCols] = useState(4)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [searchText, setSearchText] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)

  const showToast = (msg: string, type: string = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    const t = searchParams.get('tags')
    if (t) setFilterTags(decodeURIComponent(t).split(',').map((s) => s.trim()).filter(Boolean))
  }, [searchParams])

  useEffect(() => {
    tagService.getAll().then((r) => { if (r.data) setTags(r.data) }).catch(() => {})
  }, [])

  const fetchImages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await imageService.getList({
        page, page_size: pageSize,
        tags: filterTags.length ? filterTags.join(',') : undefined,
        search: searchText || undefined,
      })
      if (res.data) setImages(res.data)
      if (res.metadata?.pagination) setTotal(res.metadata.pagination.total_items)
    } catch { showToast('获取图片数据失败', 'error') }
    finally { setLoading(false) }
  }, [page, pageSize, filterTags, searchText])

  useEffect(() => { fetchImages() }, [fetchImages])

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    const qs = filterTags.length ? '?tags=' + encodeURIComponent(filterTags.join(',')) : ''
    router.replace('/images' + qs)
  }

  const resetFilters = () => {
    setFilterTags([]); setSearchText(''); setPage(1)
    router.replace('/images')
  }

  const handleImageClick = async (image: ImageDetail) => {
    try {
      const res = await imageService.getDetail(image.id)
      setSelectedImage(res.data); setDetailOpen(true)
    } catch { showToast('获取图片详情失败', 'error') }
  }

  const handleDelete = async (id: number) => {
    try {
      await imageService.delete(id)
      showToast('图片删除成功')
      setDetailOpen(false)
      setImages((prev) => prev.filter((img) => img.id !== id))
      setTotal((prev) => prev - 1)
    } catch { showToast('删除失败', 'error') }
  }

  const handleUpdate = (updated: ImageDetail) => {
    setSelectedImage(updated)
    setImages((prev) => prev.map((img) => (img.id === updated.id ? updated : img)))
  }

  const toggleMulti = () => { setMultiSelect((v) => !v); setSelectedIds(new Set()) }

  const handleSelect = (id: number, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) next.add(id); else next.delete(id)
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedIds((prev) => prev.size === images.length ? new Set() : new Set(images.map((i) => i.id)))
  }

  const handleBatchDelete = async () => {
    if (!selectedIds.size) { showToast('请选择要删除的图片', 'warning'); return }
    setBatchDeleting(true)
    try {
      const res = await imageService.batchDelete([...selectedIds])
      const d = res.data
      if (d?.deleted_count > 0) {
        showToast('成功删除 ' + d.deleted_count + ' 张图片')
        setImages((prev) => prev.filter((i) => !(selectedIds.has(i.id) && !(d.failed_ids || []).includes(i.id))))
        setTotal((prev) => Math.max(0, prev - d.deleted_count))
      }
      if (d?.failed_count > 0) showToast('有 ' + d.failed_count + ' 张图片删除失败', 'warning')
      setSelectedIds(new Set())
    } catch { showToast('批量删除失败', 'error') }
    finally { setBatchDeleting(false) }
  }

  const handleTagClick = (tag: string) => {
    if (!filterTags.includes(tag)) {
      const next = [...filterTags, tag]
      setFilterTags(next); setPage(1)
      router.replace('/images?tags=' + encodeURIComponent(next.join(',')))
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const gridClass: Record<number, string> = {
    2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
    5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
    6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
  }

  const parseTags = (t: unknown): string[] => {
    if (!t) return []
    if (typeof t === 'string') { try { return JSON.parse(t) } catch { return [] } }
    return Array.isArray(t) ? t : []
  }

  return (
    <AppShell>
      {toast && (
        <div className={'fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ' + (toast.type === 'error' ? 'bg-destructive' : toast.type === 'warning' ? 'bg-yellow-600' : 'bg-primary')}>
          {toast.msg}
        </div>
      )}
      <div className="space-y-4">
        <Card className="p-4">
          <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">搜索文件名</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="输入关键词..." className="pl-8" />
              </div>
            </div>
            <div className="min-w-[180px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">标签筛选</label>
              <Select value={filterTags[0] || ''} onValueChange={(v) => { setFilterTags(v ? [v] : []); setPage(1) }}>
                <SelectTrigger><SelectValue placeholder="全部标签" /></SelectTrigger>
                <SelectContent>
                  {tags.map((t) => <SelectItem key={t.name} value={t.name}>{t.name} ({t.count})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="gap-1"><Filter className="h-4 w-4" />筛选</Button>
            <Button type="button" variant="outline" onClick={resetFilters}>重置</Button>
          </form>
          {filterTags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {filterTags.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1">
                  {t}
                  <button type="button" onClick={() => { const n = filterTags.filter((x) => x !== t); setFilterTags(n); setPage(1) }}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">共 {total} 张图片</span>
            {multiSelect && (
              <>
                <Button variant="outline" size="sm" onClick={handleSelectAll} className="gap-1">
                  <CheckSquare className="h-3.5 w-3.5" />{selectedIds.size === images.length ? '取消全选' : '全选'}
                </Button>
                <span className="text-sm text-muted-foreground">已选 {selectedIds.size}</span>
                <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={batchDeleting} className="gap-1">
                  {batchDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}批量删除
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant={multiSelect ? 'default' : 'outline'} size="sm" onClick={toggleMulti} className="gap-1">
              <CheckSquare className="h-3.5 w-3.5" />多选
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open(imageService.exportAllUrl(), '_self')} className="gap-1">
              <Download className="h-3.5 w-3.5" />导出
            </Button>
            <div className="flex rounded-md border">
              <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('grid')} className="rounded-r-none">
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
              <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('list')} className="rounded-l-none">
                <List className="h-3.5 w-3.5" />
              </Button>
            </div>
            {viewMode === 'grid' && (
              <Select value={String(gridCols)} onValueChange={(v) => setGridCols(Number(v))}>
                <SelectTrigger className="w-[70px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n} 列</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {loading ? (
          <div className={viewMode === 'grid' ? 'grid gap-4 ' + gridClass[gridCols] : 'space-y-2'}>
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className={viewMode === 'grid' ? 'aspect-[4/3] rounded-lg' : 'h-16 rounded-lg'} />)}
          </div>
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
            <p className="text-sm text-muted-foreground">没有符合条件的图片</p>
            <Button variant="outline" onClick={resetFilters}>清除筛选</Button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className={'grid gap-4 ' + gridClass[gridCols]}>
            {images.map((image) => (
              <GalleryImageCard
                key={image.id}
                image={image}
                onClick={handleImageClick}
                onTagClick={handleTagClick}
                showTags
                multiSelectMode={multiSelect}
                selected={selectedIds.has(image.id)}
                onSelect={handleSelect}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {images.map((image) => (
              <div
                key={image.id}
                className={'flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50 ' + (selectedIds.has(image.id) ? 'border-primary ring-1 ring-primary/40' : '')}
                onClick={() => multiSelect ? handleSelect(image.id, !selectedIds.has(image.id)) : handleImageClick(image)}
              >
                {multiSelect && <Checkbox checked={selectedIds.has(image.id)} />}
                <img src={'/api/v1/images/file/' + image.filename} alt={image.title} className="h-14 w-14 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{image.title || '未命名'}</p>
                  <p className="truncate text-xs text-muted-foreground">{image.description || image.filename}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {parseTags(image.tags).slice(0, 4).map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{image.width}x{image.height}</span>
              </div>
            ))}
          </div>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>每页</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}>
                <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <span>第 {page} / {totalPages} 页</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <ImageDetailSheet
        image={selectedImage}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </AppShell>
  )
}

export default function ImagesPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
            ))}
          </div>
        </AppShell>
      }
    >
      <ImagesPageContent />
    </Suspense>
  )
}
