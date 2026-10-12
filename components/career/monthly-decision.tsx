'use client'

import { useState, type ReactNode } from 'react'
import { isRaceTurn, raceEligibility, racesForTurn } from '@/lib/career/race-entry'
import { ArrowLeft, ArrowRight, Brain, Check, Dumbbell, Flag, Flame, HeartPulse, LockKeyhole, Moon, Wind, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionResult } from '@/components/career/action-result'
import { BALANCE } from '@/lib/career/balance'
import { actionName, labels, statKeys, statusLabels, trainings, type Career, type Stat } from '@/lib/career/model'
import { careerStore } from '@/lib/career/store'
import { INJURY_NOTICE, STRAIN_WARNING, injuryRiskPercent, isHealthy, isStrained } from '@/lib/career/status'
import { cn } from '@/lib/utils'

const icons = { speed: Zap, stamina: Wind, power: Dumbbell, guts: Flame, intelligence: Brain }
type Panel = 'training' | 'rest' | 'treatment' | 'race'

export function MonthlyDecision({ career, busy, raceEntry }: { career: Career; busy: boolean; raceEntry?: ReactNode }) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [committedMonth, setCommittedMonth] = useState<number | null>(null)
  const injured = !isHealthy(career.health)
  const strained = !injured && isStrained(career.values.fatigue, career.values.bodyLoad)
  const riskPercent = injuryRiskPercent(career.values)
  const locked = !!(career.action || career.raceRun)
  const result = career.action?.result
  const raceTurn = isRaceTurn(career.careerTurnIndex)
  const raceHint = career.raceRun ? '출전 확정됨' : raceTurn ? (injured ? '부상으로 출전 불가' : '이번 달 출전 기회') : '이번 달 출전 기회 없음'
  const tabs: { id: Panel; name: string; Icon: typeof Zap; hint: string; disabled?: boolean }[] = [
    { id: 'training', name: '훈련', Icon: Dumbbell, hint: injured ? '부상 중에는 훈련할 수 없습니다' : '능력치 1종을 성장시킵니다', disabled: injured },
    { id: 'rest', name: '휴식', Icon: Moon, hint: '피로와 신체 부하를 회복합니다' },
    { id: 'treatment', name: '치료', Icon: HeartPulse, hint: injured ? `건강 · ${career.health} 회복` : '치료할 부상이 없습니다', disabled: !injured },
    { id: 'race', name: '경주', Icon: Flag, hint: raceHint },
  ]
  const title = panel ? tabs.find(tab => tab.id === panel)!.name : locked ? '이번 달의 육성 결과' : '이번 달, 무엇에 집중할까요?'
  const commit = (choice: Stat | 'rest' | 'treatment') => { setCommittedMonth(career.month); void careerStore.commit(choice, career.month) }
  const back = <button type="button" onClick={() => setPanel(null)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowLeft size={13} aria-hidden />행동 선택으로</button>
  return <section aria-labelledby="monthly-decision" className="lab-monthly px-4 py-3.5 md:px-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-3">{panel && !locked && back}<h2 id="monthly-decision" className="text-base font-bold">{title}</h2></div><span className="flex items-center gap-1.5 text-xs text-muted-foreground">{locked ? <LockKeyhole size={13} aria-hidden /> : null}{locked ? '행동 확정 · 결과 잠김' : '한 달에 핵심 행동 1회'}</span></div>
    {career.raceRun ? <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-primary">출전이 확정되었습니다.</p><p className="mt-1 text-xs text-muted-foreground">{career.raceRun.raceDefinitionSnapshot.name} · {career.raceRun.player.jockeySnapshot.name} · {career.raceRun.player.tactic}</p><p className="mt-1 text-xs">이번 달의 다른 행동은 선택할 수 없습니다.</p></div><div className="min-w-60 flex-1 md:max-w-sm">{raceEntry}</div></div> : !locked ? <>
      {!panel && <div role="group" aria-label="월간 행동 선택" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{tabs.map(({ id, name, Icon, hint, disabled }) => <button key={id} type="button" disabled={disabled || busy} onClick={() => setPanel(id)} className="lab-action-tab"><span className="flex items-center gap-2 text-sm font-bold"><Icon size={16} className="text-primary" aria-hidden />{name}</span><span className="text-xs leading-5 text-muted-foreground">{hint}</span></button>)}</div>}
      {panel === 'training' && <div className="flex flex-col gap-3">
        {strained && <div role="status" className="lab-warn px-3 py-2 text-xs"><b className="font-semibold">피로가 높습니다.</b> <span className="text-muted-foreground">{STRAIN_WARNING.replace('피로가 높습니다. ', '')}{riskPercent > 0 && ` 현재 부상 위험 ${riskPercent}%`}</span></div>}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{statKeys.map(type => { const item = trainings[type]; const Icon = icons[type]; return <article key={type} className="lab-train-card"><div className="flex items-center gap-2"><Icon size={16} className="text-primary" aria-hidden /><h3 className="text-sm font-bold">{item.name}</h3></div><div className="flex flex-wrap gap-1"><span className="lab-chip is-main">주 {labels[type]}</span>{item.secondary && <span className="lab-chip">보조 {labels[item.secondary]}</span>}</div><p className="text-xs">{item.preview}</p><p className="text-[11px] leading-5 text-muted-foreground">피로 +{item.fatigue} · {item.fatigueLabel}<br />신체 부하 +{item.bodyLoad} · {item.loadLabel}</p><Button size="sm" className="mt-auto" disabled={busy} onClick={() => commit(type)}>{busy ? '저장 중…' : `${item.name} 실행`}</Button></article> })}</div>
      </div>}
      {panel === 'rest' && <div className="flex flex-wrap items-center justify-between gap-4"><dl className="grid flex-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2"><div className="flex items-center justify-between border-b border-border py-2"><dt className="text-muted-foreground">피로</dt><dd className="tabular-nums">{career.values.fatigue} → <b>{Math.max(0, career.values.fatigue + BALANCE.rest.fatigue)}</b></dd></div><div className="flex items-center justify-between border-b border-border py-2"><dt className="text-muted-foreground">신체 부하</dt><dd className="tabular-nums">{career.values.bodyLoad} → <b>{Math.max(0, career.values.bodyLoad + BALANCE.rest.bodyLoad)}</b></dd></div></dl><div className="flex items-center gap-4"><p className="max-w-60 text-xs text-muted-foreground">이번 달 행동으로 확정되며 능력치는 변하지 않습니다.</p><Button disabled={busy} onClick={() => commit('rest')}>{busy ? '저장 중…' : '휴식 실행'}<Check data-icon="inline-end" aria-hidden /></Button></div></div>}
      {panel === 'treatment' && <div className="flex flex-wrap items-center justify-between gap-4"><dl className="grid flex-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2"><div className="flex items-center justify-between border-b border-border py-2"><dt className="text-muted-foreground">건강</dt><dd>{career.health} → <b className="text-sage">{BALANCE.treatment.healthAfter}</b></dd></div><div className="flex items-center justify-between border-b border-border py-2"><dt className="text-muted-foreground">신체 부하</dt><dd className="tabular-nums">{career.values.bodyLoad} → <b>{Math.max(0, career.values.bodyLoad + BALANCE.treatment.bodyLoad)}</b></dd></div></dl><div className="flex items-center gap-4"><p className="max-w-64 text-xs text-muted-foreground">이번 달 행동으로 확정되며, 회복되면 다음 달부터 훈련과 경주가 다시 열립니다.</p><Button disabled={busy} onClick={() => commit('treatment')}>{busy ? '저장 중…' : '치료 실행'}<Check data-icon="inline-end" aria-hidden /></Button></div></div>}
      {panel === 'race' && <div className="flex flex-col gap-3">
        {raceTurn ? <ul className="grid gap-2 md:grid-cols-3">{racesForTurn(career.careerTurnIndex).map(r => { const reason = raceEligibility(career, r); return <li key={r.id} className={cn('lab-train-card text-xs', reason && 'opacity-70')}><p className="text-sm font-bold">{r.name}</p><p>{r.surface} {r.distance}m · {r.raceClass} · {r.runners}두</p><p className="text-muted-foreground">{r.courseProfile}</p><p className="tabular-nums">1착 ₩{r.prize.toLocaleString('ko-KR')} · 등록비 ₩{r.entryFee.toLocaleString('ko-KR')}</p>{reason && <p className="text-[11px] leading-5 text-muted-foreground">출전 불가 · {reason}</p>}</li> })}</ul> : <p className="text-sm text-muted-foreground">이번 달은 출전할 수 있는 경주가 없습니다.</p>}
        {injured ? <p className="lab-warn px-3 py-2 text-xs text-muted-foreground">경주 출전 제한 · 부상 중에는 이번 달 경주에 출전할 수 없습니다. 회복 후 다시 출전 기회가 열립니다.</p> : raceTurn ? raceEntry : null}
        {isRaceTurn(career.careerTurnIndex + 1) && <aside aria-label="다음 달 주요 출전 기회" className="border-t border-border pt-3"><h3 className="text-xs font-bold">다음 달 주요 출전 기회</h3><div className="mt-2 grid gap-3 md:grid-cols-3">{racesForTurn(career.careerTurnIndex + 1).map(r => <div key={r.id} className="text-[11px] leading-5 text-muted-foreground"><p className="text-sm font-semibold text-foreground">{r.name}</p><p>{r.surface} {r.distance}m · {r.raceClass} · {r.runners}두</p><p>등록비 ₩{r.entryFee.toLocaleString('ko-KR')} · 1착 상금 ₩{r.prize.toLocaleString('ko-KR')}</p></div>)}</div></aside>}
      </div>}
      {!panel && injured && <p role="status" className="lab-warn mt-3 px-3 py-2 text-xs"><b className="font-semibold">건강 · {career.health}</b> <span className="text-muted-foreground">{INJURY_NOTICE}</span></p>}
      {!panel && strained && <p role="status" className="lab-warn mt-3 px-3 py-2 text-xs"><b className="font-semibold">피로가 높습니다.</b> <span className="text-muted-foreground">{STRAIN_WARNING.replace('피로가 높습니다. ', '')}</span></p>}
    </> : <div aria-live="polite"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><Check size={16} aria-hidden /><span>Month {career.month} · {actionName(career.action!)}</span></div>
      {result !== null && result !== undefined ? <><ActionResult action={career.action!} animate={committedMonth === career.month} /><div className="mt-3 flex flex-wrap items-center justify-between gap-4"><p className="text-xs text-muted-foreground">결과가 저장되었습니다. 다음 달에 새로운 행동을 선택할 수 있습니다.</p><Button size="lg" disabled={busy} onClick={() => void careerStore.next(career.action!.actionId)}>다음 달 시작<ArrowRight data-icon="inline-end" aria-hidden /></Button></div></> : <p className="py-4 text-sm text-muted-foreground">행동은 확정되었습니다. 저장된 결과를 불러오고 있습니다.</p>}
    </div>}
  </section>
}
