'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useRaceData } from '@/lib/career/use-race-data'
import { PositionHistory } from '@/components/career/race-position-history'
import { keyMoments } from '@/lib/career/race-feed'
import { postRaceChanges } from '@/lib/career/post-race'
import { frameAt } from '@/lib/career/race-simulation'
import type { Career } from '@/lib/career/model'
import type { RaceData } from '@/lib/career/race-data-adapter'
import { TrustChangeValue } from './jockey-trust'
import { careerStore, useCareer } from '@/lib/career/store'

const won = (value: number) => `₩${value.toLocaleString('ko-KR')}`

export function RaceReflection({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const snapshot = useCareer()
  const { ready, busy, error, mode, pending } = snapshot
  const sourceId = mode === 'server' ? snapshot.workspace?.career?.id : snapshot.localCareerId
  const live = useRaceData()
  const [receipt, setReceipt] = useState<{
    career: Career
    data: RaceData
    mode: typeof mode
    sourceId: typeof sourceId
  } | null>(null)
  const held = receipt?.mode === mode && receipt.sourceId === sourceId ? receipt : null
  const career = held?.career ?? snapshot.career
  const run = career?.raceRun
  const loaded = { ...live, data: held?.data ?? live.data }
  const confirmed = snapshot.career?.raceRecords.find(
    (record) => record.raceRunId === run?.raceRunId,
  )
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  if (!ready) {
    return (
      <p role="status" className="py-8 text-sm">
        경주 결과를 불러오는 중…
      </p>
    )
  }
  if (!career || !run) {
    return (
      <div className="py-8 text-sm">
        <p role="alert">확정된 경주 결과가 없습니다.</p>
        <Button className="mt-4" variant="outline" onClick={onBack}>
          육성으로 돌아가기
        </Button>
      </div>
    )
  }
  if (!loaded.data) {
    return (
      <div className="py-8 text-sm">
        <p
          role={loaded.error ? 'alert' : 'status'}
          className={loaded.error ? 'ui-error-state' : undefined}
        >
          {loaded.error ?? '경주 기록을 불러오는 중…'}
        </p>
        <Button className="mt-4" variant="outline" onClick={loaded.retry}>
          기록 다시 불러오기
        </Button>
        <Button className="mt-4" variant="outline" onClick={onBack}>
          육성으로 돌아가기
        </Button>
      </div>
    )
  }

  const log = loaded.data.log
  const race = run.raceDefinitionSnapshot
  const { result } = log
  const horseName = run.player.horseSnapshot.name
  const nameOf = (id: string) =>
    run.runners.find((r) => r.horseSnapshot.id === id)?.horseSnapshot.name ?? id
  const moments = keyMoments(log, run.playerHorseId)
  const finalFrame = frameAt(log, log.durationMs)
  const names = new Map(run.runners.map((r) => [r.horseSnapshot.id, r.horseSnapshot.name]))
  const markers = log.phaseMarkers
    .filter((marker) => marker.phase === 'FINAL_CORNER' || marker.phase === 'STRETCH')
    .map((marker) => ({
      tMs: marker.tMs,
      label: marker.phase === 'STRETCH' ? 'STRETCH' : 'CORNER',
    }))
  const totalPrize = career.raceRecords.reduce((sum, record) => sum + (record.prizeMoney ?? 0), 0)
  const starts = career.raceRecords.length
  const wins = career.raceRecords.filter((record) => record.placing === 1).length
  const winnerTime = log.finishOrder[0]?.finishTime ?? result.finishTime
  const changes = mode === 'local' ? postRaceChanges(career, run) : []
  const nextMonth = career.calendarDate.month === 12 ? 1 : career.calendarDate.month + 1

  const advance = async () => {
    setSubmitting(true)
    try {
      setReceipt({ career, data: loaded.data!, mode, sourceId })
      if (pending) {
        await careerStore.refresh()
      } else {
        await careerStore.completeRace(run.raceRunId, result)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const timeText = `${Math.floor(result.finishTime / 60)}:${(result.finishTime % 60).toFixed(2).padStart(5, '0')}`
  return (
    <div className="mt-5 flex flex-col gap-5">
      <section aria-label="결과 요약" className="lab-result-hero ui-result-summary">
        <div>
          <span className="ui-label text-primary">{race.name}</span>
          <p className="mt-2 font-serif text-primary">{result.placing}착</p>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {result.placing} / {run.runners.length}
          </p>
          <p className="mt-2 text-sm font-medium">{horseName}</p>
        </div>
        <div>
          <span className="ui-metadata">기록</span>
          <p className="mt-2 text-sm font-medium tabular-nums">{timeText}</p>
        </div>
        <div>
          <span className="ui-metadata">착차</span>
          <p className="mt-2 text-sm font-medium tabular-nums">
            {result.placing === 1 ? '1착' : `1착과 ${result.marginToWinner.toFixed(2)}초`}
          </p>
        </div>
        <div>
          <span className="ui-metadata">획득 상금</span>
          <p className="mt-2 text-sm font-medium tabular-nums text-primary">
            {won(result.prizeMoney)}
          </p>
        </div>
      </section>
      {mode === 'local' && (
        <section aria-label="전적 변화" className="grid gap-x-6 md:grid-cols-2">
          <div className="border-b border-border py-2">
            <span className="ui-metadata">누적 상금</span>
            <p className="mt-1 text-sm font-medium tabular-nums">
              {won(totalPrize)} → {won(totalPrize + result.prizeMoney)}
            </p>
          </div>
          <div className="border-b border-border py-2">
            <span className="ui-metadata">통산 전적</span>
            <p className="mt-1 text-sm font-medium tabular-nums">
              {starts}전 {wins}승 → {starts + 1}전 {wins + (result.placing === 1 ? 1 : 0)}승
            </p>
          </div>
        </section>
      )}
      <section aria-label="순위 변화">
        <PositionHistory
          log={log}
          frame={finalFrame}
          playerHorseId={run.playerHorseId}
          names={names}
          markers={markers}
        />
      </section>
      <section aria-label="핵심 장면">
        <h2 className="mb-2 text-sm font-semibold">핵심 장면</h2>
        <ul className="flex flex-col">
          {moments.map((moment) => (
            <li
              key={moment.id}
              className="flex gap-4 border-b border-border py-2 text-sm last:border-b-0"
            >
              <span className="w-28 shrink-0 font-mono text-[0.6rem] tracking-[0.12em] text-muted-foreground">
                {moment.label}
              </span>
              <span>{moment.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="경주 후 상태">
        <h2 className="mb-2 text-sm font-semibold">경주 후 상태</h2>
        <ul className="grid gap-x-6 md:grid-cols-2">
          {changes.map((change) => (
            <li
              key={change.label}
              className="flex items-baseline justify-between border-b border-border py-2 text-sm"
            >
              <span className="ui-metadata">{change.label}</span>
              <span className="font-medium tabular-nums">
                {change.before} → {change.after}
                {change.delta && (
                  <span className="ml-2 text-xs text-muted-foreground">({change.delta})</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          {run.player.jockeySnapshot.name} · <TrustChangeValue change={confirmed?.trustChange} />
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {confirmed
            ? '결과가 저장되었습니다. 신뢰도는 다음 출전부터 적용됩니다.'
            : mode === 'server'
              ? '결과를 확정하면 서버에 저장된 상금·전적·건강과 다음 달 상태를 불러옵니다.'
              : `결과를 확정하면 ${nextMonth}월로 넘어가며 출전 기록이 경주 기록에 추가됩니다.`}
        </p>
      </section>
      <details className="border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
          전체 착순 {run.runners.length}두
        </summary>
        <ol className="flex flex-col px-3 pb-2">
          {log.finishOrder
            .slice()
            .sort((a, b) => a.placing - b.placing)
            .map((record) => (
              <li
                key={record.horseId}
                className={`flex flex-wrap justify-between gap-2 border-b border-border py-1.5 text-xs tabular-nums last:border-b-0 ${record.horseId === run.playerHorseId ? 'font-medium text-primary' : ''}`}
              >
                <span>
                  {record.placing}착 · {nameOf(record.horseId)}
                </span>
                <span className="text-muted-foreground">
                  {record.finishTime.toFixed(2)}초
                  {record.placing > 1 ? ` (+${(record.finishTime - winnerTime).toFixed(2)})` : ''}
                </span>
              </li>
            ))}
        </ol>
      </details>
      {error && (
        <p role="alert" className="ui-error-state">
          {error}
        </p>
      )}
      <div>
        <Button
          disabled={busy || submitting}
          onClick={() => (confirmed ? onNext() : void advance())}
        >
          {submitting
            ? '저장 중…'
            : confirmed
              ? '다음 달 육성으로'
              : pending
                ? '완료 요청 다시 확인'
                : '결과 확정 · 다음 달 시작'}
        </Button>
      </div>
    </div>
  )
}
