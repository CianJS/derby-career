'use client'

import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { BALANCE } from '@/lib/career/balance'
import { labels, statKeys, statusLabels, trainings, type ActionRecord, type Change, type Stat } from '@/lib/career/model'
import { INJURY_NOTICE } from '@/lib/career/status'
import { cn } from '@/lib/utils'

const COUNT_MS = 900
const isStat = (key: Change['key']): key is Stat => (statKeys as readonly string[]).includes(key)
const gaugeMax = (change: Change) => (isStat(change.key) ? BALANCE.maxStat : Math.max(100, change.before, change.after))

function useCountUp(change: Change, animate: boolean) {
  const [value, setValue] = useState(animate ? change.before : change.after)
  useEffect(() => {
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches || change.before === change.after) {
      setValue(change.after)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_MS)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(change.before + (change.after - change.before) * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [animate, change.before, change.after])
  return value
}

function ChangeRow({ change, role, kind, animate }: { change: Change; role?: 'main' | 'sub'; kind: ActionRecord['actionType']; animate: boolean }) {
  const value = useCountUp(change, animate)
  const delta = change.after - change.before
  const max = gaugeMax(change)
  const burden = change.key === 'fatigue' || change.key === 'bodyLoad'
  const tone = burden ? (delta > 0 ? 'is-load' : 'is-recovery') : 'is-growth'
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / max) * 100))}%`
  return <div className={cn('result-row', role === 'main' && 'is-main', animate && delta !== 0 && 'is-animated')} data-kind={kind}>
    <div className="flex items-center justify-between gap-3 text-sm tabular-nums">
      <span className="flex items-center gap-2 text-muted-foreground">{labels[change.key]}{role && <span className={cn('lab-chip', role === 'main' && 'is-main')}>{role === 'main' ? '주성장' : '보조'}</span>}</span>
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground">{change.before}</span><ArrowRight size={12} aria-label="에서" />
        <b className="min-w-9 text-right" aria-label={`변경 후 ${change.after}`}>{value}</b>
        <b className={cn('result-delta min-w-12 text-right', burden ? (delta > 0 ? 'text-rose' : 'text-sage') : 'text-sage')}>{delta > 0 ? '+' : ''}{delta}</b>
      </span>
    </div>
    <div className="result-gauge" role="img" aria-label={`${labels[change.key]} ${change.before}에서 ${change.after}`}>
      <span className="result-gauge-before" style={{ width: pct(Math.min(change.before, change.after)) }} />
      <span className={cn('result-gauge-fill', tone)} style={{ width: pct(value) }} />
    </div>
  </div>
}

export function ActionResult({ action, animate }: { action: ActionRecord; animate: boolean }) {
  const result = action.result ?? []
  const training = action.trainingType ? trainings[action.trainingType] : null
  const roleOf = (key: Change['key']) => (action.trainingType === key ? 'main' : training?.secondary === key ? 'sub' : undefined)
  const rows = [...result].sort((a, b) => Number(isStat(b.key)) - Number(isStat(a.key)))
  const injured = action.statusChanges?.some(c => c.key === 'health' && c.after !== '정상')
  return <>
    <div className={cn('result-panel grid gap-x-8 sm:grid-cols-2', action.actionType === 'training' ? 'is-growth' : 'is-recovery')}>
      {rows.map(change => <ChangeRow key={change.key} change={change} role={roleOf(change.key)} kind={action.actionType} animate={animate} />)}
      {(action.statusChanges ?? []).map(change => <div key={change.key} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm"><span className="text-muted-foreground">{statusLabels[change.key]}</span><span className="flex items-center gap-3"><span className="text-muted-foreground">{change.before}</span><ArrowRight size={12} aria-label="에서" /><b className={change.key === 'health' && change.after !== '정상' ? 'text-rose' : 'text-sage'}>{change.after}</b></span></div>)}
    </div>
    {result.length === 0 && !action.statusChanges?.length && <p className="py-3 text-sm text-muted-foreground">피로와 신체 부하가 이미 0입니다. 변경된 수치가 없습니다.</p>}
    {injured && <p role="status" className={cn('lab-warn mt-3 px-3 py-2 text-xs text-muted-foreground', animate && 'result-injury')}><b className="font-semibold text-rose">훈련 중 부상이 발생했습니다.</b> {INJURY_NOTICE}</p>}
  </>
}
