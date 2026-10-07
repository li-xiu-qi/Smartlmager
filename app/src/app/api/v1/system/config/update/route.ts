import { NextRequest, NextResponse } from 'next/server'
import { readSettings, writeSettings } from '@/lib/settings'

/**
 * POST /api/v1/system/config/update —— 更新用户配置
 *
 * 对齐旧 FastAPI 的 /system/config/update 路径。旧契约传的是四段完整配置
 * （api / storage / model / vectorDb），但迁移后只有推理服务地址真正生效，
 * 因此这里只接受并校验 inference_service_url，其余字段忽略而非假装保存。
 *
 * 传入空字符串表示恢复默认值。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { code: 'CONFIG_UPDATE_ERROR', message: '请求体必须是 JSON 对象', data: null },
        { status: 400 }
      )
    }

    const current = readSettings()
    const next = { ...current }
    const raw = (body as Record<string, unknown>).inference_service_url

    if (raw !== undefined) {
      if (typeof raw !== 'string') {
        return NextResponse.json(
          { code: 'CONFIG_UPDATE_ERROR', message: 'inference_service_url 必须是字符串', data: null },
          { status: 400 }
        )
      }

      const value = raw.trim()
      if (value !== '') {
        // 只接受 http/https，避免写进无法访问或危险的地址
        let parsed: URL
        try {
          parsed = new URL(value)
        } catch {
          return NextResponse.json(
            { code: 'CONFIG_UPDATE_ERROR', message: 'inference_service_url 不是合法的 URL', data: null },
            { status: 400 }
          )
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return NextResponse.json(
            { code: 'CONFIG_UPDATE_ERROR', message: 'inference_service_url 只支持 http 或 https', data: null },
            { status: 400 }
          )
        }
        next.inference_service_url = value
      } else {
        // 空值即恢复默认，删掉该项以便退回环境变量
        delete next.inference_service_url
      }
    }

    const saved = writeSettings(next)
    return NextResponse.json({
      code: 0,
      message: '配置已保存，立即生效（无需重启）',
      data: { message: '配置已保存，立即生效（无需重启）', settings: saved },
    })
  } catch (e: any) {
    return NextResponse.json(
      { code: 'CONFIG_UPDATE_ERROR', message: e?.message || '配置保存失败', data: null },
      { status: 500 }
    )
  }
}
