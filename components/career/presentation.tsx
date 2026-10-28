'use client'

import { type ComponentType, type ReactNode } from 'react'
import type { View } from './legacy-types'

export function Meter({ value }: { value: number }) {
  return (
    <div className="h-1 rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${value / 10}%` }} />
    </div>
  )
}

export function IconTile({
  icon: Icon,
  tone = 'gold',
  size = 22,
}: {
  icon: ComponentType<{
    size?: number
    className?: string
    strokeWidth?: number
    'aria-hidden'?: boolean
  }>
  tone?: 'gold' | 'blue' | 'green' | 'orange' | 'violet' | 'teal'
  size?: number
}) {
  return (
    <span className={`ui-icon-tile ui-icon-${tone}`}>
      <Icon size={size} strokeWidth={1.7} aria-hidden={true} />
    </span>
  )
}

export function Section({
  eyebrow,
  title,
  children,
  action,
  className = '',
}: {
  eyebrow: string
  title: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <section className={`ui-section border border-border bg-card ${className}`}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="ui-label">{eyebrow}</p>
          <h2 className="mt-0.5 text-lg font-bold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function FocusShell({
  setView,
  children,
  backLabel = '← 이번 달 육성',
  backDisabled = false,
}: {
  setView: (v: View) => void
  children: ReactNode
  backLabel?: string
  backDisabled?: boolean
}) {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-7 md:px-8">
      <button
        disabled={backDisabled}
        onClick={() => setView('training')}
        className="text-xs text-muted-foreground"
      >
        {backLabel}
      </button>
      {children}
    </div>
  )
}
