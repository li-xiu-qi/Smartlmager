'use client'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchToastProps {
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
}

/** 固定位置的轻量提示，3 秒自动消失（不引新依赖） */
export default function SearchToast({ message, type, onClose }: SearchToastProps) {
  const tone =
    type === 'error'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : type === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
        : 'border-border bg-card text-foreground'
  const Icon = type === 'error' ? CircleAlert : type === 'success' ? CircleCheck : Info

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4">
      <div
        role="status"
        className={cn(
          'pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg',
          tone
        )}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="flex-1 break-words">{message}</span>
        <button type="button" onClick={onClose} aria-label="关闭提示" className="shrink-0 opacity-60 transition-opacity hover:opacity-100">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
