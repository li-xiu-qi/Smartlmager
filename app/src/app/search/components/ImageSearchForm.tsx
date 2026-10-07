'use client'
import { useEffect, useRef, useState } from 'react'
import { CircleAlert, ImagePlus, Loader2, ScanSearch, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { imageService } from '@/services/api'
import type { ImageDetail } from '@/services/api'
import VectorTargetChips from './VectorTargetChips'
import TagFilter from './TagFilter'
import type { ImageSearchRequest, UploadImageSearchParams, VectorTarget } from '@/services/searchClient'
import { cn } from '@/lib/utils'

/** 搜索目标选项（图像向量优先） */
const SEARCH_TARGET_OPTIONS = [
  { value: 'image', label: '图像向量' },
  { value: 'title', label: '标题向量' },
  { value: 'description', label: '描述向量' },
]

/** 参考图候选数量 */
const REFERENCE_POOL_SIZE = 8
const MAX_UPLOAD_MB = 20

interface ImageSearchFormProps {
  loading: boolean
  tags: Array<{ name: string; count: number }>
  onSearch: (request: ImageSearchRequest) => void
}

/**
 * 以图搜图表单。
 * 参考图搜索走已就位的 /search/similar/[id]（当前可用）；
 * 上传图片搜索走后端尚未接入的 /search/unified/image（接口补齐后自动可用）。
 */
export default function ImageSearchForm({ loading, tags, onSearch }: ImageSearchFormProps) {
  const [candidates, setCandidates] = useState<ImageDetail[]>([])
  const [referenceId, setReferenceId] = useState<number | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [searchTargets, setSearchTargets] = useState<VectorTarget[]>(['image'])
  const [limit, setLimit] = useState('20')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [titleWeight, setTitleWeight] = useState('')
  const [descriptionWeight, setDescriptionWeight] = useState('')
  const [imageWeight, setImageWeight] = useState('')
  const [minScore, setMinScore] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 加载参考图候选
  useEffect(() => {
    let cancelled = false
    imageService
      .getList({ page: 1, page_size: REFERENCE_POOL_SIZE })
      .then((res) => {
        if (!cancelled && res.data) setCandidates(res.data)
      })
      .catch(() => {
        /* 候选加载失败不阻塞搜索 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 卸载时释放预览 URL
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const pickFile = (next: File | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    if (next.size / 1024 / 1024 > MAX_UPLOAD_MB) {
      setError(`图片必须小于 ${MAX_UPLOAD_MB}MB`)
      return
    }
    setError('')
    setFile(next)
    setReferenceId(null)
    setPreviewUrl(URL.createObjectURL(next))
  }

  const clearFile = () => {
    setFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const submit = () => {
    if (!referenceId && !file) {
      setError('请先选择参考图，或上传一张图片')
      return
    }
    setError('')

    const parsedLimit = parseInt(limit, 10)
    const safeLimit = Number.isNaN(parsedLimit) || parsedLimit <= 0 ? 20 : parsedLimit

    if (referenceId) {
      onSearch({ mode: 'reference', imageId: referenceId, vectorType: searchTargets[0], limit: safeLimit })
      return
    }

    const weights: Partial<Record<VectorTarget, number>> = {}
    const assign = (key: VectorTarget, raw: string) => {
      const value = parseFloat(raw)
      if (!Number.isNaN(value) && value > 0) weights[key] = value
    }
    assign('title', titleWeight)
    assign('description', descriptionWeight)
    assign('image', imageWeight)
    const parsedMinScore = minScore.trim() ? parseFloat(minScore) : NaN

    const params: UploadImageSearchParams = {
      file: file as File,
      searchTargets,
      tags: selectedTags.length ? selectedTags : undefined,
      weights: Object.keys(weights).length ? weights : undefined,
      minScore: !Number.isNaN(parsedMinScore) ? parsedMinScore : undefined,
      limit: safeLimit,
    }
    onSearch({ mode: 'upload', params })
  }

  return (
    <div
      className="space-y-5"
      onPaste={(e) => {
        const pasted = Array.from(e.clipboardData.files)[0]
        if (pasted) pickFile(pasted)
      }}
    >
      <div className="space-y-2">
        <Label>选择参考图</Label>
        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            图片库还没有图片，先上传几张，或直接使用下面的上传搜索
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {candidates.map((image) => (
              <button
                key={image.id}
                type="button"
                title={image.title || image.filename}
                onClick={() => {
                  setError('')
                  setReferenceId(image.id)
                  clearFile()
                }}
                className={cn(
                  'relative aspect-square overflow-hidden rounded-md border bg-muted transition-all',
                  referenceId === image.id ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-foreground/20'
                )}
              >
                <img
                  src={`/api/v1/images/file/${image.filename}`}
                  alt={image.title || image.filename}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
        {referenceId !== null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>已选参考图 #{referenceId}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setReferenceId(null)}
            >
              清除
            </Button>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>或上传一张图片</Label>
        {previewUrl ? (
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <img src={previewUrl} alt="搜索图片预览" className="max-h-32 rounded border object-contain" />
            <div className="space-y-2">
              <p className="max-w-[220px] truncate text-xs text-muted-foreground">{file?.name}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={clearFile} className="gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />移除
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  重新选择
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">也可以直接粘贴（Ctrl+V）替换</p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors hover:border-primary/40"
          >
            <ImagePlus className="h-6 w-6 text-muted-foreground" strokeWidth={1.8} />
            <span className="text-sm text-foreground">点击选择图片</span>
            <span className="text-xs text-muted-foreground">支持 jpg / png / gif / webp，或直接粘贴（Ctrl+V）</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="space-y-2">
        <Label>搜索目标</Label>
        <VectorTargetChips
          options={SEARCH_TARGET_OPTIONS}
          value={searchTargets}
          onChange={(v) => setSearchTargets(v as VectorTarget[])}
        />
        <p className="text-xs text-muted-foreground">
          使用参考图搜索时取第一个选中的向量类型；上传图片搜索会在所选向量上分别检索
        </p>
      </div>

      <div className="max-w-[220px] space-y-1.5">
        <Label htmlFor="image-search-limit">结果数量</Label>
        <Input id="image-search-limit" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
      </div>

      {file && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>标签筛选</Label>
            <TagFilter value={selectedTags} onChange={setSelectedTags} options={tags} disabled={loading} />
          </div>
        </>
      )}

      <Button type="button" onClick={submit} disabled={loading || (!referenceId && !file)} className="gap-1.5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
        搜索相似图片
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {file && (
        <>
          <Separator />
          <Button
            type="button"
            variant="link"
            onClick={() => setShowAdvanced((v) => !v)}
            className="h-auto px-0 text-sm"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {showAdvanced ? '收起融合参数' : '展开融合参数（权重 / 最小得分）'}
          </Button>
          {showAdvanced && (
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="image-weight-title">Title 权重</Label>
                  <Input id="image-weight-title" type="number" min={0} step="0.1" placeholder="1" value={titleWeight} onChange={(e) => setTitleWeight(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="image-weight-desc">Desc 权重</Label>
                  <Input id="image-weight-desc" type="number" min={0} step="0.1" placeholder="1" value={descriptionWeight} onChange={(e) => setDescriptionWeight(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="image-weight-image">Image 权重</Label>
                  <Input id="image-weight-image" type="number" min={0} step="0.1" placeholder="1" value={imageWeight} onChange={(e) => setImageWeight(e.target.value)} />
                </div>
              </div>
              <div className="max-w-[220px] space-y-1.5">
                <Label htmlFor="image-min-score">最小得分</Label>
                <Input id="image-min-score" placeholder="例如 0.6（可选）" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
              </div>
            </div>
          )}
        </>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        上传图片搜索依赖后端语义检索接口，当前未接入时会给出提示
      </p>
    </div>
  )
}
