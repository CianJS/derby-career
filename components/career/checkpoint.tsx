'use client'

import type { ReactNode } from 'react'
import { actionName, changeText } from '@/lib/career/model'
import { careerStore, useCareer } from '@/lib/career/store'
import { HorseSelection } from './horse-selection'
import { HorseFocus } from './horse-focus'
import { MonthlyDecision } from './monthly-decision'

export function CareerCheckpoint({ onHome, onHorse, raceEntry, horseSummary }: { onHome: () => void; onHorse: () => void; raceEntry: ReactNode; horseSummary?: ReactNode }) {
  const { ready, career, busy, error } = useCareer()
  const recent = career ? [...(career.action?.result ? [career.action] : []), ...career.recent].slice(0, 3) : []
  return <div className="training-workspace pb-4"><div className="mx-auto max-w-[1380px] px-4 py-7 md:px-8">
    <button onClick={onHome} className="mb-5 text-xs text-muted-foreground">← 홈</button>
    {error && <div role="alert" className="ui-error-state mb-5"><span>{error}</span><button disabled={busy} onClick={() => void careerStore.refresh()} className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs">다시 불러오기</button></div>}
    {!ready ? <p role="status" className="py-16 text-center text-sm text-muted-foreground">육성 기록을 불러오는 중…</p> : !career ? error ? null : <HorseSelection busy={busy} /> : <>
      <div className="mb-6 flex items-end justify-between gap-4"><div><p className="ui-label text-primary">FOCUS PLAY · MONTHLY DECISION</p><h1 className="mt-2 font-serif text-3xl font-semibold">이번 달 육성</h1><p className="mt-2 text-sm text-muted-foreground">Month {career.month} · {career.action || career.raceRun ? '이번 달 행동 완료' : '행동 하나를 선택하세요'}</p></div><button onClick={onHorse} className="text-xs text-primary">현재 육성마 상세</button></div>
      <div className="flex flex-col gap-4">
        {horseSummary ?? <HorseFocus career={career} />}
        <MonthlyDecision key={`${career.horse.id}:${career.month}`} career={career} busy={busy} raceEntry={raceEntry} />
        <section aria-labelledby="recent-activity" className="ui-section border border-border bg-card"><p className="ui-label text-primary">RECENT ACTIVITY</p><h2 id="recent-activity" className="mt-1 font-serif text-xl font-semibold">최근 활동</h2>{recent.length ? <ul className="mt-3 grid gap-3 md:grid-cols-3">{recent.map(action => <li key={action.actionId} className="border-b border-border pb-2 text-xs"><p className="text-muted-foreground">Month {action.month}</p><p className="mt-1 text-sm">{actionName(action)}</p><p className="mt-2 leading-5 text-sage">{action.result?.map(changeText).join(' / ') || '변경 없음'}</p></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">아직 완료한 월간 기록이 없습니다.</p>}</section>
      </div>
    </>}
  </div></div>
}
