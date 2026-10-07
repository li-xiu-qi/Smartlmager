'use client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import AppShell from '@/components/layout/AppShell'

export default function NotFound() {
  const router = useRouter()
  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center gap-4 py-32 text-center">
        <h1 className="font-serif text-6xl font-bold text-primary">404</h1>
        <p className="text-sm text-muted-foreground">抱歉，您访问的页面不存在。</p>
        <Button onClick={() => router.push('/')}>返回首页</Button>
      </div>
    </AppShell>
  )
}
