'use client'
import { useState } from 'react'
import { Bot } from 'lucide-react'
import AIChatDrawer from '@/components/ai/AIChatDrawer'

/** 全局 AI 推荐悬浮按钮，固定在右下角，点击打开对话抽屉 */
export default function GlobalAIFloatButton() {
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        title="AI 图片推荐（对话）"
        aria-label="AI 图片推荐（对话）"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Bot className="h-6 w-6" />
      </button>
      <AIChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
    </>
  )
}
