'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  SlidersHorizontal,
  RefreshCw,
  Settings2,
  Database,
  Cloud,
  Server,
  Clock,
  Boxes,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Info,
  HardDrive,
  Cpu,
  FileImage,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import AppShell from '@/components/layout/AppShell'
import { systemService } from '@/services/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// 轮询间隔：每次拉取都会触发远端推理服务健康检查（5s 超时），1 秒轮询会打爆推理服务，故放宽到 10 秒。
const POLL_INTERVAL_MS = 10_000
const TOAST_DURATION_MS = 3_000

// 模型配置：配置读写接口（updateSystemConfig / clearCache）尚未迁移，
// 展示用值一律从 /api/v1/system/config 读取，这里只作加载完成前的兜底。
const FALLBACK_VISION_MODEL = 'glm-4.6v-flash'
const FALLBACK_EMBEDDING_MODEL = 'jina-embeddings-v4'

// 四个数据源，对应旧 FastAPI 的 /system/info、/database、/storage、/cache、/config
interface SystemDetail {
  info: any
  database: any
  storage: any
  cache: any
  config: any
}

// /api/v1/system 聚合接口：轻量，仅用于在线状态与响应时间探针
interface SystemStatusData {
  status?: string
  image_count?: number
  inference_service?: string
  backend?: string
}

type ToastState = { type: 'success' | 'error'; text: string } | null
type TabKey = 'status' | 'config'

// 状态文案与配色映射（旧前端 getStatusBadge）
function statusText(status?: string): string {
  const map: Record<string, string> = {
    healthy: '正常',
    connected: '已连接',
    available: '可用',
    enabled: '已启用',
    warning: '警告',
    disconnected: '未连接',
    missing: '缺失',
    error: '错误',
    disabled: '已禁用',
  }
  return (status && map[status]) || status || '暂无数据'
}

function statusTone(status?: string): string {
  const ok = ['healthy', 'connected', 'available', 'enabled', 'ok']
  const bad = ['warning', 'disconnected', 'missing', 'error', 'unavailable']
  if (status && ok.includes(status)) return 'text-emerald-600'
  if (status && bad.includes(status)) return 'text-destructive'
  return 'text-muted-foreground'
}

function StatusBadge({ status }: { status?: string }) {
  const tone = statusTone(status)
  const Icon = tone === 'text-emerald-600' ? CheckCircle2 : tone === 'text-destructive' ? XCircle : Info
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-medium', tone)}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {statusText(status)}
    </span>
  )
}

// 单条信息行：dl/dt/dd 结构，比 antd Descriptions 轻
function InfoRow({ label, children, tone, className }: { label: string; children?: React.ReactNode; tone?: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-all text-right text-sm font-medium', tone || 'text-foreground', className)}>
        {children ?? <span className="font-normal text-muted-foreground">暂无数据</span>}
      </dd>
    </div>
  )
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('status')
  const [systemStatus, setSystemStatus] = useState<SystemStatusData | null>(null)
  const [detail, setDetail] = useState<SystemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 运行时监控（旧 SystemRuntime 的迁移）
  const [responseTime, setResponseTime] = useState<number | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [toast, setToast] = useState<ToastState>(null)

  // ── 推理服务地址编辑 ──
  const [urlDraft, setUrlDraft] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  /** 当前生效值由接口拉回，避免与 detail 不同步 */
  const activeInferenceUrl = detail?.config?.inference_service_url ?? ''
  // 空输入框视为「未编辑」而非「要清空」，因此初始状态保存按钮是禁用的。
  // 恢复默认走独立按钮直接提交，不依赖这里。
  const inferenceUrlDirty = urlDraft.trim() !== '' && urlDraft.trim() !== activeInferenceUrl

  const handleSaveConfig = async (valueOverride?: string) => {
    const value = (valueOverride ?? urlDraft).trim()
    if (savingConfig) return
    setSavingConfig(true)
    try {
      const res = await systemService.updateConfig({ inference_service_url: value })
      if (!res || (res.code !== 0 && res.code !== '0')) {
        setToast({ type: 'error', text: res?.message || '保存失败' })
        return
      }
      setToast({
        type: 'success',
        text: value === '' ? '已恢复默认地址' : '已保存，立即生效',
      })
      // 健康状态有 TTL 缓存，拉一次状态以尽快反映新地址。
      // 用 fetchStatus 而非 handleRefresh：后者会自带「系统状态已更新」toast，
      // 会覆盖掉上面这条保存结果的提示。
      await fetchStatus()
    } catch (e) {
      setToast({ type: 'error', text: (e as Error)?.message || '保存失败' })
    } finally {
      setSavingConfig(false)
    }
  }

  const handleRestoreDefault = async () => {
    setUrlDraft('')
    await handleSaveConfig('')
  }

  const handleClearCache = async () => {
    if (clearingCache) return
    const ok = window.confirm(
      '将清除全部 AI 对话消息与推荐请求会话，此操作不可撤销。\n' +
      '图片、标签与向量索引不受影响。是否继续？'
    )
    if (!ok) return
    setClearingCache(true)
    try {
      const res = await systemService.clearCache()
      if (!res || (res.code !== 0 && res.code !== '0')) {
        setToast({ type: 'error', text: res?.message || '清理失败' })
        return
      }
      const d = res.data || {}
      const total = (d.text_cache_entries_removed || 0) + (d.image_cache_entries_removed || 0)
      setToast({
        type: 'success',
        text: total > 0 ? `已清除 ${total} 条记录（对话 ${d.text_cache_entries_removed || 0} + 会话 ${d.image_cache_entries_removed || 0}）` : '没有需要清除的记录',
      })
    } catch (e) {
      setToast({ type: 'error', text: (e as Error)?.message || '清理失败' })
    } finally {
      setClearingCache(false)
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(t)
  }, [toast])

  const fetchStatus = useCallback(async () => {
    const start = Date.now()
    try {
      // 六个接口一次并行。推理服务健康检查在服务端已加 15s 缓存，
      // 因此 config 的 3s 超时只会在缓存过期时付一次，不会让每轮都卡满。
      const [status, info, database, storage, cache, config] = await Promise.all([
        systemService.getStatus(),
        systemService.getInfo(),
        systemService.getDatabase(),
        systemService.getStorage(),
        systemService.getCache(),
        systemService.getConfig(),
      ])
      setResponseTime(Date.now() - start)
      if (status.data) {
        setSystemStatus(status.data)
      } else {
        setErrorCount((c) => c + 1)
      }
      setDetail({
        info: info.data,
        database: database.data,
        storage: storage.data,
        cache: cache.data,
        config: config.data,
      })
      setLastUpdate(new Date())
      setLoadError(null)
      setErrorCount(0)
    } catch (e) {
      setResponseTime(Date.now() - start)
      setErrorCount((c) => c + 1)
      setLoadError(e instanceof Error ? e.message : '未知错误')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    timerRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [fetchStatus])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchStatus()
    setToast({ type: 'success', text: '系统状态已更新' })
  }

  const online: 'online' | 'warning' | 'offline' =
    errorCount >= 3 ? 'offline' : errorCount >= 1 ? 'warning' : 'online'

  const perf =
    responseTime === null
      ? null
      : responseTime < 300
        ? { text: '良好', percent: 20 }
        : responseTime < 800
          ? { text: '正常', percent: 50 }
          : responseTime < 1500
            ? { text: '较慢', percent: 75 }
            : { text: '较差', percent: 95 }

  const timeSince = lastUpdate
    ? `${Math.floor((Date.now() - lastUpdate.getTime()) / 1000)} 秒前`
    : '暂无数据'

  const navItems: Array<{ key: TabKey; label: string; icon: typeof Activity }> = [
    { key: 'status', label: '系统状态', icon: Activity },
    { key: 'config', label: '当前配置', icon: SlidersHorizontal },
  ]

  return (
    <AppShell>
      <div className="space-y-6">
        {/* 标题区 */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">系统设置</h1>
            <p className="text-sm text-muted-foreground">
              查看运行状态与配置。推理服务地址可在此修改并立即生效，模型名由推理服务侧决定。
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-card px-4 text-sm font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} strokeWidth={1.9} />
            刷新状态
          </button>
        </div>

        {/* 固定位置 toast */}
        {toast && (
          <div
            className={cn(
              'fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-md px-4 py-2.5 text-sm font-medium shadow-lg',
              toast.type === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-destructive text-destructive-foreground'
            )}
          >
            {toast.text}
          </div>
        )}

        <div className="flex flex-col gap-6 md:flex-row">
          {/* 左侧分段导航 */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-44 md:flex-col">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3.5 text-sm font-medium transition-colors',
                  activeTab === key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                {label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1">
            {activeTab === 'status' && (
              <div className="space-y-4">
                {/* 系统运行状态监控 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      系统运行状态监控
                      <span className="text-xs font-normal text-muted-foreground">每 10 秒自动刷新</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {loading && !systemStatus ? (
                      <div className="space-y-3">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-16 w-full" />
                      </div>
                    ) : online === 'offline' ? (
                      <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
                        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-destructive">系统离线</p>
                          <p className="text-sm text-muted-foreground">
                            无法连接到系统后端服务{loadError ? `：${loadError}` : ''}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                              online === 'online'
                                ? 'bg-emerald-600/10 text-emerald-600'
                                : 'bg-amber-500/10 text-amber-600'
                            )}
                          >
                            {online === 'online' ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5" />
                            )}
                            {online === 'online' ? '系统在线' : '响应异常'}
                          </span>
                          {responseTime !== null && (
                            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                              响应时间：{responseTime} ms
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">最后更新：{timeSince}</span>
                        </div>

                        {perf && (
                          <div className="space-y-1.5">
                            <p className="text-sm text-muted-foreground">系统响应性能：{perf.text}</p>
                            <Progress value={perf.percent} />
                          </div>
                        )}

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-md border p-4">
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" /> 应用运行时间
                            </p>
                            <p className="mt-1 text-lg font-semibold text-foreground">
                              {detail?.info?.app_uptime_formatted ?? '暂无数据'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">Node.js 进程启动至今</p>
                          </div>
                          <div className="rounded-md border p-4">
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" /> 系统时间
                            </p>
                            <p className="mt-1 text-lg font-semibold text-foreground">
                              {detail?.cache?.last_scan
                                ? new Date(detail.cache.last_scan * 1000).toLocaleString('zh-CN')
                                : '暂无数据'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">最近一次状态统计时刻</p>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* 三栏信息板块 */}
                <div className="grid gap-4 lg:grid-cols-3">
                  {/* 系统 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Server className="h-4 w-4 text-muted-foreground" /> 系统
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl>
                        <InfoRow label="版本">{detail?.info?.version}</InfoRow>
                        <InfoRow label="状态">
                          <StatusBadge status={detail?.info?.status} />
                        </InfoRow>
                        <InfoRow label="后端" tone="text-foreground">
                          {detail?.config?.backend ?? systemStatus?.backend}
                        </InfoRow>
                        <InfoRow label="平台">{detail?.info?.platform}</InfoRow>
                        <InfoRow label="Node 版本">{detail?.info?.node_version}</InfoRow>
                        <InfoRow label="应用运行时间">{detail?.info?.app_uptime_formatted}</InfoRow>
                        <InfoRow label="服务器地址" className="break-all">
                          {detail?.config?.inference_service_url}
                        </InfoRow>
                      </dl>
                    </CardContent>
                  </Card>

                  {/* 可编辑配置 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Settings2 className="h-4 w-4 text-primary" strokeWidth={1.9} />
                        推理服务地址
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-1.5">
                        <label htmlFor="inference-url" className="text-xs text-muted-foreground">
                          向量编码、图片分析与以图搜图都请求这个地址。保存后立即生效，无需重启。
                        </label>
                        <input
                          id="inference-url"
                          type="text"
                          inputMode="url"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={activeInferenceUrl || 'http://192.168.1.170:8100'}
                          value={urlDraft}
                          onChange={(e) => setUrlDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && inferenceUrlDirty) void handleSaveConfig()
                          }}
                          className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        {detail?.config?.inference_service_overridden && (
                          <p className="text-xs text-muted-foreground">
                            当前为自定义地址。清空输入框并保存可恢复默认值。
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleSaveConfig()}
                          disabled={!inferenceUrlDirty || savingConfig}
                        >
                          {savingConfig ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          保存
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setUrlDraft(activeInferenceUrl)}
                          disabled={!inferenceUrlDirty}
                        >
                          撤销修改
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleRestoreDefault}
                          disabled={savingConfig || !detail?.config?.inference_service_overridden}
                        >
                          恢复默认
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-dashed p-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-foreground">清除辅助数据</p>
                          <p className="text-xs text-muted-foreground">
                            清除 AI 对话消息与推荐请求会话。图片、标签与向量索引不受影响。
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleClearCache}
                          disabled={clearingCache}
                        >
                          {clearingCache ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          清除
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        AI 分析模型（{detail?.config?.vision_model ?? 'glm-4.6v-flash'}）与 Embedding 模型
                        （{detail?.config?.embedding_model ?? 'jina-embeddings-v4'}）由推理服务侧决定，不在此处修改。
                      </p>
                    </CardContent>
                  </Card>

                  {/* 数据库与推理服务 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Database className="h-4 w-4 text-muted-foreground" /> 数据库与推理服务
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl>
                        <InfoRow label="数据库状态">
                          <StatusBadge status={detail?.database?.status} />
                        </InfoRow>
                        <InfoRow label="数据库类型">{detail?.database?.type}</InfoRow>
                        <InfoRow label="数据库版本" className="break-all">{detail?.database?.db_version}</InfoRow>
                        <InfoRow label="向量状态">
                          <StatusBadge status={detail?.database?.vector_status ? 'available' : 'missing'} />
                        </InfoRow>
                        <InfoRow label="向量驱动">
                          <StatusBadge status={detail?.cache?.vector_engine?.driver?.available ? 'available' : 'missing'} />
                        </InfoRow>
                        <InfoRow label="推理服务状态">
                          <StatusBadge status={detail?.config?.inference_service_status} />
                        </InfoRow>
                        <InfoRow label="多模态 API">
                          <StatusBadge status={detail?.config?.inference_service_status === 'ok' ? 'enabled' : 'disabled'} />
                        </InfoRow>
                        <InfoRow label="当前 AI 分析模型">
                          {detail?.config?.vision_model ?? FALLBACK_VISION_MODEL}
                        </InfoRow>
                        <InfoRow label="Embedding 模型">
                          {detail?.config?.embedding_model ?? FALLBACK_EMBEDDING_MODEL}
                        </InfoRow>
                        <InfoRow label="Embedding 维度">{detail?.config?.embedding_dimension}</InfoRow>
                      </dl>
                    </CardContent>
                  </Card>

                  {/* 存储 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Cloud className="h-4 w-4 text-muted-foreground" /> 存储
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-md border p-3">
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <FileImage className="h-3.5 w-3.5" /> 图片总数
                          </p>
                          <p className="mt-1 text-xl font-semibold text-foreground">
                            {detail?.storage?.total_images ?? systemStatus?.image_count ?? 0}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">张</span>
                          </p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Boxes className="h-3.5 w-3.5" /> 标签总数
                          </p>
                          <p className="mt-1 text-xl font-semibold text-foreground">
                            {detail?.storage?.total_tags ?? 0}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">个</span>
                          </p>
                        </div>
                      </div>
                      <dl>
                        <InfoRow label="数据库路径" className="break-all">{detail?.database?.path}</InfoRow>
                        <InfoRow label="图片目录" className="break-all">{detail?.storage?.upload_dir}</InfoRow>
                        <InfoRow label="存储总大小">
                          {detail?.storage?.total_size_mb !== undefined ? `${detail.storage.total_size_mb} MB` : undefined}
                        </InfoRow>
                        <InfoRow label="缓存大小">
                          {detail?.cache?.total_size_mb !== undefined ? `${detail.cache.total_size_mb} MB` : undefined}
                        </InfoRow>
                        <InfoRow label="统计时间">
                          {detail?.cache?.last_scan
                            ? new Date(detail.cache.last_scan * 1000).toLocaleString('zh-CN')
                            : undefined}
                        </InfoRow>
                      </dl>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {activeTab === 'config' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-amber-700">配置只读，不支持在线修改</p>
                    <p className="text-muted-foreground">
                      读取已接通，下面的值实时取自 /api/v1/system/config 与 /system/cache。保存与清除缓存
                      依赖 updateSystemConfig / clearCache 接口，尚未迁移，需要改配置请直接编辑服务端配置文件。
                    </p>
                  </div>
                </div>

                {/* 模型配置 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Cpu className="h-4 w-4 text-muted-foreground" /> 模型配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl>
                      <InfoRow label="AI 分析模型">{detail?.config?.vision_model ?? FALLBACK_VISION_MODEL}</InfoRow>
                      <InfoRow label="Embedding 模型">{detail?.config?.embedding_model ?? FALLBACK_EMBEDDING_MODEL}</InfoRow>
                      <InfoRow label="Embedding 维度">{detail?.config?.embedding_dimension}</InfoRow>
                      <InfoRow label="语义搜索状态">
                        <StatusBadge status={detail?.config?.inference_service_status === 'ok' ? 'available' : 'unavailable'} />
                      </InfoRow>
                    </dl>
                  </CardContent>
                </Card>

                {/* 存储配置 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <HardDrive className="h-4 w-4 text-muted-foreground" /> 存储配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl>
                      <InfoRow label="存储根目录" className="break-all">{detail?.storage?.upload_dir}</InfoRow>
                      <InfoRow label="缓存目录" className="break-all">
                        {detail?.cache?.text_vector_cache?.path}
                      </InfoRow>
                      <InfoRow label="最大缓存大小">{detail?.cache?.max_size_gb} GB</InfoRow>
                      <InfoRow label="当前缓存大小">
                        {detail?.cache?.total_size_mb !== undefined ? `${detail.cache.total_size_mb} MB` : undefined}
                      </InfoRow>
                      <InfoRow label="图片总数" tone="text-foreground">
                        {detail?.storage?.total_images ?? systemStatus?.image_count ?? 0} 张
                      </InfoRow>
                      <InfoRow label="标签总数" tone="text-foreground">{detail?.storage?.total_tags ?? 0} 个</InfoRow>
                    </dl>
                  </CardContent>
                </Card>

                {/* 向量数据库配置 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Database className="h-4 w-4 text-muted-foreground" /> 向量数据库配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl>
                      <InfoRow label="sqlite-vec 驱动状态">
                        <StatusBadge status={detail?.cache?.vector_engine?.driver?.available ? 'available' : 'missing'} />
                      </InfoRow>
                      <InfoRow label="驱动版本">{detail?.cache?.vector_engine?.driver?.version}</InfoRow>
                      <InfoRow label="向量功能总开关">
                        <StatusBadge status={detail?.cache?.vector_engine?.enabled ? 'enabled' : 'disabled'} />
                      </InfoRow>
                      <InfoRow label="Embedding 模型可用性">
                        <StatusBadge status={detail?.cache?.vector_engine?.model?.available ? 'available' : 'missing'} />
                      </InfoRow>
                      <InfoRow label="向量库路径" className="break-all">
                        {detail?.cache?.image_vector_cache?.path}
                      </InfoRow>
                      <InfoRow label="向量库大小">
                        {detail?.cache?.image_vector_cache?.size_mb !== undefined
                          ? `${detail.cache.image_vector_cache.size_mb} MB`
                          : undefined}
                      </InfoRow>
                    </dl>
                  </CardContent>
                </Card>

                {/* API 配置 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Settings2 className="h-4 w-4 text-muted-foreground" /> API 配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-sm text-muted-foreground">
                        API 密钥是敏感信息，仅保存在服务器端配置文件中，本页不展示密钥内容。
                      </p>
                    </div>
                    <dl>
                      <InfoRow label="API 密钥">
                        <span className="font-normal text-muted-foreground">仅存于服务端，不向前端暴露</span>
                      </InfoRow>
                      <InfoRow label="推理服务地址" className="break-all">
                        {detail?.config?.inference_service_url}
                      </InfoRow>
                      <InfoRow label="后端类型" tone="text-foreground">
                        {detail?.config?.backend ?? systemStatus?.backend}
                      </InfoRow>
                    </dl>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
