'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { labels, statKeys, type Career } from '@/lib/career/model'
import {
  contractedRoster,
  distanceAptitude,
  entryRestriction,
  grade,
  raceEligibility,
  racesForTurn,
  ridingFit,
  tactics,
  type RaceEntryDraft,
} from '@/lib/career/race-entry'
import { careerStore, useCareer } from '@/lib/career/store'
import {
  jockeyTrust,
  raceEntryJockeyTrust,
  type JockeyTrust,
} from '@/lib/career/jockey-trust-presentation'
import { JockeyTrustValue } from './jockey-trust'
import { recommendRaceEntry, updateRaceEntryDraft } from '@/lib/career/race-entry-recommendation'
import { cn } from '@/lib/utils'
import type { components } from '@/packages/shared/src/generated/api'

export function RaceAction({ onOpen }: { onOpen: () => void }) {
  const { career, busy, pending, mode, raceOptions } = useCareer()
  if (!career) {
    return null
  }
  const restriction =
    mode === 'server'
      ? (raceOptions?.restrictionReason ?? (!raceOptions ? '출전 정보를 불러오는 중…' : null))
      : entryRestriction(career)
  const open =
    mode === 'server'
      ? (raceOptions?.races.filter((row) => row.eligible).length ?? 0)
      : racesForTurn(career.careerTurnIndex).filter((r) => !raceEligibility(career, r)).length
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {career.raceRun
          ? '저장된 출전 정보를 확인할 수 있습니다.'
          : (restriction ?? `현재 전적으로 출전 가능한 경주 ${open}개`)}
      </p>
      <Button
        disabled={busy || pending || (mode === 'local' && !career.raceRun && !!restriction)}
        onClick={onOpen}
      >
        {career.raceRun ? '출전 정보 확인' : '경주 출전 준비'}
      </Button>
    </div>
  )
}

export function RaceEntryWorkspace({ onStartRace }: { onStartRace?: () => void }) {
  const snapshot = useCareer()
  const { ready, career, busy, pending, error, mode, localCareerId, workspace, raceOptions } =
    snapshot
  if (!ready) {
    return (
      <p role="status" className="py-8 text-sm">
        출전 정보를 불러오는 중…
      </p>
    )
  }
  if (!career) {
    return (
      <p role="alert" className="py-8 text-sm">
        {error ?? '먼저 육성마를 선택해 주세요.'}
      </p>
    )
  }
  if (mode === 'server' && !raceOptions) {
    return (
      <p role="status" className="py-8 text-sm">
        {error ?? '서버 출전 정보를 불러오는 중…'}
      </p>
    )
  }
  return (
    <RaceEntryForm
      key={`${mode}:${workspace?.career?.id ?? localCareerId ?? career.horse.id}:${career.month}`}
      career={career}
      busy={busy || pending}
      error={error}
      onStartRace={onStartRace}
      canConfirm={mode === 'local' || !!raceOptions}
      serverOptions={mode === 'server' ? raceOptions : undefined}
      trustForJockey={(id) => jockeyTrust(snapshot, id)}
    />
  )
}

export function RaceEntryForm({
  career,
  busy,
  error,
  onStartRace,
  canConfirm = true,
  serverOptions,
  trustForJockey = (id) => raceEntryJockeyTrust(serverOptions, id),
}: {
  career: Career
  busy: boolean
  error: string | null
  onStartRace?: () => void
  serverOptions?: components['schemas']['RaceEntryOptions'] | null
  trustForJockey?: (jockeyId: string) => JockeyTrust
  canConfirm?: boolean
}) {
  const [draft, setDraft] = useState<RaceEntryDraft>(() =>
    recommendRaceEntry(career, undefined, serverOptions ?? undefined),
  )
  const availableJockeys =
    serverOptions === undefined ? contractedRoster(career) : (serverOptions?.jockeys ?? [])
  const turnRaces =
    serverOptions === undefined
      ? racesForTurn(career.careerTurnIndex)
      : (serverOptions?.races.map((row) => row.definition) ?? [])
  const locked = career.raceRun
  const race = locked?.raceDefinitionSnapshot ?? turnRaces.find((r) => r.id === draft.raceId)
  const jockey =
    locked?.player.jockeySnapshot ?? availableJockeys.find((j) => j.id === draft.jockeyId)
  const tactic = locked?.player.tactic ?? draft.tactic
  const horse = locked?.player.horseSnapshot
  const values = horse?.values ?? career.values
  const aptitude = horse?.aptitude ?? career.horse.aptitude
  const restriction =
    serverOptions === undefined
      ? entryRestriction(career)
      : (serverOptions?.restrictionReason ?? (!serverOptions ? '출전 정보를 불러오는 중…' : null))
  const warnings = [
    values.fatigue >= 40 ? '피로가 높습니다.' : '',
    values.bodyLoad >= 40 ? '신체 부하가 높습니다.' : '',
    tactic && ['C', 'D'].includes(grade(aptitude, tactic)) ? '선택 전술 적성이 낮습니다.' : '',
    race && ['C', 'D'].includes(grade(aptitude, distanceAptitude(race.distance)))
      ? '선택 거리 적성이 낮습니다.'
      : '',
  ].filter(Boolean)
  const update = (patch: Partial<RaceEntryDraft>) => {
    if (!locked && !busy) {
      setDraft((current) =>
        updateRaceEntryDraft(career, current, patch, serverOptions ?? undefined),
      )
    }
  }
  const rowClass = (selected: boolean) =>
    cn(
      'flex cursor-pointer flex-wrap items-center gap-3 rounded-md border px-3 py-3 text-left focus-within:ring-2 focus-within:ring-ring',
      selected ? 'ui-selected border-primary/50' : 'border-border hover:bg-accent/40',
    )
  return (
    <div className="lab-entry mt-5 flex flex-col gap-5">
      <header>
        <p className="ui-label text-primary">RACE ENTRY · 육성 {career.careerTurnIndex}개월차</p>
        <h1 className="ui-page-title mt-2 font-serif">
          {locked ? '출전이 확정되었습니다.' : '경주 출전'}
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {locked
            ? '출전 정보가 저장되었습니다. 이번 달의 선택은 변경할 수 없습니다.'
            : '경주·기수·전술을 비교하고 선택하세요. 확정 전에는 자유롭게 변경할 수 있습니다.'}
        </p>
      </header>
      <section
        aria-label="현재 육성마"
        className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-border py-3 text-xs tabular-nums"
      >
        <div>
          <h2 className="font-serif text-lg">{horse?.name ?? career.horse.name}</h2>
          <p className="text-muted-foreground">{horse?.age ?? career.age}세</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {statKeys.map((key) => (
            <span key={key}>
              {labels[key]} <b>{values[key]}</b>
            </span>
          ))}
        </div>
        <p>
          피로 {values.fatigue} · 신체 부하 {values.bodyLoad} · 컨디션{' '}
          {horse?.condition ?? career.condition}
        </p>
        <p className="w-full text-muted-foreground">
          {aptitude
            .filter(([name]) => name !== '잔디')
            .map(([name, g]) => `${name} ${g}`)
            .join(' · ')}
        </p>
      </section>
      {error && (
        <p role="alert" className="ui-error-state">
          {error}
        </p>
      )}
      {!locked && restriction && (
        <p role="alert" className="text-sm text-muted-foreground">
          {restriction}
        </p>
      )}
      <fieldset disabled={!!locked || busy || !!restriction} className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">이번 달 출전 가능한 경주</legend>
        {turnRaces.map((r) => {
          const reason = locked
            ? null
            : serverOptions === undefined
              ? raceEligibility(career, r)
              : (serverOptions?.races.find((row) => row.definition.id === r.id)
                  ?.restrictionReason ?? null)
          return (
            <label
              key={r.id}
              aria-disabled={
                !!reason ||
                (serverOptions !== undefined &&
                  !serverOptions?.races.find((row) => row.definition.id === r.id)?.eligible)
              }
              className={cn(
                rowClass(r.id === race?.id),
                reason && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              )}
            >
              <input
                type="radio"
                name="entry-race"
                value={r.id}
                className="accent-primary"
                disabled={
                  !!reason ||
                  (serverOptions !== undefined &&
                    !serverOptions?.races.find((row) => row.definition.id === r.id)?.eligible)
                }
                checked={r.id === race?.id}
                onChange={() => update({ raceId: r.id })}
              />
              <span className="min-w-36 flex-1 font-serif">{r.name}</span>
              <span className="min-w-44 text-xs tabular-nums">
                {r.surface} {r.distance}m · {r.raceClass} · {r.runners}두
              </span>
              <span className="min-w-44 text-xs text-muted-foreground">{r.courseProfile}</span>
              <span className="text-xs tabular-nums">
                1착 ₩{r.prize.toLocaleString('ko-KR')} · 등록비 ₩
                {r.entryFee.toLocaleString('ko-KR')}
              </span>
              {reason && (
                <span className="w-full text-[11px] leading-5 text-muted-foreground">
                  출전 불가 · {reason}
                </span>
              )}
            </label>
          )
        })}
      </fieldset>
      <fieldset disabled={!!locked || busy || !!restriction}>
        <legend className="mb-2 text-sm font-semibold">계약 기수</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {availableJockeys.map((j) => {
            const fit = ridingFit(career, race, j, tactic)
            return (
              <label key={j.id} className={cn(rowClass(j.id === jockey?.id), 'items-start')}>
                <span className="flex w-full items-center gap-2">
                  <input
                    type="radio"
                    name="entry-jockey"
                    value={j.id}
                    className="accent-primary"
                    checked={j.id === jockey?.id}
                    onChange={() => update({ jockeyId: j.id })}
                  />
                  <span className="font-serif text-base">{j.name}</span>
                  <span className="ml-auto text-[11px] text-sage">계약 중</span>
                </span>
                <span className="text-xs text-muted-foreground">{j.style}</span>
                <span className="grid w-full grid-cols-2 gap-x-5 gap-y-2 text-xs tabular-nums">
                  {(['start', 'pace', 'path', 'timing', 'stability'] as const).map((key) => (
                    <span key={key} className="flex justify-between border-b border-border pb-1">
                      <span className="capitalize text-muted-foreground">{key}</span>
                      <b>{j[key]}</b>
                    </span>
                  ))}
                </span>
                <span className="w-full text-xs">
                  {career.horse.name}와 신뢰도 · <JockeyTrustValue trust={trustForJockey(j.id)} />
                </span>
                <span className="text-xs text-primary">기승 적합도 · {fit.label}</span>
                <span className="text-[11px] leading-5 text-muted-foreground">
                  {fit.explanation}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <fieldset disabled={!!locked || busy || !!restriction}>
        <legend className="mb-2 text-sm font-semibold">전술 · 현재 말의 적성</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(serverOptions === undefined ? tactics : (serverOptions?.tactics ?? [])).map((t) => (
            <label key={t} className={rowClass(t === tactic)}>
              <input
                type="radio"
                name="entry-tactic"
                value={t}
                className="accent-primary"
                checked={t === tactic}
                onChange={() => update({ tactic: t })}
              />
              <span className="text-sm">{t}</span>
              <b className="ml-auto text-sm text-primary">{grade(aptitude, t)}</b>
            </label>
          ))}
        </div>
      </fieldset>
      <section
        aria-label="출전 요약"
        aria-live="polite"
        className="flex flex-col gap-4 border-t border-border pt-4"
      >
        <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Horse', horse?.name ?? career.horse.name],
            ['Race', race ? `${race.name} · ${race.surface} ${race.distance}m` : '선택 전'],
            ['Jockey', jockey?.name ?? '선택 전'],
            ['Tactic', tactic ? `${tactic} ${grade(aptitude, tactic)}` : '선택 전'],
            ['Warning', warnings.join(' ') || '없음'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-2 leading-5">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground">신뢰도</dt>
            <dd className="mt-2 leading-5">
              {jockey ? <JockeyTrustValue trust={trustForJockey(jockey.id)} /> : '선택 전'}
            </dd>
          </div>
        </dl>
        <div className="flex justify-end">
          {locked ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-xs text-primary">
                출전 정보 저장 완료 · 선택 잠김
              </p>
              {onStartRace && (
                <Button disabled={busy} onClick={onStartRace}>
                  레이스 시작
                </Button>
              )}
            </div>
          ) : (
            <Button
              disabled={
                !canConfirm ||
                busy ||
                !!restriction ||
                !race ||
                !jockey ||
                !tactic ||
                (serverOptions !== undefined &&
                  (!serverOptions?.races.find((row) => row.definition.id === race?.id)?.eligible ||
                    !serverOptions?.tactics.includes(tactic)))
              }
              onClick={() => void careerStore.lockRace(draft, career.horse.id, career.month)}
            >
              {busy ? '저장 중…' : '출전 확정'}
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
