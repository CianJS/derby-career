'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { careerStore, stableTravel, stableFunds, useCareer } from '@/lib/career/store'
import {
  countryName,
  supportedCountries,
  supportedCountry,
  type SupportedCountry,
} from '@/lib/career/local-travel'
import { GameRaceSource, gameRaceOption } from './game-race-source'
import { ExpeditionAvailability } from './expedition-availability'
import { localRacesForTurn } from '@/lib/career/race-entry'

export function expeditionControls(
  snapshot: ReturnType<typeof useCareer>,
  mode = snapshot.mode,
  loading = false,
  saveError: string | null = null,
) {
  const known =
    !loading &&
    snapshot.mode === mode &&
    snapshot.ready &&
    (mode !== 'server' || !!snapshot.workspace)
  const travel = known ? stableTravel(snapshot) : null
  const career = known ? snapshot.career : null
  const error = saveError ?? (snapshot.mode === mode ? snapshot.error : null)
  const reason = error
    ? mode === 'local' && !saveError
      ? '이전 요청을 완료하지 못했습니다. 저장된 상태를 확인하고 다시 시도해 주세요.'
      : '저장·연결 상태를 다시 확인한 뒤 원정·귀국해 주세요.'
    : !known
      ? '원정 정보를 확인하는 중…'
      : snapshot.busy
        ? '원정 상태를 확인하고 있습니다…'
        : snapshot.pending
          ? '저장 결과 확인이 필요합니다. 같은 요청으로 다시 확인해 주세요.'
          : !career
            ? '육성마를 선택한 뒤 원정을 관리할 수 있습니다.'
            : !travel
              ? '저장된 원정 정보를 확인할 수 없습니다.'
              : !supportedCountry(travel.homeCountry)
                ? '이 마방의 소속 국가는 현재 신규 육성·출전·원정을 지원하지 않습니다. 기존 기록은 보존됩니다.'
                : career.raceRun
                  ? '확정한 경주를 완료한 뒤 원정 신청·귀국이 가능합니다.'
                  : mode === 'server' && !snapshot.raceOptions
                    ? '서버 출전 정보를 확인한 뒤 원정·귀국해 주세요.'
                    : null
  const blocked =
    !known ||
    snapshot.busy ||
    snapshot.pending ||
    !career ||
    !travel ||
    !supportedCountry(travel.homeCountry) ||
    !!career.raceRun ||
    !!saveError ||
    (mode === 'server' && (!!error || !snapshot.raceOptions))
  return { travel, career, error, reason, blocked, known, canManage: known && !!career }
}

export function ExpeditionPanel({
  readOnly = false,
  mode,
  loading = false,
  saveError = null,
  onManage,
}: {
  readOnly?: boolean
  mode?: 'local' | 'server'
  loading?: boolean
  saveError?: string | null
  onManage?: () => void
}) {
  const snapshot = useCareer()
  const { travel, career, error, reason, blocked, known, canManage } = expeditionControls(
    snapshot,
    mode,
    loading,
    saveError,
  )
  const [target, setTarget] = useState<SupportedCountry>('JPN')
  const [raceId, setRaceId] = useState('')
  const { busy, pending } = snapshot
  const active = travel?.activeExpedition
  const destination =
    target === travel?.homeCountry
      ? supportedCountries.find((c) => c !== travel.homeCountry)!
      : target
  const races =
    snapshot.mode === 'server'
      ? (snapshot.raceOptions?.races.map((r) => r.definition) ?? [])
      : localRacesForTurn(career?.careerTurnIndex ?? 0)
  const candidates = races.filter((r) => r.countryCode === destination)
  const selectedRace = candidates.some((r) => r.id === raceId) ? raceId : ''
  const targetRace = races.find((r) => r.id === active?.targetRaceDefinitionId)
  return (
    <section
      id="career-expedition"
      aria-label="해외 원정"
      tabIndex={-1}
      aria-busy={busy}
      className="m-4 scroll-mt-20 rounded-lg border border-border bg-card p-4 text-sm"
    >
      <h2 className="font-semibold">해외 원정</h2>
      {travel && (
        <>
          <p className="mt-2" data-travel-location>
            소속 국가 · {countryName(travel.homeCountry)} / 현재 체류 ·{' '}
            {countryName(travel.locationCountry)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {active
              ? `원정 중 · ${countryName(active.targetCountry)}${active.targetRaceDefinitionId ? ` · 대상 경주 ${targetRace?.name ?? active.targetRaceDefinitionId}` : ''}`
              : '소속국 체류 중'}
            {active?.targetRaceDefinitionId && (
              <GameRaceSource raceId={active.targetRaceDefinitionId} />
            )}
          </p>
        </>
      )}
      {reason && (
        <p role={error ? 'alert' : 'status'} className="mt-2">
          {reason}
        </p>
      )}
      {readOnly && (
        <Button
          className="mt-3"
          variant="outline"
          disabled={!onManage || !canManage}
          onClick={onManage}
        >
          원정 관리 · 육성 화면에서 원정·귀국
        </Button>
      )}
      {!readOnly &&
        career &&
        travel &&
        (active ? (
          <Button
            className="mt-3"
            disabled={blocked}
            onClick={() => void careerStore.returnExpedition(active.id, travel.revision)}
          >
            귀국
          </Button>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label>
              원정 국가
              <select
                aria-label="원정 국가"
                className="mt-1 block min-h-11 rounded border border-border bg-background px-3"
                disabled={blocked}
                value={destination}
                onChange={(e) => {
                  setTarget(e.target.value as SupportedCountry)
                  setRaceId('')
                }}
              >
                {supportedCountries
                  .filter((c) => c !== travel.homeCountry)
                  .map((c) => (
                    <option key={c} value={c}>
                      {countryName(c)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="min-w-0">
              원정 경주
              <select
                aria-label="원정 경주"
                className="mt-1 block min-h-11 max-w-full rounded border border-border bg-background px-3"
                disabled={blocked}
                value={selectedRace}
                onChange={(e) => setRaceId(e.target.value)}
              >
                <option value="">현지에서 선택</option>
                {candidates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {gameRaceOption(r)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={blocked}
              onClick={() =>
                void careerStore.startExpedition(
                  destination,
                  travel.revision,
                  selectedRace || undefined,
                )
              }
            >
              원정 신청
            </Button>
          </div>
        ))}
      <p className="mt-2 text-xs text-muted-foreground">
        원정·귀국은 비용과 월 진행 없이 즉시 진행됩니다.
      </p>
      {(mode === undefined || snapshot.mode === mode) &&
        (pending ||
          error ||
          (known && (!travel || (snapshot.mode === 'server' && !snapshot.raceOptions)))) && (
          <Button
            variant="outline"
            className="mt-2"
            disabled={busy}
            onClick={() => void careerStore.refresh()}
          >
            {pending ? '같은 요청으로 다시 확인' : '원정 상태 다시 확인'}
          </Button>
        )}
      {error && (
        <p role="alert" className="mt-2">
          {error}
        </p>
      )}
      {career && travel && (
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold">일정·출전 자격 안내</summary>
          <ExpeditionAvailability
            career={career}
            travel={travel}
            country={active?.targetCountry ?? destination}
            funds={stableFunds(snapshot) ?? undefined}
            serverRaces={
              snapshot.mode === 'server' ? (snapshot.raceOptions?.races ?? null) : undefined
            }
          />
        </details>
      )}
    </section>
  )
}
