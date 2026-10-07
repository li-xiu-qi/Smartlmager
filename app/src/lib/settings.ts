import fs from 'fs'
import path from 'path'

/**
 * 用户可持久化配置。
 *
 * 为什么需要它：迁移前配置由 Python settings 系统托管，可在线修改；迁移后
 * 各路由直接读 process.env，而环境变量是进程级的，改了对运行中的进程无效。
 * 这个模块把可在线调整的配置落到 data/settings.json，读取时优先于环境变量，
 * 且每次调用都重新读（不缓存模块级常量），因此保存后立即生效、无需重启。
 *
 * 只登记真正生效的配置项。推理服务侧的模型名（glm-4.6v-flash、jina-embeddings-v4）
 * 硬编码在远端服务里，不从请求参数读取，因此不在这里开放编辑——暴露了也是假生效。
 */

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')

export interface AppSettings {
  /** 推理服务地址。影响向量编码、图片分析等所有远端调用 */
  inference_service_url?: string
}

/** 进程内缓存，避免每次读取都做磁盘 IO；写入时同步更新 */
let cache: AppSettings | null = null

function load(): AppSettings {
  try {
    cache = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as AppSettings
  } catch {
    // 文件不存在或内容损坏时视为空配置，退回环境变量与默认值
    cache = {}
  }
  return cache
}

export function readSettings(): AppSettings {
  return cache ?? load()
}

export function writeSettings(next: AppSettings): AppSettings {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8')
  cache = next
  return next
}

const DEFAULT_INFERENCE_URL = 'http://192.168.1.170:8100'

/** 推理服务地址：用户配置 > 环境变量 > 默认值 */
export function getInferenceUrl(): string {
  const configured = readSettings().inference_service_url?.trim()
  return configured || process.env.INFERENCE_SERVICE_URL || DEFAULT_INFERENCE_URL
}
