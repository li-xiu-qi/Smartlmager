// 统一 API 响应类型
export interface ApiResponse<T> {
  code: number | string
  message: string
  data: T
  metadata?: any
}

export interface Pagination {
  page: number
  page_size: number
  total_items: number
  total_pages: number
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  metadata: { pagination: Pagination }
}

// 统一请求封装
async function request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  // FormData 时不能设 Content-Type，要交给浏览器自动生成带 boundary 的 multipart 头。
  // 这里原先无条件预设 application/json，覆盖了 api.post 传的空 headers，
  // 结果是 multipart 请求被声明成 JSON，后端报 Unsupported content type。
  const isForm = options?.body instanceof FormData
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  get: <T>(url: string, params?: Record<string, any>) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)])
    ).toString() : ''
    return request<T>(`/api/v1${url}${qs}`)
  },
  post: <T>(url: string, data?: any) =>
    request<T>(`/api/v1${url}`, { method: 'POST', body: data instanceof FormData ? data : JSON.stringify(data),
      headers: data instanceof FormData ? {} : { 'Content-Type': 'application/json' } }),
  put: <T>(url: string, data?: any) =>
    request<T>(`/api/v1${url}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: <T>(url: string, body?: any) =>
    request<T>(`/api/v1${url}`, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
}

// 图片类型
export interface ImageDetail {
  id: number
  filename: string
  filepath: string
  title: string
  description: string
  file_size: number
  file_type: string
  width: number
  height: number
  created_at: string
  updated_at: string
  metadata: string
  tags: string
}

export const imageService = {
  getList: (params?: { page?: number; page_size?: number; tags?: string; search?: string }) =>
    api.get<ImageDetail[]>('/images', params),
  getDetail: (id: number | string) =>
    api.get<ImageDetail>(`/images/${id}`),
  upload: (files: File[], options?: { auto_analyze?: boolean }) => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    if (options?.auto_analyze) formData.append('auto_analyze', 'true')
    return api.post<ImageDetail[]>('/images/upload', formData)
  },
  update: (id: number, data: { title?: string; description?: string; tags?: string[] }) =>
    api.put<ImageDetail>(`/images/${id}`, data),
  delete: (id: number) =>
    api.delete<{ id: number }>(`/images/${id}`),
  batchDelete: (ids: number[]) =>
    api.delete<any>('/images/batch', { image_ids: ids }),
  exportAllUrl: () => '/api/v1/images/export-all',
}

export const tagService = {
  getAll: (search?: string) =>
    api.get<Array<{ name: string; count: number }>>('/tags', { search }),
}

export const searchService = {
  similar: (id: number, params?: { vector_type?: string; limit?: number }) =>
    api.get<any[]>(`/search/similar/${id}`, params),
}

export const systemService = {
  // 聚合总状态：轻量，含响应时间探针，用于轮询在线状态
  getStatus: () =>
    api.get<any>('/system'),
  // 基本系统信息：版本 / 运行时间 / 平台 / 模型
  getInfo: () =>
    api.get<any>('/system/info'),
  // 数据库状态：连接 / 版本 / 统计 / 向量
  getDatabase: () =>
    api.get<any>('/system/database'),
  // 存储统计：图片数 / 大小 / 标签数 / 目录
  getStorage: () =>
    api.get<any>('/system/storage'),
  // 缓存与向量引擎状态
  getCache: () =>
    api.get<any>('/system/cache'),
  // 当前生效配置。inference_service_url 可在线修改，其余为部署参数（只读）
  getConfig: () =>
    api.get<any>('/system/config'),
  /**
   * 保存用户配置。目前只接受 inference_service_url；
   * 传空字符串表示恢复默认值（退回环境变量）。
   */
  updateConfig: (payload: { inference_service_url?: string }) =>
    api.post<any>('/system/config/update', payload),
  /**
   * 清除辅助数据（AI 对话消息与推荐请求会话）。向量索引不受影响。
   * 两个布尔参数对应旧 FastAPI 契约的 text_cache / image_cache。
   */
  clearCache: (opts: { textCache?: boolean; imageCache?: boolean } = {}) => {
    const { textCache = true, imageCache = true } = opts
    const qs = `?text_cache=${textCache}&image_cache=${imageCache}`
    return api.post<any>('/system/cache/clear' + qs, {})
  },
}
