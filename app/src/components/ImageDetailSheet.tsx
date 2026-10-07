'use client'
import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { X, Save, Trash2 } from 'lucide-react'
import { imageService } from '@/services/api'
import type { ImageDetail } from '@/services/api'

const processTags = (tags: unknown): string[] => {
  if (!tags) return []
  if (typeof tags === 'string') { try { return JSON.parse(tags) } catch { return [] } }
  return Array.isArray(tags) ? tags : []
}

export default function ImageDetailSheet({
  image, open, onClose, onUpdate, onDelete,
}: {
  image: ImageDetail | null
  open: boolean
  onClose: () => void
  onUpdate: (img: ImageDetail) => void
  onDelete: (id: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])

  if (!image) return null

  const imgSrc = `/api/v1/images/file/${image.filename}`
  const currentTags = processTags(image.tags)

  const startEdit = () => {
    setTitle(image.title)
    setDescription(image.description)
    setTags(currentTags)
    setEditing(true)
  }

  const save = async () => {
    try {
      const res = await imageService.update(image.id, { title, description, tags })
      onUpdate(res.data)
      setEditing(false)
    } catch (e) { console.error(e) }
  }

  const formatDate = (d: string) => d ? new Date(d).toLocaleString('zh-CN') : ''

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>图片详情</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <img src={imgSrc} alt={image.title} className="w-full rounded-lg border" />
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">标题</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">描述</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">标签（逗号分隔）</label>
                <Input value={tags.join(', ')} onChange={(e) => setTags(e.target.value.split(',').map(t => t.trim()).filter(Boolean))} className="mt-1" />
              </div>
              <div className="flex gap-2">
                <Button onClick={save} className="gap-1"><Save className="h-4 w-4" />保存</Button>
                <Button variant="outline" onClick={() => setEditing(false)}>取消</Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <h3 className="font-medium">{image.title || '未命名'}</h3>
                {image.description && <p className="mt-1 text-sm text-muted-foreground">{image.description}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {currentTags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
              </div>
              <Separator />
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">文件名</dt><dd>{image.filename}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">尺寸</dt><dd>{image.width} × {image.height}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">大小</dt><dd>{(image.file_size / 1024).toFixed(1)} KB</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">上传时间</dt><dd>{formatDate(image.created_at)}</dd></div>
              </dl>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={startEdit}>编辑</Button>
                <Button variant="destructive" onClick={() => onDelete(image.id)} className="gap-1">
                  <Trash2 className="h-4 w-4" />删除
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
