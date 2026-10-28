'use client'

import { useEffect, useRef, useState } from 'react'
import { careerStore, useCareer, stableTravel } from '@/lib/career/store'
import { careerProgress } from '@/packages/shared/src/domain'
import { countryName } from '@/lib/career/local-travel'
import type { GameplayView } from '@/lib/race-catalog/model'
import type { View } from './legacy-types'
import { Management } from './management'
import { Section } from './presentation'
import { GameRaceSource } from './game-race-source'
import { SeasonSummary } from './career-progress'
import { HealthGuidance } from './health-guidance'
import { entryBrowseContext, gameRaceSchedule, type GameRaceRow } from './game-race-schedule'

export function readRaceBrowser(search: string) {
  const params = new URLSearchParams(search)
  const requested = params.get('raceCatalog')
  return {
    reference:
      requested === 'reference' ||
      (requested !== 'game' &&
        (params.has('raceId') || [...params.keys()].some((key) => key.startsWith('rc_')))),
    gameId: params.get('gameRaceId'),
    country: params.get('gr_country') ?? '',
    search: params.get('gr_search') ?? '',
    readyOnly: params.get('gr_ready') === '1',
  }
}
export function useRaceBrowser() {
  const [location, setLocation] = useState<ReturnType<typeof readRaceBrowser> | null>(null)
  useEffect(() => {
    const restore = () => setLocation(readRaceBrowser(window.location.search))
    restore()
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  return location
}
export function changeRaceBrowser(patch: Record<string, string | null>, detail = false) {
  const url = new URL(window.location.href)
  url.searchParams.set('view', detail ? 'race' : 'races')
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') {
      url.searchParams.delete(key)
    } else {
      url.searchParams.set(key, value)
    }
  }
  history.pushState(
    { ...history.state, catalogGameplayView: null, catalogGameplayFocus: false },
    '',
    url,
  )
  window.dispatchEvent(new PopStateEvent('popstate'))
}
export function RaceBrowserTabs({ reference }: { reference: boolean }) {
  return (
    <nav
      aria-label="경주 자료 선택"
      className="mx-auto flex max-w-[1440px] flex-wrap gap-2 px-4 pt-4 md:px-8"
    >
      {[
        ['game', '게임 경주 일정'],
        ['reference', '공식 참고 자료'],
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={reference === (id === 'reference')}
          className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          onClick={() => changeRaceBrowser({ raceCatalog: id, gameRaceId: null, raceId: null })}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
function ScheduleFacts({
  row,
  server,
  known,
  careerTurn,
}: {
  row: GameRaceRow
  server: boolean
  known: boolean
  careerTurn?: number
}) {
  const r = row.definition
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
      {[
        ['개최국', countryName(r.countryCode ?? 'KOR')],
        [
          '노면 · 거리',
          `${r.surface === 'Turf' ? '잔디' : r.surface} · ${r.distance.toLocaleString('ko-KR')}m`,
        ],
        ['적격 등급', r.raceClass],
        ['출전 두수', `${r.runners}두`],
        [
          '게임 등록비',
          row.moneyKnown ? `₩${r.entryFee.toLocaleString('ko-KR')}` : '서버 해당 월 조회 전 미확인',
        ],
        [
          '게임 1착 상금',
          row.moneyKnown ? `₩${r.prize.toLocaleString('ko-KR')}` : '서버 해당 월 조회 전 미확인',
        ],
        [
          '개최 월 · 육성 시즌',
          row.turn
            ? `${careerProgress(row.turn).seasonIndex}년 차 · ${careerProgress(row.turn).seasonTurn}/12개월 · ${row.turn}턴`
            : `시즌 ${r.month}/12개월 · 육성 기록 확인 필요`,
        ],
        [
          '현재 개최 상태',
          !known
            ? '출전 상태 미확인'
            : row.current
              ? '이번 달 출전 후보'
              : server && row.turn === careerTurn
                ? '이번 달 서버 후보 미제공'
                : server
                  ? '예정 정의 · 서버 해당 월 재확인'
                  : '예정 게임 경주',
        ],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
export function GameRaceBrowser({
  detail,
  mode,
  onGameplay,
}: {
  detail: boolean
  mode?: 'local' | 'server'
  onGameplay: (view: GameplayView, raceId?: string) => void
  setView?: (view: View) => void
}) {
  const snapshot = useCareer()
  const location = useRaceBrowser()
  const currentCareer = snapshot.mode === (mode ?? snapshot.mode) ? snapshot.career : null
  const schedule = gameRaceSchedule(snapshot, mode ?? snapshot.mode)
  const context = entryBrowseContext(snapshot, mode ?? snapshot.mode)
  const [notice, setNotice] = useState<{ context: string; text: string } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const selected = location?.gameId
    ? schedule.rows.find((row) => row.definition.id === location.gameId)
    : null
  const travel = snapshot.mode === mode || mode === undefined ? stableTravel(snapshot) : null
  useEffect(() => {
    if (detail) {
      heading.current?.focus()
    }
  }, [detail, location?.gameId])
  const prepare = () => {
    const fresh = careerStore.getSnapshot()
    const row = gameRaceSchedule(fresh, mode ?? fresh.mode).rows.find(
      (row) => row.definition.id === selected?.definition.id,
    )
    if (entryBrowseContext(fresh, mode ?? fresh.mode) !== context || !row?.canPrepare) {
      setNotice({
        context,
        text: '출전 조건이 변경되었습니다. 최신 육성 상태에서 경주를 다시 선택하세요.',
      })
      return
    }
    onGameplay('entry', row.definition.id)
  }
  const filtered = schedule.rows.filter(
    (row) =>
      (!location?.country || (row.definition.countryCode ?? 'KOR') === location.country) &&
      (!location?.search || row.definition.name.includes(location.search)) &&
      (!location?.readyOnly || row.canPrepare),
  )
  return (
    <Management
      title={detail ? (selected?.definition.name ?? '게임 경주 상세') : '게임 경주 일정'}
      eyebrow="GAME RACES"
      description="실제 게임 출전 정의와 현재 말의 조건을 확인합니다. 공식 참고 자료의 원본 일정·상금과 구분됩니다."
    >
      <p role="status" className="rounded-lg border border-border p-3 text-sm">
        기본 게임 정의 {schedule.definitionCount}개 · 이번 달 출전 후보{' '}
        {schedule.currentCount ?? '미확인'}개 · 현재 말로 준비 가능{' '}
        {schedule.readyCount ?? '미확인'}개
        {currentCareer && (
          <span className="mt-1 block">
            {currentCareer.horse.name} · {currentCareer.calendarDate.year}년{' '}
            {currentCareer.calendarDate.month}월 · 육성 {currentCareer.careerTurnIndex}턴 ·{' '}
            <SeasonSummary progress={careerProgress(currentCareer.careerTurnIndex)} />
          </span>
        )}
        {travel && (
          <span className="mt-1 block">
            현재 체류 · {countryName(travel.locationCountry)} ·{' '}
            {travel.activeExpedition ? '원정 중' : '소속국 체류 중'}
          </span>
        )}
      </p>
      {schedule.message && (
        <div role={snapshot.error ? 'alert' : 'status'} className="text-sm">
          <p>{schedule.message}</p>
          <button
            className="mt-2 min-h-11 underline"
            disabled={snapshot.busy}
            onClick={() => void careerStore.refresh()}
          >
            출전 정보 다시 확인
          </button>
          {!currentCareer && (
            <button className="ml-4 min-h-11 underline" onClick={() => onGameplay('home')}>
              육성마 선택하러 가기
            </button>
          )}
        </div>
      )}
      {detail ? (
        <>
          <button
            className="min-h-11 self-start text-sm text-primary underline"
            onClick={() => changeRaceBrowser({ gameRaceId: null, raceCatalog: 'game' })}
          >
            ← 게임 경주 일정으로
          </button>
          {!selected ? (
            <p role="alert">
              선택한 게임 경주를 현재 정의에서 찾을 수 없습니다. 목록에서 다시 선택하세요.
            </p>
          ) : (
            <>
              <Section eyebrow="GAME DEFINITION" title="게임 출전 경주">
                <h2 ref={heading} tabIndex={-1} className="mb-4 text-lg font-semibold">
                  {selected.definition.name} <GameRaceSource raceId={selected.definition.id} />
                </h2>
                <ScheduleFacts
                  row={selected}
                  server={(mode ?? snapshot.mode) === 'server'}
                  known={schedule.known}
                  careerTurn={currentCareer?.careerTurnIndex}
                />
                <p className="mt-4 text-sm">코스 특성 · {selected.definition.courseProfile}</p>
                <p className="mt-2 text-sm">
                  승수 조건 ·{' '}
                  {selected.definition.minWins === undefined &&
                  selected.definition.maxWins === undefined
                    ? '별도 승수 제한 없음'
                    : `${selected.definition.minWins ?? 0}승 이상${selected.definition.maxWins === undefined ? '' : ` · ${selected.definition.maxWins}승 이하`}`}
                </p>
                <p className="mt-2 text-sm">현재 말의 출전 조건 · {selected.reason}</p>
                {currentCareer && <HealthGuidance career={currentCareer} />}
                <p className="mt-3 text-xs text-muted-foreground">
                  Game Definition ID · {selected.definition.id} / 공식 Source ID · 연결 정보 없음
                </p>
              </Section>
              <button
                className="min-h-11 self-start rounded-lg bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-50"
                disabled={!selected.canPrepare}
                onClick={prepare}
              >
                현재 말로 출전 준비
              </button>
              {notice?.context === context && <p role="alert">{notice.text}</p>}
              <button
                className="min-h-11 self-start text-sm text-primary underline"
                onClick={() => onGameplay('training')}
              >
                육성·원정 상태 확인
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label>
              개최국{' '}
              <select
                aria-label="게임 경주 개최국"
                className="ml-2 min-h-11 rounded border border-border bg-card px-3"
                value={location?.country ?? ''}
                onChange={(e) => changeRaceBrowser({ gr_country: e.target.value })}
              >
                <option value="">전체</option>
                {['KOR', 'JPN', 'USA'].map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              경주명{' '}
              <input
                aria-label="게임 경주명 검색"
                type="search"
                className="ml-2 min-h-11 max-w-full rounded border border-border bg-card px-3"
                value={location?.search ?? ''}
                maxLength={120}
                onChange={(e) => changeRaceBrowser({ gr_search: e.target.value })}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={location?.readyOnly ?? false}
                onChange={(e) => changeRaceBrowser({ gr_ready: e.target.checked ? '1' : null })}
              />
              이번 달 출전 준비 가능만
            </label>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2" aria-label="게임 경주 목록">
            {filtered.map((row) => (
              <li
                key={row.definition.id}
                className="min-w-0 rounded-lg border border-border bg-card p-4"
                data-game-race={row.definition.id}
              >
                <button
                  className="min-h-11 text-left text-lg font-semibold text-primary underline"
                  onClick={() => {
                    changeRaceBrowser({ gameRaceId: row.definition.id, raceCatalog: 'game' }, true)
                    window.scrollTo(0, 0)
                  }}
                >
                  {row.definition.name} 상세 보기
                </button>
                <p className="my-2 text-sm">
                  {countryName(row.definition.countryCode ?? 'KOR')} · 잔디{' '}
                  {row.definition.distance}m · {row.definition.raceClass}{' '}
                  <GameRaceSource raceId={row.definition.id} />
                </p>
                <p className="text-sm">
                  {row.turn
                    ? `${row.turn}턴 · ${careerProgress(row.turn).seasonIndex}년 차 · ${careerProgress(row.turn).seasonTurn}/12개월`
                    : `개최 시즌 ${row.definition.month}/12개월`}
                </p>
                <p className="mt-2 text-sm font-semibold">{row.reason}</p>
                <p className="mt-2 text-xs tabular-nums">
                  {row.moneyKnown
                    ? `등록비 ₩${row.definition.entryFee.toLocaleString('ko-KR')} · 게임 1착 상금 ₩${row.definition.prize.toLocaleString('ko-KR')}`
                    : '게임 등록비·상금 · 서버 해당 월 조회 전 미확인'}
                </p>
              </li>
            ))}
          </ul>
          {!filtered.length && (
            <p>
              조회 조건에 맞는 게임 경주가 없습니다.
              {!schedule.known && ' 현재 출전 정보는 미확인 상태입니다.'}
            </p>
          )}
        </>
      )}
    </Management>
  )
}
