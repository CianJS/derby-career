'use client'

import { NoticeCenter } from '@/components/notices/notice-center'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Archive, ChevronRight, House, Moon, Settings, Sun, Trophy, UserRound } from 'lucide-react'
import type { View } from './legacy-types'

export function Header({
  setView,
  funds = null,
  saveMode = 'local',
}: {
  setView: (v: View) => void
  funds?: number | null
  saveMode?: 'local' | 'server'
}) {
  const { theme = 'dark', setTheme } = useTheme()
  const [menu, setMenu] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const activeTheme = mounted ? theme : 'dark'
  return (
    <header className="lab-topbar sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur">
      <div className="lab-topbar-inner mx-auto flex h-14 max-w-[1540px] items-center justify-between px-4 md:px-8">
        <button className="lab-brand flex items-center" onClick={() => setView('home')}>
          DERBY CAREER
        </button>
        <div className="ml-auto flex min-w-0 items-center gap-2 text-muted-foreground">
          <span
            className="min-w-0 break-all text-right text-xs leading-tight tabular-nums"
            aria-label="마방 자금"
          >
            {funds === null
              ? saveMode === 'server'
                ? '자금 정보 없음'
                : '자금 확인 중'
              : `₩${funds.toLocaleString('ko-KR')}`}
          </span>
          <NoticeCenter />
          <div className="relative">
            <button
              aria-label="테마 선택"
              onClick={() => setMenu(!menu)}
              className="rounded-lg p-2 hover:bg-accent"
            >
              {activeTheme === 'light' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {menu && (
              <div className="absolute right-0 top-11 z-40 w-36 rounded-xl border border-border bg-popover p-1.5 shadow-xl">
                {(['system', 'light', 'dark'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTheme(t)
                      setMenu(false)
                    }}
                    className="flex w-full justify-between rounded-lg px-2 py-2 text-xs hover:bg-accent"
                  >
                    {t === 'system' ? '시스템 설정' : t === 'light' ? '라이트' : '다크'}
                    {theme === t && ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            aria-label="설정"
            onClick={() => setView('settings')}
            className="rounded-lg p-2 hover:bg-accent"
          >
            <Settings size={17} />
          </button>
        </div>
      </div>
    </header>
  )
}

export function Sidebar({ view, setView }: { view: View; setView: (v: View) => void }) {
  const items: [View, string, typeof House][] = [
    ['home', '홈', House],
    ['stable', '마구간', Archive],
    ['races', '경주 정보', Trophy],
    ['jockeys', '기수', UserRound],
  ]
  const active =
    view === 'horseArchive' || view === 'horse'
      ? 'stable'
      : view === 'race'
        ? 'races'
        : view === 'jockey'
          ? 'jockeys'
          : view
  return (
    <aside className="lab-sidebar hidden w-[var(--layout-sidebar)] shrink-0 border-r border-border/70 bg-sidebar px-4 py-6 lg:block">
      <button onClick={() => setView('home')} className="mb-10 flex items-center px-3">
        <p className="text-left">DERBY CAREER</p>
      </button>
      <nav className="flex flex-col gap-1">
        {items.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${active === key ? 'border-l-2 border-primary bg-accent/70 text-foreground' : 'border-l-2 border-transparent text-muted-foreground hover:bg-accent/60'}`}
          >
            <Icon size={17} className={active === key ? 'text-primary' : ''} />
            {label}
            {active === key && <ChevronRight size={15} className="ml-auto text-primary" />}
          </button>
        ))}
      </nav>
    </aside>
  )
}
