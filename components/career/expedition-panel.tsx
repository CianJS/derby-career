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
import { ExpeditionAvailability } from './expedition-availability'
import { localRacesForTurn } from '@/lib/career/race-entry'

export function ExpeditionPanel({ readOnly = false }: { readOnly?: boolean }) {
  const snapshot = useCareer()
  const travel = stableTravel(snapshot)
  const [target, setTarget] = useState<SupportedCountry>('JPN')
  const [raceId, setRaceId] = useState('')
  const { career, busy, pending, error } = snapshot
  if (!travel) {
    return (
      <p role="status" className="m-4 text-sm">
        원정 정보를 확인하는 중…
      </p>
    )
  }
  const active = travel.activeExpedition
  const allowed = supportedCountry(travel.homeCountry)
  const blocked = busy || pending || !career || !!career.raceRun || !allowed
  const destination =
    target === travel.homeCountry
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
      aria-busy={busy}
      className="m-4 rounded-lg border border-border bg-card p-4 text-sm"
    >
      <h2 className="font-semibold">해외 원정</h2>
      <p className="mt-2" data-travel-location>
        소속 국가 · {countryName(travel.homeCountry)} / 현재 체류 ·{' '}
        {countryName(travel.locationCountry)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {active
          ? `원정 중 · ${countryName(active.targetCountry)} · 대상 경주 ${targetRace?.name ?? active.targetRaceDefinitionId ?? '미선택'}`
          : '국내 체류 중'}
      </p>
      {career && (
        <ExpeditionAvailability
          career={career}
          travel={travel}
          country={active?.targetCountry ?? destination}
          funds={stableFunds(snapshot) ?? undefined}
          serverRaces={
            snapshot.mode === 'server' ? (snapshot.raceOptions?.races ?? null) : undefined
          }
        />
      )}
      {!allowed && (
        <p role="alert" className="mt-2">
          이 마방의 소속 국가는 현재 신규 육성·출전·원정을 지원하지 않습니다. 기존 기록은
          보존됩니다.
        </p>
      )}
      {career?.raceRun && (
        <p className="mt-2">확정한 경주를 완료한 뒤 원정 신청·귀국이 가능합니다.</p>
      )}
      {!readOnly &&
        career &&
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
                    {r.name}
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
        원정은 비용과 월 진행 없이 즉시 시작됩니다.
      </p>
      {busy && (
        <p role="status" className="mt-2 text-xs">
          원정 상태를 확인하고 있습니다…
        </p>
      )}
      {pending && (
        <Button
          variant="outline"
          className="mt-2"
          disabled={busy}
          onClick={() => void careerStore.refresh()}
        >
          같은 요청으로 다시 확인
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-2">
          {error}
        </p>
      )}
    </section>
  )
}
