'use client'

import { useState } from 'react'
import { ArrowRight, Brain, Check, Dumbbell, Flame, HeartPulse, LockKeyhole, Moon, Wind, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { actionName, labels, statKeys, trainings, type Career, type Choice } from '@/lib/career/model'
import { careerStore } from '@/lib/career/store'
import { cn } from '@/lib/utils'

const icons = { speed: Zap, stamina: Wind, power: Dumbbell, guts: Flame, intelligence: Brain }
export function MonthlyDecision({ career, busy }: { career: Career; busy: boolean }) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const locked = !!career.action
  const result = career.action?.result
  const training = choice && choice !== 'rest' ? trainings[choice] : null
  return <section aria-labelledby="monthly-decision" className="rounded-lg border border-border bg-card px-5 py-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><p className="ui-label text-primary">MONTHLY DECISION</p><h2 id="monthly-decision" className="mt-2 text-lg font-semibold">{locked ? '이번 달의 육성 결과' : '이번 달, 무엇에 집중할까요?'}</h2></div><span className="flex items-center gap-1.5 text-xs text-muted-foreground">{locked ? <LockKeyhole size={13} aria-hidden /> : null}{locked ? '행동 확정 · 결과 잠김' : '한 달에 핵심 행동 1회'}</span></div>
    {!locked ? <>
      <fieldset disabled={busy}><legend className="sr-only">월간 행동 선택</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{statKeys.map(type => { const item = trainings[type]; const Icon = icons[type]; return <label key={type} className={cn('flex cursor-pointer flex-col gap-3 rounded-md border p-3 focus-within:ring-2 focus-within:ring-ring', choice === type ? 'ui-selected' : 'border-border hover:bg-accent/50')}><input className="sr-only" type="radio" name="monthly-action" value={type} checked={choice === type} onChange={() => setChoice(type)} /><div className="flex items-center gap-2"><Icon size={16} className="text-primary" aria-hidden /><span className="text-sm font-medium">{item.name}</span></div><span className="text-xs">{item.preview}</span><span className="flex flex-col gap-1 text-[11px] text-muted-foreground"><span>피로 증가 · {item.fatigueLabel}</span><span>신체 부하 증가 · {item.loadLabel}</span></span></label> })}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 focus-within:ring-2 focus-within:ring-ring', choice === 'rest' ? 'ui-selected' : 'border-border hover:bg-accent/50')}><input className="sr-only" type="radio" name="monthly-action" value="rest" checked={choice === 'rest'} onChange={() => setChoice('rest')} /><Moon size={16} className="text-sage" aria-hidden /><span className="text-sm font-medium">휴식</span><span className="ml-auto text-xs text-muted-foreground">피로 크게 회복 · 신체 부하 회복</span></label><button type="button" disabled className="flex items-center gap-3 rounded-md border border-border px-3 py-3 text-left"><HeartPulse size={16} aria-hidden /><span className="text-sm">치료</span><span className="ml-auto text-xs text-muted-foreground">치료할 부상이 없습니다</span><LockKeyhole size={12} aria-hidden /></button></div>
      </fieldset>
      <div className="mt-4 flex min-h-20 flex-wrap items-center justify-between gap-4 border-t border-border pt-4" aria-live="polite">
        {choice ? <><div><p className="text-sm font-medium">{training?.name ?? '휴식'} <span className="ml-2 text-xs font-normal text-primary">선택 미리보기</span></p><p className="mt-1.5 text-xs text-muted-foreground">{training ? `${training.preview} · 피로 증가: ${training.fatigueLabel} · 신체 부하 증가: ${training.loadLabel}` : '피로 크게 회복 · 신체 부하 회복'}</p><p className="mt-1 text-[11px] text-muted-foreground">확정 전에는 자유롭게 변경할 수 있습니다.</p></div><Button size="lg" disabled={busy} onClick={() => void careerStore.commit(choice, career.month)}>{busy ? '저장 중…' : choice === 'rest' ? '이 휴식 확정' : '이 훈련 확정'}<Check data-icon="inline-end" aria-hidden /></Button></> : <p className="text-xs text-muted-foreground">훈련 또는 휴식을 선택해 예상 변화를 확인하세요. 선택만으로는 행동이 소비되지 않습니다.</p>}
      </div>
    </> : <div aria-live="polite"><div className="mb-3 flex items-center gap-2 text-sm text-primary"><Check size={16} aria-hidden /><span>Month {career.month} · {actionName(career.action!)}</span></div>
      {result !== null && result !== undefined ? <><div className="grid gap-x-8 sm:grid-cols-2">{result.map(change => { const delta = change.after - change.before; return <div key={change.key} className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm tabular-nums"><span className="text-muted-foreground">{labels[change.key]}</span><span className="flex items-center gap-3"><span className="text-muted-foreground">{change.before}</span><ArrowRight size={12} aria-label="에서" /><b>{change.after}</b><b className={cn('min-w-10 text-right', delta < 0 || !['fatigue', 'bodyLoad'].includes(change.key) ? 'text-sage' : 'text-primary')}>{delta > 0 ? '+' : ''}{delta}</b></span></div> })}</div>{result.length === 0 && <p className="py-4 text-sm text-muted-foreground">피로와 신체 부하가 이미 0입니다. 변경된 수치가 없습니다.</p>}<div className="mt-5 flex flex-wrap items-center justify-between gap-4"><p className="text-xs text-muted-foreground">결과가 저장되었습니다. 다음 달에 새로운 행동을 선택할 수 있습니다.</p><Button size="lg" disabled={busy} onClick={() => void careerStore.next(career.action!.actionId)}>다음 달 시작<ArrowRight data-icon="inline-end" aria-hidden /></Button></div></> : <p className="py-5 text-sm text-muted-foreground">행동은 확정되었습니다. 저장된 결과를 불러오고 있습니다.</p>}
    </div>}
  </section>
}
