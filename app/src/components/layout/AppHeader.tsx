'use client'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AppHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur">
      <Button variant="ghost" size="icon" onClick={onToggle} className="h-8 w-8">
        {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>
      <div className="flex-1" />
    </header>
  )
}
