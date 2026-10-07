'use client'
import { useMemo, useState } from 'react'
import { Check, Tags, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'

interface TagFilterProps {
  value: string[]
  onChange: (value: string[]) => void
  options: Array<{ name: string; count: number }>
  disabled?: boolean
}

/** 标签多选（弹层 + 关键词过滤 + 已选 chip），替代 antd Select mode="multiple" */
export default function TagFilter({ value, onChange, options, disabled = false }: TagFilterProps) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return k ? options.filter((tag) => tag.name.toLowerCase().includes(k)) : options
  }, [keyword, options])

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name])
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled} className="gap-1.5">
              <Tags className="h-3.5 w-3.5" strokeWidth={2} />
              标签筛选
              {value.length > 0 && <Badge variant="secondary">{value.length}</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <div className="border-b p-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索标签"
                className="h-8"
              />
            </div>
            <ScrollArea className="max-h-60">
              <div className="p-1">
                {filtered.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">没有匹配的标签</p>
                ) : (
                  filtered.map((tag) => {
                    const active = value.includes(tag.name)
                    return (
                      <button
                        key={tag.name}
                        type="button"
                        onClick={() => toggle(tag.name)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                      >
                        <span
                          className={
                            active
                              ? 'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary bg-primary text-primary-foreground'
                              : 'h-4 w-4 shrink-0 rounded-sm border border-input'
                          }
                        >
                          {active && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className="flex-1 truncate">{tag.name}</span>
                        <span className="text-xs text-muted-foreground">{tag.count}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
        {value.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])} className="h-7 text-xs">
            清空
          </Button>
        )}
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {tag}
              <button type="button" onClick={() => toggle(tag)} aria-label={`移除标签 ${tag}`}>
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
