import { api, searchService } from '@/services/api'
import type { ImageDetail } from '@/services/api'

/**
 * 搜索客户端：把后端各搜索接口的返回结构归一化成统一的 SearchOutcome。
 *
 * 文本语义搜索与上传图片语义搜索的路由均已接入，调用由 SEARCH_API_STATUS 门控。
 */

/** 搜索结果项：图片详情 + 相似度得分（GalleryImageCard 依赖 score 展示相似度） */
export interface SearchResultItem extends ImageDetail {
  score?: number
}

/** 归一化后的搜索结果 */
export interface SearchOutcome {
  items: SearchResultItem[]
  total: number
  searchTimeMs: number
  referenceImage: { id: number; title: string } | null
  /** 文件名匹配分支受前端检索池上限约束时为 true */
  truncated: boolean
}

/** 向量搜索目标 */
export type VectorTarget = 'title' | 'description' | 'image'

/** 文本语义搜索参数 */
export interface TextSearchParams {
  q: string
  vectorTargets: VectorTarget[]
  tags?: string[]
  weights?: Partial<Record<VectorTarget, number>>
  minScore?: number
  limit?: number
}

/**
 * 以图搜图请求。两种来源二选一：
 * - reference：用库中已有图片做查询（接口已就位）
 * - upload：用上传的图片做查询（接口待接入）
 */
export type ImageSearchRequest =
  | { mode: 'reference'; imageId: number; vectorType: VectorTarget; limit: number }
  | { mode: 'upload'; params: UploadImageSearchParams }

/** 上传图片语义搜索参数 */
export interface UploadImageSearchParams {
  file: File
  searchTargets: VectorTarget[]
  tags?: string[]
  weights?: Partial<Record<VectorTarget, number>>
  minScore?: number
  limit?: number
}

/** 关键词（LIKE）搜索参数 */
export interface FuzzySearchParams {
  q: string
  /** title / description / filename，缺省为 title + description */
  fields?: string[]
  tags?: string[]
}

/**
 * 搜索接口接入状态。后端路由已补齐，两个开关均为 true。
 * - textSearch：GET  /api/v1/search/unified
 * - imageUpload：POST /api/v1/search/unified/image
 * 已就位的接口（/search/similar/[id]、/images）不受此开关约束。
 */
export const SEARCH_API_STATUS = {
  textSearch: true,
  imageUpload: true,
} as const

/** 接口尚未接入时抛出，页面据此给出「待实现」提示而不是裸报错 */
export class SearchEndpointNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchEndpointNotReadyError'
  }
}

/** 关键词搜索的前端检索池上限：文件名匹配只能在前端过滤，超出部分搜不到 */
const FUZZY_POOL_SIZE = 100

/** 解析图片 tags 字段（库里是 JSON 字符串，接口原样返回） */
const parseTags = (tags: unknown): string[] => {
  if (!tags) return []
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return Array.isArray(tags) ? tags : []
}

/**
 * 归一化结果数组。
 * /search/similar/[id] 返回 [{ image_id, score, image }]，其余接口直接返回图片行。
 */
const normalize = (data: unknown): SearchResultItem[] => {
  if (!Array.isArray(data)) return []
  return data
    .map((raw: any) => {
      if (raw && raw.image && typeof raw.image === 'object') {
        return { ...raw.image, score: raw.score ?? raw.image.score } as SearchResultItem
      }
      return raw as SearchResultItem
    })
    .filter((item) => item && typeof item.id !== 'undefined')
}

/** 文本语义搜索 */
export async function searchByText(params: TextSearchParams): Promise<SearchOutcome> {
  if (!SEARCH_API_STATUS.textSearch) {
    throw new SearchEndpointNotReadyError('文本语义搜索接口未接入：GET /api/v1/search/unified')
  }
  const startedAt = Date.now()
  const res = await api.get<any[]>('/search/unified', {
    q: params.q,
    search_type: 'vector',
    // 旧后端用 FastAPI List[str] + alias="vector_targets[]"，逗号分隔即可
    'vector_targets[]': params.vectorTargets.join(','),
    tags: params.tags?.join(','),
    weights: params.weights && Object.keys(params.weights).length ? JSON.stringify(params.weights) : undefined,
    min_score: params.minScore,
    limit: params.limit ?? 20,
    offset: 0,
  })
  const items = normalize(res.data)
  const meta = res.metadata ?? {}
  return {
    items,
    total: meta.total_results ?? meta.total ?? items.length,
    searchTimeMs: meta.execution_time_ms ?? Date.now() - startedAt,
    referenceImage: meta.reference_image ?? null,
    truncated: false,
  }
}

/** 上传图片语义搜索 */
export async function searchByUpload(params: UploadImageSearchParams): Promise<SearchOutcome> {
  if (!SEARCH_API_STATUS.imageUpload) {
    throw new SearchEndpointNotReadyError('上传图片语义搜索接口未接入：POST /api/v1/search/unified/image')
  }
  const form = new FormData()
  form.append('file', params.file)
  params.searchTargets.forEach((t) => form.append('search_targets', t))
  if (params.tags?.length) form.append('tags', params.tags.join(','))
  if (params.weights && Object.keys(params.weights).length) form.append('weights', JSON.stringify(params.weights))
  if (typeof params.minScore === 'number') form.append('min_score', String(params.minScore))
  form.append('limit', String(params.limit ?? 20))

  const startedAt = Date.now()
  const res = await api.post<any[]>('/search/unified/image', form)
  const items = normalize(res.data)
  const meta = res.metadata ?? {}
  return {
    items,
    total: meta.total_results ?? meta.total ?? items.length,
    searchTimeMs: meta.execution_time_ms ?? Date.now() - startedAt,
    referenceImage: meta.reference_image ?? null,
    truncated: false,
  }
}

/** 以图搜图：用库中已有图片作为查询（接口已就位） */
export async function searchSimilar(imageId: number, vectorType: VectorTarget, limit = 20): Promise<SearchOutcome> {
  const res = await searchService.similar(imageId, { vector_type: vectorType, limit })
  const items = normalize(res.data)
  return {
    items,
    total: res.metadata?.total ?? items.length,
    searchTimeMs: 0,
    referenceImage: null,
    truncated: false,
  }
}

/**
 * 关键词搜索（LIKE）。
 * 标题/描述走后端 /images 的 keyword 参数（全表匹配）；
 * 文件名后端无参数支持，只能拉取检索池在前端过滤，因此有 FUZZY_POOL_SIZE 上限；
 * 标签按多标签 AND 在前端过滤（后端 tags 参数是单串 LIKE，多标签语义不可靠）。
 */
export async function fuzzySearch(params: FuzzySearchParams): Promise<SearchOutcome> {
  const q = params.q.trim().toLowerCase()
  const fields = params.fields?.length ? params.fields : ['title', 'description']
  const wantText = fields.includes('title') || fields.includes('description')
  const wantFilename = fields.includes('filename')

  const pool: SearchResultItem[] = []
  const seen = new Set<number>()
  const push = (rows: ImageDetail[]) => {
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id)
        pool.push(row as SearchResultItem)
      }
    }
  }

  let truncated = false
  if (wantText) {
    const res = await api.get<ImageDetail[]>('/images', { page: 1, page_size: 50, keyword: params.q.trim() })
    push(res.data ?? [])
  }
  if (wantFilename) {
    const res = await api.get<ImageDetail[]>('/images', { page: 1, page_size: FUZZY_POOL_SIZE })
    const rows = res.data ?? []
    if (rows.length >= FUZZY_POOL_SIZE) truncated = true
    push(rows.filter((row) => (row.filename ?? '').toLowerCase().includes(q)))
  }

  const selectedTags = params.tags ?? []
  const items = selectedTags.length
    ? pool.filter((row) => {
        const rowTags = parseTags(row.tags)
        return selectedTags.every((tag) => rowTags.includes(tag))
      })
    : pool

  return { items, total: items.length, searchTimeMs: 0, referenceImage: null, truncated }
}
