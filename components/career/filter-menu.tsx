'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FilterMenu({ label, value, options, onChange, align = 'left' }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])

  const active = value !== options[0]
  return <div ref={root} className="relative">
    <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(v => !v)} className={cn('flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'border-primary text-primary' : 'border-border')}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
      <ChevronDown size={13} aria-hidden className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
    </button>
    {open && <ul id={listId} role="listbox" aria-label={label} className={cn('absolute z-20 mt-1 min-w-full overflow-hidden rounded-lg border border-border bg-popover py-1 text-xs text-popover-foreground shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>
      {options.map(option => <li key={option} role="option" aria-selected={option === value}>
        <button type="button" onClick={() => { onChange(option); setOpen(false) }} className={cn('flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 py-1.5 text-left hover:bg-accent', option === value && 'text-primary')}>
          {option}{option === value && <Check size={12} aria-hidden />}
        </button>
      </li>)}
    </ul>}
  </div>
}
