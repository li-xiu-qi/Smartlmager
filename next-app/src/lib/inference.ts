import fs from 'fs'
import path from 'path'

import { getInferenceUrl } from './settings'

// 按扩展名推导真实 MIME。远端解码器（PIL）虽能嗅探格式，
// 但声明与实际内容一致是正确做法，也便于将来接严格校验的服务。
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

function toDataUrl(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

export async function encodeText(inputs: string[]): Promise<number[][] | null> {
  try {
    const r = await fetch(`${getInferenceUrl()}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_type: 'text', inputs }),
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) return null
    const d = await r.json()
    return d.vectors
  } catch { return null }
}

// 传入本机文件路径，在本机读文件转 base64 发远程
export async function encodeImage(imagePaths: string[]): Promise<number[][] | null> {
  try {
    const images = imagePaths.map(toDataUrl)
    const r = await fetch(`${getInferenceUrl()}/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_type: 'image', image_paths: images }),
      signal: AbortSignal.timeout(60000),
    })
    if (!r.ok) return null
    const d = await r.json()
    return d.vectors
  } catch { return null }
}

export async function vectorAdd(imageId: number, vectorType: string, vector: number[]): Promise<boolean> {
  try {
    const r = await fetch(`${getInferenceUrl()}/vectors/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId, vector_type: vectorType, vector }),
      signal: AbortSignal.timeout(10000),
    })
    return r.ok
  } catch { return false }
}

export async function vectorSearch(queryVector: number[], vectorType: string, limit = 20): Promise<Array<{image_id: number, score: number}>> {
  try {
    const r = await fetch(`${getInferenceUrl()}/vectors/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_vector: queryVector, vector_type: vectorType, limit }),
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return []
    const d = await r.json()
    return d.results || []
  } catch { return [] }
}

export async function vectorDelete(imageId: number): Promise<boolean> {
  try {
    const r = await fetch(`${getInferenceUrl()}/vectors/${imageId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    })
    return r.ok
  } catch { return false }
}

// 推理服务健康检查。
// 注意缓存：远端不可达时单次要等满超时（本机实测代理层约 5s 才回 502），
// 而一轮状态刷新里 /system 与 /system/config 都会调它，不缓存会让每轮固定卡两倍超时。
const HEALTH_TIMEOUT_MS = 3000
const HEALTH_TTL_MS = 15_000
let healthCache: { at: number; ok: boolean } | null = null

export async function inferenceHealth(): Promise<boolean> {
  const now = Date.now()
  if (healthCache && now - healthCache.at < HEALTH_TTL_MS) return healthCache.ok
  try {
    const r = await fetch(`${getInferenceUrl()}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    let ok = false
    if (r.ok) {
      const d = await r.json().catch(() => null)
      ok = d?.status === 'ok'
    }
    healthCache = { at: now, ok }
    return ok
  } catch {
    healthCache = { at: now, ok: false }
    return false
  }
}

