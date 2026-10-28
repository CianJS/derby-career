'use client'

import { type ReactNode } from 'react'

export function Management({
  title,
  eyebrow,
  description,
  children,
  className = '',
}: {
  title: string
  eyebrow: string
  description: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`lab-management ui-management ui-page flex flex-col gap-5 ${className}`}>
      <div>
        <p className="font-mono text-[10px] tracking-[.22em] text-primary">{eyebrow}</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}
