'use client'
import { useState } from 'react'
import { Loader2, Search, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import VectorTargetChips from './VectorTargetChips'
import TagFilter from './TagFilter'
import type { FuzzySearchParams } from '@/services/searchClient'

/** 匹配字段选项 */
const FIELD_OPTIONS = [
  { value: 'title', label: '标题' },
  { value: 'description', label: '描述' },
  { value: 'filename', label: '文件名' },
]

interface FuzzySearchFormProps {
  loading: boolean
  tags: Array<{ name: string; count: number }>
  /** 来自 URL 的 q 参数，用于恢复上次搜索 */
  initialQ?: string
  onSearch: (params: FuzzySearchParams) => void
}

/** 关键词搜索表单（LIKE），替代 antd Form + Input + Select(multiple) */
export default function FuzzySearchForm({ loading, tags, initialQ = '', onSearch }: FuzzySearchFormProps) {
  const [q, setQ] = useState(initialQ)
  const [fields, setFields] = useState<string[]>(['title', 'description'])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [error, setError] = useState('')

  const submit = () => {
    const keyword = q.trim()
    if (!keyword) {
      setError('请输入关键词')
      return
    }
    setError('')
    onSearch({
      q: keyword,
      fields,
      tags: selectedTags.length ? selectedTags : undefined,
    })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="fuzzy-search-q">关键词</Label>
        <div className="relative">
          <Type className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="fuzzy-search-q"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (error) setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="输入关键词（LIKE 模糊匹配）"
            className="pl-9"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="space-y-2">
        <Label>匹配字段</Label>
        <VectorTargetChips options={FIELD_OPTIONS} value={fields} onChange={setFields} />
        <p className="text-xs text-muted-foreground">
          标题与描述走后端全表匹配；文件名只能在前端检索池内过滤（最近 100 张）
        </p>
      </div>

      <Button type="button" onClick={submit} disabled={loading} className="gap-1.5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        关键词搜索
      </Button>

      <Separator />

      <div className="space-y-2">
        <Label>标签筛选</Label>
        <TagFilter value={selectedTags} onChange={setSelectedTags} options={tags} disabled={loading} />
      </div>
    </div>
  )
}
