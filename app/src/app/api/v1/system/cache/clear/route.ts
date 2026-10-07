import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * POST /api/v1/system/cache/clear —— 清除可安全清理的辅助数据
 *
 * 对齐旧 FastAPI /system/cache/clear 的路径与查询参数（text_cache / image_cache）。
 *
 * 清理范围的关键差异：旧架构清的是 text_vector_cache / image_vector_cache 两个目录，
 * 新架构没有这两个目录，向量数据存在 title_vectors / image_vectors /
 * description_vectors 这三张 vec0 虚拟表里。清空它们会直接废掉语义搜索与以图搜图，
 * 且需要重新为每张图生成向量才能恢复（要重新打推理服务，会撞限流），属于破坏性操作，
 * 因此这里明确**不动向量索引**，只清：
 *
 *   text_cache=true  → conversation_messages（AI 对话消息）
 *   image_cache=true → request_sessions（AI 推荐请求会话）
 *
 * 按旧契约的两个参数复用：清对话历史按文本类缓存计，清会话按图像类缓存计。
 */
export async function POST(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const textCache = sp.get('text_cache') !== 'false' && sp.get('text_cache') !== '0'
    const imageCache = sp.get('image_cache') !== 'false' && sp.get('image_cache') !== '0'

    const db = getDb()
    let messagesRemoved = 0
    let sessionsRemoved = 0

    // 同事务执行，避免清一半
    const tx = db.transaction(() => {
      if (textCache) {
        const r = db.prepare('DELETE FROM conversation_messages').run()
        messagesRemoved = Number(r.changes)
      }
      if (imageCache) {
        const r = db.prepare('DELETE FROM request_sessions').run()
        sessionsRemoved = Number(r.changes)
      }
    })
    tx()

    // 这些表只存文本与结构化记录，不占图床空间，故释放空间按 0 计
    return NextResponse.json({
      code: 0,
      message: 'success',
      data: {
        cleared: true,
        text_cache_entries_removed: messagesRemoved,
        image_cache_entries_removed: sessionsRemoved,
        total_size_freed_mb: 0,
        // 明确告知用户什么没被清，避免误解为「缓存已全部清空」
        vector_index_preserved: true,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: e?.message || '清理失败', data: null },
      { status: 500 }
    )
  }
}
