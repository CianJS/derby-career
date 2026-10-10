'use client'

import { Crown, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { actionName, changeText } from '@/lib/career/model'
import { careerStore, useCareer } from '@/lib/career/store'
import { HorseSelection } from './horse-selection'
import { HorseFocus } from './horse-focus'
import { MonthlyDecision } from './monthly-decision'

export function CareerCheckpoint() {
  const { ready, career, busy, error } = useCareer()
  return <div className="min-h-screen bg-background">
    <header className="border-b border-border"><div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-5 md:px-8"><div className="flex items-center gap-3"><Crown className="text-primary" size={22} aria-hidden /><span className="text-sm font-semibold tracking-[.15em]">DERBY CAREER</span><span className="hidden border-l border-border pl-3 text-[10px] tracking-[.15em] text-muted-foreground sm:block">FOCUS PLAY</span></div><span className="text-[10px] tracking-widest text-muted-foreground">CHECKPOINT 01</span></div></header>
    <main className="mx-auto max-w-[1320px] px-5 py-7 md:px-8">
      {error && <div role="alert" className="ui-error-state mb-5"><span>{error}</span><Button variant="outline" disabled={busy} onClick={() => void careerStore.refresh()}>다시 불러오기</Button></div>}
      {!ready ? <p role="status" className="py-16 text-center text-sm text-muted-foreground">육성 기록을 불러오는 중…</p> : !career ? error ? null : <HorseSelection busy={busy} /> : <>
        <div className="mb-5 flex items-end justify-between gap-4"><div><p className="ui-label text-primary">YOUR CAREER · MONTH {career.month}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">이번 달 육성</h1><p className="mt-2 text-xs text-muted-foreground">한 달의 선택이, 한 마리의 가능성을 만듭니다.</p></div><div className="text-right"><p className="text-2xl font-semibold tabular-nums">Month {career.month}</p><p className="mt-1 text-xs text-muted-foreground">{career.action ? '행동 완료' : '행동 선택'}</p></div></div>
        <div className="flex flex-col gap-4"><HorseFocus career={career} /><MonthlyDecision key={`${career.horse.id}:${career.month}`} career={career} busy={busy} />
          <section aria-labelledby="recent-activity" className="rounded-lg border border-border px-5 py-4"><div className="flex items-center gap-3"><h2 id="recent-activity" className="text-sm font-semibold">최근 활동</h2><span className="text-[10px] tracking-widest text-muted-foreground">RECENT ACTIVITY</span></div>{career.recent.length ? <ul className="mt-3 flex flex-col gap-2">{career.recent.map(action => <li key={action.actionId} className="flex flex-wrap gap-x-3 gap-y-1 text-xs"><span className="text-muted-foreground">Month {action.month}</span><span>{actionName(action)}</span><span className="text-sage">{action.result?.map(changeText).join(' / ') || '변경 없음'}</span></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">아직 완료한 월간 기록이 없습니다. 다음 달을 시작하면 이곳에 기록됩니다.</p>}</section>
        </div>
      </>}
      <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><ShieldCheck size={12} aria-hidden />이 브라우저에 저장 · 확정된 결과는 유지됩니다</span><span>월간 훈련 · 휴식 / 경주 기능 제외</span></footer>
    </main>
  </div>
}
