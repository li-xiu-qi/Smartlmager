'use client'

/**
 * 上传图片页面
 *
 * 迁移自旧前端 frontend/src/pages/upload（antd 版）。
 * 保留：拖拽/点击/粘贴选择图片、缩略图列表、逐文件上传状态、auto_analyze 开关、
 *       每批并发上传张数设置、批量上传执行、结果统计与逐图分析结果展示。
 * 未迁移：上传前单张/批量 AI 预分析、元数据编辑弹窗 —— 见交付报告。
 *
 * 并发设置说明：旧前端的 concurrentLimit 限制的是「前端同时发起的 AI 分析请求数」；
 * 新架构下服务端对单批内的图片串行分析（不会打满推理服务），故这里改为控制
 * 「每批并发上传的张数」，语义是加速而非限流。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CloudUpload,
  FileImage,
  Layers,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AppShell from '@/components/layout/AppShell'
import { imageService } from '@/services/api'
import { cn } from '@/lib/utils'

/* ---------------- 类型 ---------------- */

type FileStatus = 'pending' | 'uploading' | 'success' | 'error'

interface SelectedFile {
  uid: string
  file: File
  previewUrl: string
  status: FileStatus
  /** 失败原因 */
  message?: string
}

/** 后端上传接口逐图返回的字段（ImageDetail 的子集） */
interface UploadedImageInfo {
  id?: number
  filename?: string
  title?: string
  description?: string
  tags?: unknown
  width?: number
  height?: number
}

interface UploadResultItem {
  id: string
  fileName: string
  success: boolean
  message?: string
  image?: UploadedImageInfo
}

interface UploadResult {
  items: UploadResultItem[]
  overallStatus: 'success' | 'partial' | 'failure'
  successCount: number
  failureCount: number
}

type ToastTone = 'success' | 'error' | 'warning' | 'info'
type ToastState = { tone: ToastTone; text: string } | null

/* ---------------- 常量 ---------------- */

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']
const ACCEPT_ATTR = '.jpg,.jpeg,.png,.gif,.webp,.bmp,image/jpeg,image/png,image/gif,image/webp,image/bmp'
const MAX_SIZE = 10 * 1024 * 1024
const TOAST_DURATION_MS = 3000

/* ---------------- 工具 ---------------- */

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 后端 tags 字段在列表接口是 JSON 字符串、在上传接口是数组，两种都兼容 */
const parseTags = (tags: unknown): string[] => {
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === 'string')
  if (typeof tags === 'string' && tags.trim()) {
    try {
      const parsed = JSON.parse(tags)
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [tags]
    } catch {
      return [tags]
    }
  }
  return []
}

/* ---------------- 子组件 ---------------- */

const STATUS_LABEL: Record<FileStatus, string> = {
  pending: '等待中',
  uploading: '上传中',
  success: '上传成功',
  error: '上传失败',
}

const STATUS_CLS: Record<FileStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  uploading: 'bg-primary/10 text-primary',
  success: 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-500',
  error: 'bg-destructive/10 text-destructive',
}

function StatusBadge({ status, message }: { status: FileStatus; message?: string }) {
  return (
    <span
      title={message}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_CLS[status]
      )}
    >
      {status === 'uploading' && <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2.2} />}
      {status === 'success' && <CheckCircle2 className="h-3 w-3" strokeWidth={2.2} />}
      {status === 'error' && <AlertCircle className="h-3 w-3" strokeWidth={2.2} />}
      {STATUS_LABEL[status]}
    </span>
  )
}

function FileRow({
  item,
  disabled,
  onRemove,
}: {
  item: SelectedFile
  disabled: boolean
  onRemove: (uid: string) => void
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
        {item.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本地 objectURL 预览，无需 next/image 优化
          <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FileImage className="h-5 w-5 text-muted-foreground" strokeWidth={1.8} />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground" title={item.file.name}>
            {item.file.name}
          </p>
          <StatusBadge status={item.status} message={item.message} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatSize(item.file.size)}
          {item.status === 'error' && item.message ? ` · ${item.message}` : ''}
        </p>
        <div className={cn('mt-2', item.status === 'uploading' && 'animate-pulse')}>
          <Progress
            value={item.status === 'success' ? 100 : item.status === 'uploading' ? 100 : 0}
            className={cn(
              'h-1.5',
              item.status === 'error' && '[&>div]:bg-destructive',
              item.status === 'pending' && '[&>div]:bg-muted-foreground/40'
            )}
          />
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`移除 ${item.file.name}`}
        disabled={disabled}
        onClick={() => onRemove(item.uid)}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.9} />
      </Button>
    </li>
  )
}

/* ---------------- 页面 ---------------- */

export default function UploadPage() {
  const router = useRouter()

  const [selected, setSelected] = useState<SelectedFile[]>([])
  const [autoAnalyze, setAutoAnalyze] = useState(true)
  /** 每批并发上传的张数。后端对单批内的图片是串行处理的，分批并发可缩短批量上传总耗时 */
  const [concurrency, setConcurrency] = useState(5)
  const [uploading, setUploading] = useState(false)
  const [overallProgress, setOverallProgress] = useState(0)
  const [hasUploaded, setHasUploaded] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  /** uid -> objectURL，卸载/移除时统一 revoke，避免泄漏 */
  const objectUrls = useRef<Map<string, string>>(new Map())

  const showToast = useCallback((tone: ToastTone, text: string) => {
    setToast({ tone, text })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const urls = objectUrls.current
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])

  /** 追加文件：校验类型与体积，生成 objectURL 预览 */
  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const accepted: SelectedFile[] = []
      for (const file of Array.from(incoming)) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          showToast('error', `${file.name} 格式不支持，仅支持 JPG/PNG/GIF/WEBP/BMP`)
          continue
        }
        if (file.size > MAX_SIZE) {
          showToast('error', `${file.name} 超过 10MB 限制，已跳过`)
          continue
        }
        const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const previewUrl = URL.createObjectURL(file)
        objectUrls.current.set(uid, previewUrl)
        accepted.push({ uid, file, previewUrl, status: 'pending' })
      }
      if (accepted.length) {
        setSelected((prev) => [...prev, ...accepted])
        setHasUploaded(false)
        setResult(null)
      }
    },
    [showToast]
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files)
    // 清空 value，保证同一文件可重复选择
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
    if (uploading || hasUploaded) return
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  /** 粘贴上传：旧前端 UploadDropzoneBase 的行为 */
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (uploading || hasUploaded) return
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (files.length) {
      addFiles(files)
      showToast('success', `已从剪贴板添加 ${files.length} 张图片`)
    }
  }

  const handleRemove = (uid: string) => {
    setSelected((prev) => prev.filter((item) => item.uid !== uid))
    const url = objectUrls.current.get(uid)
    if (url) {
      URL.revokeObjectURL(url)
      objectUrls.current.delete(uid)
    }
  }

  const handleReset = () => {
    setSelected([])
    setResult(null)
    setUploading(false)
    setOverallProgress(0)
    setHasUploaded(false)
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }

  /** 批量上传：一次请求提交全部文件，按返回顺序回填逐文件结果 */
  const handleUpload = async () => {
    if (uploading || hasUploaded || selected.length === 0) return

    const files = selected.map((item) => item.file)
    setUploading(true)
    setOverallProgress(10)
    setResult(null)
    setSelected((prev) => prev.map((item) => ({ ...item, status: 'uploading', message: undefined })))

    const buildResult = (successCount: number, items: UploadResultItem[]): UploadResult => ({
      items,
      overallStatus: successCount === items.length ? 'success' : successCount === 0 ? 'failure' : 'partial',
      successCount,
      failureCount: items.length - successCount,
    })

    try {
      setOverallProgress(60)
      // 按并发数分批上传。后端对单批内的图片串行处理，批间并行可缩短总耗时。
      // 各批结果按批次顺序拼接，与 selected 的索引一一对应。
      const uploaded: UploadedImageInfo[] = []
      /** 整批失败时的后端消息，按 selected 索引记录，便于每张图展示真实原因 */
      const batchError = new Map<number, string>()
      for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency)
        const res = await imageService.upload(batch, { auto_analyze: autoAnalyze })

        // 后端成功码为 0；非 0 视为整批失败，用占位让这批图片标记为失败
        if (!res || (res.code !== 0 && res.code !== '0')) {
          const msg = res?.message || '上传失败'
          for (let k = 0; k < batch.length; k++) {
            uploaded.push(undefined as unknown as UploadedImageInfo)
            batchError.set(i + k, msg)
          }
          continue
        }
        const batchUploaded = (Array.isArray(res.data) ? res.data : []) as unknown as UploadedImageInfo[]
        for (let k = 0; k < batch.length; k++) uploaded.push(batchUploaded[k])
      }
      setOverallProgress(90)
      const items: UploadResultItem[] = selected.map((item, index) => {
        const image = uploaded[index]
        if (image) {
          return { id: item.uid, fileName: item.file.name, success: true, image }
        }
        return { id: item.uid, fileName: item.file.name, success: false, message: batchError.get(index) || '服务器未返回该图片的结果' }
      })

      const successCount = items.filter((i) => i.success).length
      setSelected((prev) =>
        prev.map((item, index) =>
          items[index]?.success
            ? { ...item, status: 'success' }
            : { ...item, status: 'error', message: items[index]?.message }
        )
      )
      setResult(buildResult(successCount, items))
      setOverallProgress(100)
      setHasUploaded(true)

      if (successCount === items.length) showToast('success', `上传成功，共 ${successCount} 张图片`)
      else if (successCount > 0) showToast('warning', `部分成功：${successCount}/${items.length} 张`)
      else showToast('error', '上传失败，所有图片均未上传成功')
    } catch (e) {
      const message = (e as Error)?.message || '上传时发生未知错误'
      const items: UploadResultItem[] = selected.map((item) => ({
        id: item.uid,
        fileName: item.file.name,
        success: false,
        message,
      }))
      setSelected((prev) => prev.map((item) => ({ ...item, status: 'error', message })))
      setResult(buildResult(0, items))
      setHasUploaded(true)
      showToast('error', message)
    } finally {
      setUploading(false)
    }
  }

  const disabled = uploading || hasUploaded

  return (
    <AppShell>
      <div className="space-y-6">
        {/* 页头 */}
        <div className="space-y-1">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">上传图片</h1>
          <p className="text-sm text-muted-foreground">
            拖拽、选择或直接粘贴图片，可用 AI 自动生成标题、描述与标签
          </p>
        </div>

        {/* 上传区 */}
        <Card>
          <CardContent className="space-y-5 p-5">
            <div
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled}
              onKeyDown={(e) => {
                if (disabled) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  inputRef.current?.click()
                }
              }}
              onClick={() => !disabled && inputRef.current?.click()}
              onPaste={handlePaste}
              onDragOver={(e) => {
                e.preventDefault()
                if (!disabled) setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                dragActive
                  ? 'border-primary bg-accent'
                  : 'border-primary/45 bg-accent/40 hover:border-primary/70 hover:bg-accent/70'
              )}
            >
              <CloudUpload className="h-9 w-9 text-primary" strokeWidth={1.7} />
              <p className="text-sm font-medium text-foreground">
                点击或拖拽文件到此区域上传，也可以在此处按 Ctrl+V 粘贴
              </p>
              <p className="text-xs text-muted-foreground">
                支持单个或批量上传，仅允许 JPG/PNG/GIF/WEBP/BMP 格式，单个文件最大 10MB
              </p>
            </div>

            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={handleInputChange}
            />

            {/* AI 分析开关 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
              <div className="flex items-start gap-2.5">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.9} />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">上传后自动 AI 分析</p>
                  <p className="text-xs text-muted-foreground">
                    开启后由服务端在写入图片时生成标题、描述与标签，推理较慢时上传耗时更长
                  </p>
                </div>
              </div>
              <Switch
                checked={autoAnalyze}
                onCheckedChange={setAutoAnalyze}
                disabled={disabled}
                aria-label="上传后自动 AI 分析"
              />
            </div>

            {/* 并发设置 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
              <div className="flex items-start gap-2.5">
                <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.9} />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">每批并发上传张数</p>
                  <p className="text-xs text-muted-foreground">
                    服务端按批次串行写入图片，批次之间并行。批量上传时调大可缩短总耗时
                  </p>
                  {autoAnalyze && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      已开启 AI 分析：模型侧有请求频率限制，批量图片较多时建议不超过 5 张/批，
                      否则可能触发限流导致部分图片分析失败（标题保留原文件名）
                    </p>
                  )}
                </div>
              </div>
              <Select value={String(concurrency)} onValueChange={(v) => setConcurrency(Number(v))} disabled={disabled}>
                <SelectTrigger className="w-24" aria-label="每批并发上传张数">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 8, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} 张</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 操作栏 */}
            <div className="space-y-3">
              {uploading && (
                <Progress value={overallProgress} className="h-2" />
              )}
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  type="button"
                  onClick={handleUpload}
                  disabled={selected.length === 0 || uploading || hasUploaded}
                  className="gap-2"
                >
                  {uploading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <CloudUpload className="h-4 w-4" strokeWidth={2} />
                  )}
                  {uploading ? '上传中...' : `上传图片${selected.length ? ` (${selected.length})` : ''}`}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  disabled={uploading}
                  className="gap-2"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                  重置
                </Button>
              </div>
              {hasUploaded && (
                <p className="text-center text-xs text-muted-foreground">
                  本次图片已上传，如需再次上传请先点击重置
                </p>
              )}
            </div>

            {selected.length > 0 && (
              <>
                <Separator />
                {/* 文件列表 */}
                <ul className="space-y-2">
                  {selected.map((item) => (
                    <FileRow
                      key={item.uid}
                      item={item}
                      disabled={disabled}
                      onRemove={handleRemove}
                    />
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        {/* 上传结果 */}
        {result && (
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    {result.overallStatus === 'success' ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" strokeWidth={1.9} />
                    ) : result.overallStatus === 'failure' ? (
                      <AlertCircle className="h-5 w-5 text-destructive" strokeWidth={1.9} />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-amber-600" strokeWidth={1.9} />
                    )}
                    上传结果
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {result.overallStatus === 'success' && `共上传 ${result.successCount} 张图片`}
                    {result.overallStatus === 'partial' &&
                      `成功 ${result.successCount} 张，失败 ${result.failureCount} 张`}
                    {result.overallStatus === 'failure' &&
                      `全部 ${result.failureCount} 张图片上传失败`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => router.push('/images')}
                    disabled={result.successCount === 0}
                    className="gap-2"
                  >
                    查看已上传图片
                    <ArrowRight className="h-4 w-4" strokeWidth={2} />
                  </Button>
                  <Button type="button" variant="outline" onClick={handleReset} className="gap-2">
                    <RefreshCw className="h-4 w-4" strokeWidth={2} />
                    重新上传
                  </Button>
                </div>
              </div>

              <Separator />

              <ul className="space-y-2">
                {result.items.map((item) => {
                  const tags = parseTags(item.image?.tags)
                  return (
                    <li
                      key={item.id}
                      className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-start"
                    >
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
                        {item.success && item.image?.filename ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 后端图床直出字节流，无需 next/image 优化
                          <img
                            src={`/api/v1/images/file/${item.image.filename}`}
                            alt={item.image.title || item.fileName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <FileImage className="h-5 w-5 text-muted-foreground" strokeWidth={1.8} />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground" title={item.fileName}>
                            {item.fileName}
                          </p>
                          {item.success ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-500">
                              <CheckCircle2 className="h-3 w-3" strokeWidth={2.2} />
                              上传成功
                            </span>
                          ) : (
                            <span
                              title={item.message}
                              className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                            >
                              <AlertCircle className="h-3 w-3" strokeWidth={2.2} />
                              上传失败{item.message ? `：${item.message}` : ''}
                            </span>
                          )}
                        </div>

                        {item.success && item.image ? (
                          <div className="space-y-1">
                            <p className="text-sm text-foreground">
                              <span className="text-muted-foreground">标题：</span>
                              {item.image.title || '（未生成）'}
                            </p>
                            {item.image.description && (
                              <p className="line-clamp-2 text-xs text-muted-foreground">
                                {item.image.description}
                              </p>
                            )}
                            {tags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-0.5">
                                {tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                            {tags.length === 0 && !item.image.description && (
                              <p className="text-xs text-muted-foreground">未开启自动分析或未生成描述</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-destructive">{item.message || '未知错误'}</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 固定位置 toast */}
      {toast && (
        <div
          role="status"
          className={cn(
            'fixed left-1/2 top-6 z-50 max-w-[90vw] -translate-x-1/2 rounded-md px-4 py-2.5 text-sm font-medium shadow-lg',
            toast.tone === 'success' && 'bg-emerald-600 text-white',
            toast.tone === 'error' && 'bg-destructive text-destructive-foreground',
            toast.tone === 'warning' && 'bg-amber-500 text-white',
            toast.tone === 'info' && 'bg-secondary text-secondary-foreground'
          )}
        >
          {toast.text}
        </div>
      )}
    </AppShell>
  )
}
