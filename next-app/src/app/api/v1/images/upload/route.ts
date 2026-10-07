import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { encodeText, encodeImage, vectorAdd } from '@/lib/inference'
import busboy from 'busboy'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export const config = { api: { bodyParser: false } }

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads')
import { getInferenceUrl } from '@/lib/settings'

export async function POST(req: NextRequest) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    const contentType = req.headers.get('content-type') || ''
    const bb = busboy({ headers: { 'content-type': contentType } })

    const uploadResults: Array<{
      filename: string; filepath: string; mimetype: string;
      originalFilename: string; size: number; buffer: Buffer
    }> = []
    let autoAnalyze = true

    await new Promise<void>((resolve, reject) => {
      const stream = Readable.fromWeb(req.body as any)
      stream.pipe(bb)

      bb.on('field', (name, value) => {
        if (name === 'auto_analyze') autoAnalyze = value !== 'false' && value !== '0'
      })

      bb.on('file', (_name, file, info) => {
        const chunks: Buffer[] = []
        file.on('data', (chunk) => chunks.push(chunk))
        file.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const ext = path.extname(info.filename || '')
          const newName = `${crypto.randomUUID()}${ext}`
          const savePath = path.join(UPLOAD_DIR, newName)
          fs.writeFileSync(savePath, buffer)
          uploadResults.push({
            filename: newName, filepath: savePath, mimetype: info.mimeType,
            originalFilename: info.filename, size: buffer.length, buffer
          })
        })
      })

      bb.on('close', resolve)
      bb.on('error', reject)
    })

    if (!uploadResults.length) {
      return NextResponse.json({ code: 'NO_FILES', message: '没有文件', data: null }, { status: 422 })
    }

    const db = getDb()
    const now = new Date().toISOString()
    const results = []

    for (const file of uploadResults) {
      const buffer = file.buffer

      // 获取图片尺寸
      let width = 0, height = 0
      try {
        if (buffer[0] === 0x89 && buffer[1] === 0x50) {
          width = buffer.readUInt32BE(16)
          height = buffer.readUInt32BE(20)
        } else if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
          let offset = 2
          while (offset < buffer.length) {
            if (buffer[offset] !== 0xFF) { offset++; continue }
            const marker = buffer[offset + 1]
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
              height = buffer.readUInt16BE(offset + 5)
              width = buffer.readUInt16BE(offset + 7)
              break
            }
            offset += 2 + buffer.readUInt16BE(offset + 2)
          }
        }
      } catch {}

      // 调 AI 分析（受 auto_analyze 开关控制）
      let title = file.originalFilename || file.filename, description = '', tags: string[] = []
      if (autoAnalyze) try {
        const analysisRes = await fetch(`${getInferenceUrl()}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: `data:${file.mimetype || 'image/jpeg'};base64,${buffer.toString("base64")}` }),
          signal: AbortSignal.timeout(30000),
        })
        if (analysisRes.ok) {
          const analysis = await analysisRes.json()
          if (analysis.title) title = analysis.title
          if (analysis.description) description = analysis.description
          if (analysis.tags) tags = analysis.tags
        }
      } catch (e) {
        console.error('AI 分析失败:', e)
      }

      // 插入数据库
      const stmt = db.prepare(`
        INSERT INTO images (filename, filepath, title, description, file_size, file_type, width, height, created_at, updated_at, metadata, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const info = stmt.run(
        file.filename, file.filepath, title, description,
        buffer.length, file.mimetype || 'image/jpeg', width, height,
        now, now, JSON.stringify({}), JSON.stringify(tags)
      )
      const imageId = Number(info.lastInsertRowid)

      // 异步生成向量（仅当开启 AI 分析时）
      if (autoAnalyze) generateVectors(imageId, file.filepath, title, description).catch((e) => console.error("[VECTOR] 向量化失败:", e))

      results.push({ id: imageId, filename: file.filename, title, description, tags, width, height })
    }

    return NextResponse.json({
      code: 0, message: 'success',
      data: results,
      metadata: { count: results.length }
    })
  } catch (e: any) {
    console.error('上传失败:', e)
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}

import { Readable } from 'stream'

async function generateVectors(imageId: number, filepath: string, title: string, description: string) {
  const imgVecs = await encodeImage([filepath])
  if (imgVecs?.[0]) await vectorAdd(imageId, 'image', imgVecs[0])
  if (title) {
    const titleVecs = await encodeText([title])
    if (titleVecs?.[0]) await vectorAdd(imageId, 'title', titleVecs[0])
  }
  if (description) {
    const descVecs = await encodeText([description])
    if (descVecs?.[0]) await vectorAdd(imageId, 'description', descVecs[0])
  }
}
