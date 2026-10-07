'use client'
import { useState } from 'react'
import AppHeader from './AppHeader'
import AppSidebar from './AppSidebar'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="flex flex-1">
        <AppSidebar collapsed={collapsed} />
        <main className="min-w-0 flex-1 px-6 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
