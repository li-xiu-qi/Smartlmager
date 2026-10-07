'use client'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ImageDetail } from '@/services/api'

const processTags = (tags: unknown): string[] => {
  if (!tags) return []
  if (typeof tags === 'string') {
    try { return JSON.parse(tags) } catch { return [] }
  }
  return Array.isArray(tags) ? tags : []
}

const formatDate = (dateString: string): string => {
  if (!dateString) return ''
  const d = new Date(dateString)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface GalleryImageCardProps {
  image: ImageDetail & { score?: number }
  onClick?: (image: ImageDetail) => void
  onTagClick?: (tag: string) => void
  showTags?: boolean
  showSimilarity?: boolean
  multiSelectMode?: boolean
  selected?: boolean
  onSelect?: (imageId: number, selected: boolean) => void
}

export default function GalleryImageCard({
  image, onClick, onTagClick, showTags = false, showSimilarity = false,
  multiSelectMode = false, selected = false, onSelect,
}: GalleryImageCardProps) {
  const isSearchResult = typeof image.score !== 'undefined'
  const tags = processTags(image.tags)
  const similarity = isSearchResult && showSimilarity ? Math.round((image.score || 0) * 100) : null

  // 图片 URL：直接读本地文件
  const imgSrc = image.filepath
    ? `/api/v1/images/file/${image.filename}`
    : ''

  const handleClick = () => {
    if (multiSelectMode && onSelect) onSelect(image.id, !selected)
    else if (onClick) onClick(image)
  }

  return (
    <figure
      onClick={handleClick}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-lg border bg-card',
        'transition-all duration-200 ease-out',
        selected
          ? 'border-primary ring-2 ring-primary/40'
          : 'border-border hover:border-foreground/20 hover:shadow-lg hover:shadow-foreground/5'
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={imgSrc}
          alt={image.title || '图片'}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
        />
        {similarity !== null && (
          <span className="absolute left-2 top-2 rounded-full bg-foreground/85 px-2 py-0.5 text-[11px] font-medium text-background backdrop-blur-sm">
            相似度 {similarity}%
          </span>
        )}
        {multiSelectMode && (
          <span className={cn(
            'absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-white/80 bg-black/20 text-transparent group-hover:bg-black/30'
          )}>
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        )}
        <figcaption className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-3 pb-2.5 pt-8',
          'opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100'
        )}>
          <p className="truncate text-sm font-medium text-white">{image.title || '未命名图片'}</p>
          <p className="text-[11px] text-white/70">{formatDate(image.created_at)}</p>
        </figcaption>
      </div>
      {showTags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2">
          {tags.slice(0, 3).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={(e) => { e.stopPropagation(); onTagClick?.(tag) }}
              className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {tag}
            </button>
          ))}
          {tags.length > 3 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">+{tags.length - 3}</span>
          )}
        </div>
      )}
    </figure>
  )
}
