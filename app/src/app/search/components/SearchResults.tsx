'use client'
import { useEffect, useState } from 'react'
import { Loader2, SearchX } from 'lucide-react'
import GalleryImageCard from '@/components/GalleryImageCard'
import ImageDetailSheet from '@/components/ImageDetailSheet'
import { imageService } from '@/services/api'
import type { ImageDetail } from '@/services/api'
import SearchMetaBar from './SearchMetaBar'
import type { SearchOutcome, SearchResultItem } from '@/services/searchClient'

interface SearchResultsProps {
  loading: boolean
  outcome: SearchOutcome | null
  /** 当前关键词，用于空态文案 */
  keyword?: string
  onResultClick: (image: SearchResultItem) => void
  /** 详情加载中（由页面控制抽屉开关时机） */
  detailLoading: boolean
  selectedImage: ImageDetail | null
  drawerOpen: boolean
  onDrawerClose: () => void
  onUpdate: (image: ImageDetail) => void
  onDelete: (id: number) => void
}

/** 搜索结果：画廊网格 + 详情抽屉，替代 antd Drawer + Spin */
export default function SearchResults({
  loading,
  outcome,
  keyword,
  onResultClick,
  detailLoading,
  selectedImage,
  drawerOpen,
  onDrawerClose,
  onUpdate,
  onDelete,
}: SearchResultsProps) {
  const [items, setItems] = useState<SearchResultItem[]>(outcome?.items ?? [])

  useEffect(() => {
    setItems(outcome?.items ?? [])
  }, [outcome])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" strokeWidth={1.8} />
        <p className="text-sm">正在搜索，请稍候…</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-24 text-center">
        <SearchX className="h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">
          {keyword ? `没有找到与「${keyword}」相关的图片` : '输入关键词，或选择一张参考图开始搜索'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <SearchMetaBar
        total={outcome?.total ?? items.length}
        searchTimeMs={outcome?.searchTimeMs ?? 0}
        referenceImage={outcome?.referenceImage ?? null}
        truncated={outcome?.truncated ?? false}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((image) => (
          <GalleryImageCard
            key={image.id}
            image={image}
            showSimilarity
            onClick={() => onResultClick(image)}
          />
        ))}
      </div>

      <ImageDetailSheet
        image={detailLoading ? null : selectedImage}
        open={drawerOpen}
        onClose={onDrawerClose}
        onUpdate={(updated) => {
          onUpdate(updated)
          setItems((prev) =>
            prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
          )
        }}
        onDelete={(deletedId) => {
          onDelete(deletedId)
          setItems((prev) => prev.filter((item) => item.id !== deletedId))
        }}
      />
    </div>
  )
}
