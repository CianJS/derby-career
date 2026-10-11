'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { RaceRunInput } from '@/lib/career/race-entry'
import { readRaceLog } from '@/lib/career/race-log-repository'
import { frameAt, highlightText, validateRaceLog, type RaceSimulationLog } from '@/lib/career/race-simulation'
import { careerStore, useCareer } from '@/lib/career/store'

const won = (value: number) => `₩${value.toLocaleString('ko-KR')}`

function loadLog(run: RaceRunInput): { log: RaceSimulationLog | null; error: string | null } {
  try {
    const log = readRaceLog(run.raceRunId)
    if (!log) return { log: null, error: '저장된 경주 기록을 찾을 수 없습니다.' }
    validateRaceLog(log, run)
    return { log, error: null }
  } catch (cause) {
    return { log: null, error: cause instanceof Error ? cause.message : '경주 기록을 불러오지 못했습니다.' }
  }
}

export function RaceReflection({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { ready, career, busy, error } = useCareer()
  const run = career?.raceRun
  const loaded = useMemo(() => (run ? loadLog(run) : null), [run])
  const [submitting, setSubmitting] = useState(false)
  if (!ready) return <p role="status" className="py-8 text-sm">경주 결과를 불러오는 중…</p>
  if (!career || !run || !loaded) return <div className="py-8 text-sm"><p role="alert">확정된 경주 결과가 없습니다.</p><Button className="mt-4" variant="outline" onClick={onBack}>육성으로 돌아가기</Button></div>
  if (!loaded.log) return <div className="py-8 text-sm"><p role="alert" className="ui-error-state">{loaded.error}</p><Button className="mt-4" variant="outline" onClick={onBack}>육성으로 돌아가기</Button></div>

  const log = loaded.log
  const race = run.raceDefinitionSnapshot
  const { result } = log
  const horseName = run.player.horseSnapshot.name
  const nameOf = (id: string) => run.runners.find(r => r.horseSnapshot.id === id)?.horseSnapshot.name ?? id
  const history = log.phaseMarkers.map((marker, i, all) => {
    const frame = frameAt(log, marker.tMs)
    const rank = frame.runners.find(r => r.horseId === run.playerHorseId)!.rank
    const previous = i > 0 ? frameAt(log, all[i - 1].tMs).runners.find(r => r.horseId === run.playerHorseId)!.rank : rank
    return { phase: marker.phase, rank, remaining: Math.max(0, race.distance - Math.round(marker.distance)), change: rank !== previous ? `${previous}위 → ${rank}위` : '' }
  })
  const bestRank = Math.min(...history.map(point => point.rank))
  const rankSpan = Math.max(...history.map(point => point.rank)) - bestRank
  const highlights = log.highlights.filter(h => highlightText(h))
  const totalPrize = career.raceRecords.reduce((sum, record) => sum + (record.prizeMoney ?? 0), 0)
  const starts = career.raceRecords.length
  const wins = career.raceRecords.filter(record => record.placing === 1).length
  const winnerTime = log.finishOrder[0]?.finishTime ?? result.finishTime

  const advance = async () => {
    setSubmitting(true)
    try { if (await careerStore.completeRace(run.raceRunId, result)) onNext() } finally { setSubmitting(false) }
  }

  return <div className="mt-5 flex flex-col gap-6">
    <header><p className="ui-label text-primary">RACE RESULT</p><h1 className="ui-page-title mt-2 font-serif">{race.name}</h1><p className="mt-2 text-sm text-muted-foreground">{career.calendarDate.year}년 {career.calendarDate.month}월 · {race.surface} {race.distance}m · {run.runners.length}두</p></header>
    <section aria-label="결과 요약" className="ui-result-summary">
      <div><span className="ui-label text-primary">RESULT</span><p className="mt-2 font-serif text-3xl text-primary">{result.placing}착</p><p className="mt-1 text-sm font-medium">{horseName}</p></div>
      <div><span className="ui-metadata">기록</span><p className="mt-2 text-sm font-medium tabular-nums">{result.finishTime.toFixed(2)}초</p></div>
      <div><span className="ui-metadata">착차</span><p className="mt-2 text-sm font-medium tabular-nums">{result.placing === 1 ? '1착' : `+${result.marginToWinner.toFixed(2)}초`}</p></div>
      <div><span className="ui-metadata">획득 상금</span><p className="mt-2 text-sm font-medium tabular-nums text-primary">{won(result.prizeMoney)}</p></div>
    </section>
    <section aria-label="착순"><h2 className="mb-2 text-sm font-semibold">최종 착순</h2><ol className="flex flex-col">{log.finishOrder.slice().sort((a, b) => a.placing - b.placing).map(record => <li key={record.horseId} className={`flex flex-wrap justify-between gap-2 border-b border-border py-2 text-sm tabular-nums ${record.horseId === run.playerHorseId ? 'font-medium text-primary' : ''}`}><span>{record.placing}착 · {nameOf(record.horseId)}</span><span className="text-xs text-muted-foreground">{record.finishTime.toFixed(2)}초{record.placing > 1 ? ` (+${(record.finishTime - winnerTime).toFixed(2)})` : ''} · {won(record.prizeMoney)}</span></li>)}</ol></section>
    <section aria-label="순위 변화"><h2 className="mb-2 text-sm font-semibold">순위 변화</h2><div className="race-story-trajectory" style={{ '--story-rows': rankSpan } as React.CSSProperties}>{history.map((point, index) => <div key={point.phase} style={{ '--story-x': history.length > 1 ? (index / (history.length - 1)) * 100 : 0, '--story-row': point.rank - bestRank } as React.CSSProperties} className={`race-story-point rank-${point.rank} ${index === history.length - 1 ? 'is-finish' : ''}`}><span className="race-story-phase">{point.phase.replace('_', ' ')}</span><span className="race-story-dot">{point.rank}위</span><span className="race-story-distance">{point.remaining}m</span>{point.change && <small>{point.change}</small>}</div>)}</div></section>
    <section aria-label="경기 복기"><h2 className="mb-2 text-sm font-semibold">경기 복기</h2><div className="race-event-timeline">{highlights.map(h => <div key={h.id} className={`race-event-item event-${h.type.toLowerCase()}`}><span className="race-event-phase">{(h.tMs / 1000).toFixed(1)}s</span><span className="race-event-node" /><p>{highlightText(h)}</p></div>)}</div></section>
    <section aria-label="전적 변화" className="grid gap-x-6 md:grid-cols-2">
      <div className="border-b border-border py-3"><span className="ui-metadata">누적 상금</span><p className="mt-1 text-sm font-medium tabular-nums">{won(totalPrize)} → {won(totalPrize + result.prizeMoney)}</p><span className="text-xs text-primary">+{won(result.prizeMoney)}</span></div>
      <div className="border-b border-border py-3"><span className="ui-metadata">통산 전적</span><p className="mt-1 text-sm font-medium tabular-nums">{starts}전 {wins}승 → {starts + 1}전 {wins + (result.placing === 1 ? 1 : 0)}승</p></div>
    </section>
    {error && <p role="alert" className="ui-error-state">{error}</p>}
    <div><Button disabled={busy || submitting} onClick={() => void advance()}>{submitting ? '저장 중…' : '결과 확정 · 다음 달 시작'}</Button></div>
  </div>
}
