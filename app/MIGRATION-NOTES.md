# 前端迁移范式（子 agent 必读）

## 环境
- 项目根：`C:/Users/ke/Documents/projects/CodeProjects/Windows-Native/Smartlmager-suite/Smartlmager/app`
- 旧前端（只读参考，禁止修改）：`../frontend/src/`
- Node 依赖安装必须 `NODE_ENV=development npm install <pkg>`
- dev server：`NODE_ENV=development npx next dev --port 9187 --webpack`（必须 --webpack）

## 已就位的地基（直接 import，不要重建）
- `@/lib/utils` → cn()
- `@/services/api` → api, imageService, tagService, searchService, systemService, 类型 ImageDetail / ApiResponse / Pagination
- `@/components/ui/*` → button, card, input, label, badge, separator, dialog, sheet, skeleton, tooltip, checkbox, dropdown-menu, select, tabs, progress, scroll-area, textarea, switch, popover, avatar
- `@/components/layout/AppShell` → 页面外壳（侧边栏+顶栏），页面直接用 `<AppShell>...</AppShell>` 包裹
- `@/components/GalleryImageCard` → 画廊卡片，props: { image, onClick, onTagClick, showTags, showSimilarity, multiSelectMode, selected, onSelect }
- `@/components/ImageDetailSheet` → 图片详情抽屉，props: { image, open, onClose, onUpdate, onDelete }
- 图片 URL：`/api/v1/images/file/${image.filename}`（已实现，直接返回图片字节）

## 迁移规则（硬约束）
1. 技术栈：Next.js 16 App Router + React 19 + TypeScript + Tailwind 3 + shadcn/ui
2. 页面文件位置：`src/app/<route>/page.tsx`，首行 `'use client'`
3. 路由用 `next/navigation` 的 useRouter/usePathname，不要 react-router-dom
4. antd 组件全部换成 shadcn 等价物：
   - Drawer → Sheet（@/components/ui/sheet）
   - message.success/error → 自写 toast（用 sonner 或简单的 state 提示，优先用简单的固定位置 div 提示，不要引新依赖除非必要）
   - Spin → Skeleton 或 Loader2 (lucide)
   - Table → 手写 table + Tailwind
   - Form → 手写 + react state
   - Menu → 已在 AppSidebar 实现
5. 样式：Tailwind class，不要 less/css 文件。设计 token 用语义色：bg-background/text-foreground/bg-card/border-border/text-muted-foreground/bg-primary/text-primary-foreground/bg-accent/bg-secondary/bg-muted/bg-destructive
6. 数据获取：useEffect + service 函数，service 返回 `{ code, message, data, metadata }`
7. 分页响应：`metadata.pagination = { page, page_size, total_items, total_pages }`
8. 图片列表接口：`imageService.getList({ page, page_size, tags, search })`，tags 是逗号分隔字符串
9. **不要修改 src/app/api/v1 下已有的路由文件**，需要新接口先在 MIGRATION-NOTES 里登记
10. 不要引入 axios，统一用 service 层
11. 中文注释，中文 UI 文案

## 验证方式
- 改完跑 `curl -s -o /dev/null -w "%{http_code}" http://localhost:9187/<route>` 必须是 200
- 检查浏览器无 console error（看 dev server 输出）

## 已知坑
- heredoc 写文件时反斜杠会被吃掉，涉及 `\` 的代码用 String.fromCharCode(92) 或避免
- next.config.js 必须保留 serverExternalPackages: ['better-sqlite3']
- 动态路由 slug 统一用 [id]，不要用 [image_id]

## 迁移完成状态（2026-09-09）

7 个页面全部迁移完成，tsc --noEmit 零错误，全站 HTTP 200：

| 路由 | 文件 | 状态 |
|------|------|------|
| / | src/app/page.tsx | home |
| /images | src/app/images/page.tsx | 列表（筛选/网格+列表/多选批量删除/分页/导出/URL同步） |
| /upload | src/app/upload/page.tsx | 上传（拖拽+粘贴/进度/AI开关/结果展示） |
| /search | src/app/search/page.tsx | 搜索（文本/以图搜图/模糊，参考图搜索可用） |
| /tags | src/app/tags/page.tsx | 标签云+表格+搜索 |
| /settings | src/app/settings/page.tsx | 系统状态/推理服务/存储/向量库/模型配置 |
| 404 | src/app/not-found.tsx | Next.js 内置 not-found |

### 后端接口修正记录
- `/api/v1/images` 的 keyword 参数现同时接受 `search`（兼容 service 层传参）
- keyword 搜索范围扩展到 filename（原来只搜 title/description）
- `/api/v1/images/upload` 现读取 `auto_analyze` 字段，false 时跳过 AI 分析与向量化

### 待补后端接口（search 页需要，改 searchClient.ts 的 SEARCH_API_STATUS 开关接入）
- `GET /api/v1/search/unified` — 文本语义搜索（q, vector_targets, tags, weights, min_score, limit）
- `POST /api/v1/search/unified/image` — 上传图片语义搜索（multipart, file, search_targets, tags, weights, min_score, limit）

### AI 对话/推荐接口契约（2026-09-09 迁移中）

**表结构已存在**：`conversation_messages`、`request_sessions`（本地 DB 已有，勿重建）

**POST /api/v1/ai/recommend/chat** — 非流式推荐
- 请求：`{ messages?: [{role, content}], query?: string, vector_targets?: string[], limit?: number, filters?: { tags?, filename?, start_date?, end_date? }, conversation_id?, user_id?, request_id? }`
- 响应：`{ code: 0, message, data: { success: boolean, images: ImageRow[], image_ids: number[], limit: number, error?: string } }`

**POST /api/v1/ai/recommend/chat/stream** — SSE 流式（前端已有解析器，勿改事件名）
- 请求同上
- 响应 Content-Type: text/event-stream，事件类型固定为：
  - `event: rewrite_start` / `data: {}`
  - `event: assistant_delta` / `data: { "delta": "文本片段" }`
  - `event: complete` / `data: { images, image_ids, ... }`
  - `event: error` / `data: { "message": "..." }`
- 分段符 `\n\n`，每段内 `event:` 与 `data:` 各一行

**GET /api/v1/ai/conversations** — 会话列表
**POST /api/v1/ai/conversations/create** — 建会话
**DELETE /api/v1/ai/conversations/{id}** — 删会话
**GET /api/v1/ai/conversations/{id}/messages** — 会话消息（最多 40 条）

**实现要求**
- LLM 调用走远程推理服务 8100 的 `/chat` 接口（若未实现则先在推理服务加）
- 向量检索走本地 `/api/v1/vectors/search`（已通）
- 对话历史读写本地 SQLite
- 图片数据从本地 images 表查
