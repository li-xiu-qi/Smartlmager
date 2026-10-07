'use client'
import { cn } from '@/lib/utils'

export interface ChipOption {
  value: string
  label: string
}

interface VectorTargetChipsProps {
  options: ChipOption[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  /** 至少保留一个选中项（最后一个不允许取消） */
  keepAtLeastOne?: boolean
}

/** 多选 chip 组，替代 antd Select mode="multiple" */
export default function VectorTargetChips({
  options,
  value,
  onChange,
  disabled = false,
  keepAtLeastOne = true,
}: VectorTargetChipsProps) {
  const toggle = (optionValue: string) => {
    if (disabled) return
    const selected = value.includes(optionValue)
    if (selected) {
      if (keepAtLeastOne && value.length === 1) return
      onChange(value.filter((v) => v !== optionValue))
      return
    }
    onChange([...value, optionValue])
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = value.includes(option.value)
        const locked = keepAtLeastOne && active && value.length === 1
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled || locked}
            onClick={() => toggle(option.value)}
            title={locked ? '至少需要选择一个搜索目标' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
              (disabled || locked) && 'cursor-not-allowed opacity-50 hover:border-border hover:text-muted-foreground'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
