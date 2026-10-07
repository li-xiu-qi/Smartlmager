import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { inferenceHealth } from '@/lib/inference'

export async function GET() {
  try {
    const db = getDb()
    const imgCount = (db.prepare('SELECT COUNT(*) as cnt FROM images').get() as any).cnt
    const inferenceOk = await inferenceHealth()
    return NextResponse.json({
      code: 0, message: 'success',
      data: {
        status: 'ok',
        image_count: imgCount,
        inference_service: inferenceOk ? 'ok' : 'unavailable',
        backend: 'next.js',
      }
    })
  } catch (e: any) {
    return NextResponse.json({ code: 'INTERNAL_ERROR', message: e.message, data: null }, { status: 500 })
  }
}
