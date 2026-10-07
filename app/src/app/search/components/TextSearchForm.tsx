'use client'
import { useState } from 'react'
import { Loader2, Search, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import VectorTargetChips from './VectorTargetChips'
import TagFilter from './TagFilter'
import type { TextSearchParams, VectorTarget } from '@/services/searchClient'
/** 向量搜索目标选项 */
const VECTOR_TARGET_OPTIONS = [
  { value: 'title', label: '标题向量' },
  { value: 'description', label: '描述向量' },
  { value: 'image', label: '图像向量' },
]

interface TextSearchFormProps {
  loading: boolean
  tags: Array<{ name: string; count: number }>
  /** 来自 URL 的 q 参数，用于恢复上次搜索 */
  initialQ?: string
  onSearch: (params: TextSearchParams) => void
}

/** 文本语义搜索表单：替代 antd Form + Input + Select(multiple) */
export default function TextSearchForm({ loading, tags, initialQ = '', onSearch }: TextSearchFormProps) {
  const [q, setQ] = useState(initialQ)
  const [vectorTargets, setVectorTargets] = useState<VectorTarget[]>(['title', 'description', 'image'])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [titleWeight, setTitleWeight] = useState('')
  const [descriptionWeight, setDescriptionWeight] = useState('')
  const [imageWeight, setImageWeight] = useState('')
  const [minScore, setMinScore] = useState('')
  const [error, setError] = useState('')

  const submit = () => {
    const keyword = q.trim()
    if (!keyword) {
      setError('请输入搜索关键词')
      return
    }
    setError('')

    // 融合权重：只收大于 0 的数值
    const weights: Partial<Record<VectorTarget, number>> = {}
    const assign = (key: VectorTarget, raw: string) => {
      const value = parseFloat(raw)
      if (!Number.isNaN(value) && value > 0) weights[key] = value
    }
    assign('title', titleWeight)
    assign('description', descriptionWeight)
    assign('image', imageWeight)

    const parsedMinScore = minScore.trim() ? parseFloat(minScore) : NaN

    onSearch({
      q: keyword,
      vectorTargets,
      tags: selectedTags.length ? selectedTags : undefined,
      weights: Object.keys(weights).length ? weights : undefined,
      minScore: !Number.isNaN(parsedMinScore) ? parsedMinScore : undefined,
    })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="text-search-q">搜索关键词</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="text-search-q"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (error) setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="输入关键词（多向量语义检索）"
            className="pl-9"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="space-y-2">
        <Label>向量搜索目标</Label>
        <VectorTargetChips options={VECTOR_TARGET_OPTIONS} value={vectorTargets} onChange={(v) => setVectorTargets(v as VectorTarget[])} />
        <p className="text-xs text-muted-foreground">在选中的向量上分别检索后按权重融合排序</p>
      </div>

      <Button type="button" onClick={submit} disabled={loading} className="gap-1.5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        搜索
      </Button>

      <Separator />

      <div className="space-y-2">
        <Label>标签筛选</Label>
        <TagFilter value={selectedTags} onChange={setSelectedTags} options={tags} disabled={loading} />
      </div>

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
              <Label htmlFor="text-weight-title">Title 权重</Label>
              <Input id="text-weight-title" type="number" min={0} step="0.1" placeholder="1" value={titleWeight} onChange={(e) => setTitleWeight(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="text-weight-desc">Desc 权重</Label>
              <Input id="text-weight-desc" type="number" min={0} step="0.1" placeholder="1" value={descriptionWeight} onChange={(e) => setDescriptionWeight(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="text-weight-image">Image 权重</Label>
              <Input id="text-weight-image" type="number" min={0} step="0.1" placeholder="1" value={imageWeight} onChange={(e) => setImageWeight(e.target.value)} />
            </div>
          </div>
          <div className="max-w-[220px] space-y-1.5">
            <Label htmlFor="text-min-score">最小得分</Label>
            <Input id="text-min-score" placeholder="例如 0.6（可选）" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </div>
        </div>
      )}
    </div>
  )
}
