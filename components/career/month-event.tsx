'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { labels, type ActionRecord, type Career } from '@/lib/career/model'
import { defaultEventCatalog } from '@/lib/career/events/repository'
import { choiceText, effectText } from '@/lib/career/events/text'
import { eventKindLabels, type EventDefinition } from '@/lib/career/events/types'
import { careerStore } from '@/lib/career/store'

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`

/** The definition behind the month's event, or null while it is closed, unknown, or already used up. */
export function visibleMonthEvent(career: Career): { definition: EventDefinition; event: NonNullable<Career['event']> } | null {
  const event = career.event
  if (!event || event.status === 'expired') return null
  const definition = defaultEventCatalog.find(event.eventId)
  return definition ? { definition, event } : null
}

export function MonthEventCard({ career, busy }: { career: Career; busy: boolean }) {
  const shown = visibleMonthEvent(career)
  if (!shown) return null
  const { definition, event } = shown
  const pickable = !!definition.choices && event.status === 'offered'
  const chosen = definition.choices?.find(option => option.id === event.choice)
  return <aside aria-label="이번 달 이벤트" className="lab-warn flex flex-col gap-2 px-3 py-3 text-xs">
    <div className="flex flex-wrap items-center gap-2"><Sparkles size={14} className="text-primary" aria-hidden /><b className="text-sm">{definition.name}</b><span className="lab-chip">{eventKindLabels[definition.kind]}</span>{definition.limitedToMonth && <span className="text-[11px] text-muted-foreground">이번 달 한정</span>}</div>
    <p className="leading-5 text-muted-foreground">{definition.description}</p>
    {pickable ? <div role="group" aria-label={`${definition.name} 선택`} className="grid gap-2 sm:grid-cols-2">{definition.choices!.map(option => <div key={option.id} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2"><p><b>{option.id}.</b> {choiceText(option)}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void careerStore.chooseEvent(event.eventId, option.id, career.month)}>{option.id} 선택</Button></div>)}</div>
      : chosen ? <p>선택한 항목 · <b>{chosen.id}.</b> {choiceText(chosen)}{event.immediate && ` (즉시 피로 ${signed(event.immediate.fatigue)} · 신체 부하 ${signed(event.immediate.bodyLoad)})`}</p>
      : <ul className="flex flex-col gap-0.5">{definition.effects.map((effect, index) => <li key={index}>{effectText(effect)}</li>)}</ul>}
    {definition.choices && event.status === 'offered' && <p className="text-[11px] text-muted-foreground">선택하지 않고 행동을 확정하면 이벤트는 사라집니다.</p>}
  </aside>
}

/** What the event actually changed in a resolved action, read from the saved record. */
export function AppliedEventNote({ action }: { action: ActionRecord }) {
  const applied = action.event
  if (!applied) return null
  const definition = defaultEventCatalog.find(applied.eventId)
  const parts = [
    applied.growth !== 0 && action.trainingType ? `${labels[action.trainingType]} ${signed(applied.growth)}` : '',
    applied.fatigue !== 0 ? `피로 ${signed(applied.fatigue)}` : '',
    applied.bodyLoad !== 0 ? `신체 부하 ${signed(applied.bodyLoad)}` : '',
  ].filter(Boolean)
  return <p role="status" className="lab-warn mt-3 flex flex-wrap items-center gap-2 px-3 py-2 text-xs"><Sparkles size={14} className="text-primary" aria-hidden /><b className="font-semibold">{definition?.name ?? '이벤트'}</b><span className="text-muted-foreground">{parts.length ? `이벤트 효과 · ${parts.join(' · ')}` : '이벤트가 적용되었지만 수치 변화는 없습니다.'}</span></p>
}
