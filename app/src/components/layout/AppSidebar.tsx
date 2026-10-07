'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Image as ImageIcon, Upload, Search, Settings, Tags } from 'lucide-react'
import { cn } from '@/lib/utils'

const menuItems = [
  { key: 'home', label: '首页', icon: Home, href: '/' },
  { key: 'images', label: '图片管理', icon: ImageIcon, href: '/images' },
  { key: 'upload', label: '上传图片', icon: Upload, href: '/upload' },
  { key: 'search', label: '搜索', icon: Search, href: '/search' },
  { key: 'tags', label: '标签管理', icon: Tags, href: '/tags' },
  { key: 'settings', label: '系统设置', icon: Settings, href: '/settings' },
]

export default function AppSidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname()
  const getKey = () => {
    if (pathname === '/') return 'home'
    if (pathname.startsWith('/images')) return 'images'
    if (pathname.startsWith('/upload')) return 'upload'
    if (pathname.startsWith('/search')) return 'search'
    if (pathname.startsWith('/tags')) return 'tags'
    if (pathname.startsWith('/settings')) return 'settings'
    return 'home'
  }
  const activeKey = getKey()

  return (
    <aside className={cn(
      'flex flex-col border-r border-border bg-card transition-all duration-200',
      collapsed ? 'w-20' : 'w-52'
    )}>
      <div className="flex h-14 items-center px-4 border-b border-border">
        <span className={cn('font-serif text-lg font-semibold text-primary truncate', collapsed && 'text-center w-full')}>
          {collapsed ? 'SI' : 'SmartImager'}
        </span>
      </div>
      <nav className="flex-1 py-3">
        {menuItems.map(({ key, label, icon: Icon, href }) => (
          <Link
            key={key}
            href={href}
            className={cn(
              'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
              collapsed && 'justify-center px-0',
              activeKey === key
                ? 'bg-accent text-accent-foreground font-medium border-r-2 border-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            title={collapsed ? label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
