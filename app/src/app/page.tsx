'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud, ScanSearch, ArrowRight, Image as ImageIcon, Tags as TagsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import GalleryImageCard from '@/components/GalleryImageCard'
import ImageDetailSheet from '@/components/ImageDetailSheet'
import AppShell from '@/components/layout/AppShell'
import { imageService, tagService, systemService } from '@/services/api'
import type { ImageDetail } from '@/services/api'

export default function HomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [recentImages, setRecentImages] = useState<ImageDetail[]>([])
  const [popularTags, setPopularTags] = useState<Array<{ name: string; count: number }>>([])
  const [totalImages, setTotalImages] = useState(0)
  const [totalTags, setTotalTags] = useState(0)
  const [selectedImage, setSelectedImage] = useState<ImageDetail | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [imgRes, tagRes, sysRes] = await Promise.all([
          imageService.getList({ page: 1, page_size: 12 }),
          tagService.getAll().catch(() => ({ data: [] })),
          systemService.getStatus().catch(() => null),
        ])
        if (imgRes.data) setRecentImages(imgRes.data)
        if (imgRes.metadata?.pagination) setTotalImages(imgRes.metadata.pagination.total_items)
        if (tagRes.data) setPopularTags(tagRes.data)
        if (sysRes?.data) setTotalImages(sysRes.data.image_count ?? totalImages)
      } catch (e) { console.error(e) } finally { setLoading(false) }
    }
    fetchData()
  }, [])

  const handleImageClick = async (image: ImageDetail) => {
    try {
      const res = await imageService.getDetail(image.id)
      setSelectedImage(res.data)
      setDrawerOpen(true)
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id: number) => {
    try {
      await imageService.delete(id)
      setDrawerOpen(false)
      setRecentImages(prev => prev.filter(img => img.id !== id))
    } catch (e) { console.error(e) }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        {/* 欢迎区 */}
        <section className="flex flex-col gap-5 rounded-xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="space-y-1.5">
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              你的图片收藏
            </h1>
            <p className="text-sm text-muted-foreground">
              {totalImages > 0
                ? `共收录 ${totalImages} 张图片 · ${popularTags.length} 个标签，支持关键词与以图搜图`
                : '上传图片，用自然语言或相似图片快速找到它们'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button onClick={() => router.push('/upload')} className="gap-2">
              <UploadCloud className="h-4 w-4" strokeWidth={2} />上传图片
            </Button>
            <Button variant="outline" onClick={() => router.push('/search')} className="gap-2">
              <ScanSearch className="h-4 w-4" strokeWidth={2} />以图搜图
            </Button>
          </div>
        </section>

        {/* 最近上传 */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <ImageIcon className="h-[18px] w-[18px] text-primary" strokeWidth={1.9} />最近上传
            </h2>
            <button type="button" onClick={() => router.push('/images')}
              className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary">
              查看全部<ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : recentImages.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {recentImages.map((image) => (
                <GalleryImageCard key={image.id} image={image} onClick={handleImageClick} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
              <ImageIcon className="h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">还没有图片，先上传几张吧</p>
              <Button variant="outline" onClick={() => router.push('/upload')} className="gap-2">
                <UploadCloud className="h-4 w-4" strokeWidth={2} />去上传
              </Button>
            </div>
          )}
        </section>

        {/* 热门标签 */}
        {popularTags.length > 0 && (
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
              <TagsIcon className="h-[18px] w-[18px] text-primary" strokeWidth={1.9} />热门标签
            </h2>
            <div className="flex flex-wrap gap-2">
              {popularTags.slice(0, 20).map((tag) => (
                <button key={tag.name} type="button" title={`${tag.count} 张图片使用此标签`}
                  onClick={() => router.push(`/images?tags=${encodeURIComponent(tag.name)}`)}
                  className="rounded-full border bg-card px-3.5 py-1.5 text-sm text-secondary-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground">
                  {tag.name}<span className="ml-1.5 text-xs text-muted-foreground">{tag.count}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <ImageDetailSheet
          image={selectedImage}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onUpdate={(img) => setSelectedImage(img)}
          onDelete={handleDelete}
        />
      </div>
    </AppShell>
  )
}
