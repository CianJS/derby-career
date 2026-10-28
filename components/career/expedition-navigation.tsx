'use client'

import type { ReactNode } from 'react'

export function focusExpedition() {
  const section = document.getElementById('career-expedition')
  if (!section) {
    return
  }
  const disclosure = section.closest('details')
  if (disclosure) {
    disclosure.open = true
  }
  section.focus({ preventScroll: true })
  section.scrollIntoView({ block: 'start' })
}

export function ExpeditionLink({ children }: { children: ReactNode }) {
  return (
    <a
      className="mt-1 inline-block text-xs font-semibold text-primary underline"
      href="#career-expedition"
      onClick={(event) => {
        event.preventDefault()
        focusExpedition()
      }}
    >
      {children}
    </a>
  )
}
