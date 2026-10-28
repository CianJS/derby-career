'use client'

import { useCareer, stableFunds } from '@/lib/career/store'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { View, CareerHorse } from './legacy-types'
import { Section } from './presentation'
import { Management } from './management'
import { applyCareer } from '@/lib/career/lifecycle'
import { serverLifecycle } from '@/lib/server-save/lifecycle'
import { careerProgress } from '@/lib/career/career-time'
import { SeasonSummary } from './career-progress'

/** Read the current save authority, never an old lifecycle summary on its own. */
export function stableActiveState(
  snapshot: ReturnType<typeof useCareer>,
  mode: 'local' | 'server' | null,
  localHorse: CareerHorse | null = null,
  loading = false,
  saveError: string | null = null,
) {
  const unknown = { career: null, horse: null }
  if (!mode || snapshot.mode !== mode) {
    return { ...unknown, status: 'loading', message: '저장 모드를 확인하고 있습니다.' }
  }
  if (saveError || snapshot.error) {
    return {
      ...unknown,
      status: 'error',
      message: `현역마 정보를 확인하지 못했습니다. ${saveError ?? snapshot.error}`,
    }
  }
  if (loading || !snapshot.ready || (mode === 'server' && !snapshot.workspace)) {
    return { ...unknown, status: 'loading', message: '현재 육성마 정보를 불러오는 중…' }
  }
  if (snapshot.busy || snapshot.pending) {
    return {
      ...unknown,
      status: 'pending',
      message: snapshot.pending
        ? '저장 요청의 결과를 확인하고 있습니다. 기존 저장 상태·재시도 안내를 확인해 주세요.'
        : '저장 상태를 갱신하고 있습니다.',
    }
  }
  const career = mode === 'server' ? (snapshot.workspace?.career?.state ?? null) : snapshot.career
  const horse = career
    ? mode === 'server'
      ? serverLifecycle(snapshot.workspace!).activeHorse
      : applyCareer({ activeHorse: localHorse, month: career.calendarDate.month }, career)
          .activeHorse
    : null
  return {
    career,
    horse,
    status: career && horse ? 'active' : 'empty',
    message: '현재 육성 중인 경주마가 없습니다. 홈에서 새 육성을 시작할 수 있습니다.',
  }
}

export function StableActiveHorse({
  active,
  setView,
  onActiveSelect,
}: {
  active: ReturnType<typeof stableActiveState>
  setView: (v: View) => void
  onActiveSelect: () => void
}) {
  const { horse, career } = active
  return (
    <section
      aria-labelledby="stable-current-horse"
      aria-busy={active.status === 'loading' || active.status === 'pending'}
      className="stable-active-summary rounded-lg border border-border bg-card p-3"
    >
      <h2 id="stable-current-horse" className="text-base font-bold">
        현재 육성마
      </h2>
      {horse && career ? (
        <>
          <button
            type="button"
            onClick={onActiveSelect}
            aria-label={`현역마 ${horse.name || '이름 미확인'} 상세 보기`}
            className="mt-3 break-words text-left font-serif text-xl text-primary underline-offset-4 hover:underline"
          >
            {horse.name || '이름 미확인'}
          </button>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['나이', Number.isFinite(career.age) ? `${career.age}세` : '미확인'],
              ['통산 전적', horse.record || '미확인'],
              ['누적 상금', horse.prize || '미확인'],
              ['상태', `${career.health || '미확인'} · ${career.condition || '미확인'}`],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs tabular-nums">
            {career.careerTurnIndex}턴 ·{' '}
            <SeasonSummary progress={careerProgress(career.careerTurnIndex)} showAge={false} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {career.raceRun
              ? '경주 출전 확정 · 기존 육성 화면에서 확인하세요.'
              : career.action
                ? '이번 달 행동 확정 · 기존 육성 화면에서 결과를 확인하세요.'
                : '육성 중'}
          </p>
          <button
            type="button"
            onClick={() => setView('training')}
            className="mt-4 min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-primary"
          >
            육성 계속
          </button>
        </>
      ) : (
        <p
          role={active.status === 'error' ? 'alert' : 'status'}
          className="mt-3 text-sm text-muted-foreground"
        >
          {active.message}
        </p>
      )}
    </section>
  )
}

export function Stable({
  setView,
  archive = [],
  onArchiveSelect = () => {},
  onActiveSelect = () => setView('horse'),
  mode,
  activeHorse = null,
  loading = false,
  saveError = null,
}: {
  setView: (v: View) => void
  archive?: CareerHorse[]
  onArchiveSelect?: (id: string) => void
  onActiveSelect?: () => void
  mode?: 'local' | 'server'
  activeHorse?: CareerHorse | null
  loading?: boolean
  saveError?: string | null
}) {
  const snapshot = useCareer()
  const funds = mode && mode !== snapshot.mode ? null : stableFunds(snapshot)
  const archiveKnown =
    snapshot.ready &&
    !loading &&
    (!mode || mode === snapshot.mode) &&
    (snapshot.mode === 'server' ? !!snapshot.workspace : !!snapshot.lifecycle)
  const active = stableActiveState(snapshot, mode ?? snapshot.mode, activeHorse, loading, saveError)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  // Both save modes provide newest retirements first; keep that order for ties as well.
  const filtered = archive
    .filter((horse) =>
      horse.name.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR')),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'ko')
        : sort === 'wins'
          ? Number(b.record.match(/(\d+)승/)?.[1] ?? 0) -
            Number(a.record.match(/(\d+)승/)?.[1] ?? 0)
          : sort === 'prize'
            ? Number(b.prize.replace(/[^\d]/g, '')) - Number(a.prize.replace(/[^\d]/g, ''))
            : 0,
    )
  const select = (id: string) => {
    onArchiveSelect(id)
    setView('horseArchive')
  }
  return (
    <Management
      title="마구간"
      eyebrow="STABLE"
      description="육성을 완료한 경주마의 기록을 검색하고 비교합니다."
      className="stable-records"
    >
      <StableActiveHorse active={active} setView={setView} onActiveSelect={onActiveSelect} />
      <section aria-label="마방 자금 현황" className="border-y border-border py-4 text-sm">
        <span className="text-muted-foreground">마방 자금</span>
        <p className="mt-2 font-medium tabular-nums">
          {funds === null
            ? '자금 정보를 확인하지 못했습니다.'
            : `₩${funds.toLocaleString('ko-KR')}`}
        </p>
        {snapshot.error && (
          <p role="alert" className="mt-2 text-sm">
            {snapshot.error}
          </p>
        )}
      </section>
      {!archiveKnown && (
        <p role="status" className="py-4 text-sm text-muted-foreground">
          은퇴 기록을 확인하고 있습니다.
        </p>
      )}
      {archiveKnown && archive.length === 0 && (
        <div className="ui-empty-state border-y border-border/70 py-8">
          <p>아직 기록된 은퇴 경주마가 없습니다.</p>
          <p className="mt-1 text-sm">육성을 완료한 경주마의 커리어가 이곳에 보존됩니다.</p>
        </div>
      )}
      {archive.length > 1 && (
        <Section eyebrow="CAREER ARCHIVE · RECENT" title="최근 은퇴마">
          <div className="space-y-2">
            {archive.slice(0, 2).map((horse) => (
              <button
                key={horse.id}
                onClick={() => select(horse.id)}
                data-archive-id={horse.id}
                className="flex w-full items-center justify-between border-b border-border py-3 text-left"
              >
                <span>
                  <b className="font-serif">{horse.name}</b>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {horse.retiredAt} · {horse.record}
                  </span>
                </span>
                <span className="text-xs text-primary">
                  기록 보기 <ChevronRight className="inline" size={14} />
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="flex min-w-64 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span>검색</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="말 이름 검색"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          정렬
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="recent">최근 은퇴순</option>
            <option value="name">이름순</option>
            <option value="wins">통산 승수순</option>
            <option value="prize">누적 상금순</option>
          </select>
        </label>
      </div>
      <Section eyebrow="CAREER ARCHIVE" title="은퇴 경주마">
        <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_1fr_100px_24px] gap-4 border-b border-border px-4 pb-3 text-[10px] tracking-wide text-muted-foreground md:grid">
          <span>이름</span>
          <span>나이·성별</span>
          <span>통산 전적</span>
          <span>최고 성적</span>
          <span>누적 상금</span>
          <span>은퇴 시점</span>
          <span />
        </div>
        {archive.length > 0 && filtered.length === 0 && (
          <p role="status" className="py-6 text-sm text-muted-foreground">
            이름이 일치하는 은퇴 기록이 없습니다.
          </p>
        )}
        {filtered.map((horse) => (
          <button
            key={horse.id}
            data-archive-id={horse.id}
            onClick={() => select(horse.id)}
            className="group grid w-full gap-2 border-b border-border px-4 py-4 text-left last:border-0 hover:bg-accent/40 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_100px_24px] md:items-center md:gap-4"
          >
            <span className="font-serif text-base">{horse.name}</span>
            <span className="text-sm text-muted-foreground">
              {horse.age} {horse.sex}
            </span>
            <span className="text-sm">{horse.record}</span>
            <span className="text-sm">{horse.best}</span>
            <span className="text-sm text-primary">{horse.prize}</span>
            <span className="text-sm text-muted-foreground">{horse.retiredAt || '기록 없음'}</span>
            <ChevronRight
              size={15}
              className="text-primary opacity-0 transition group-hover:opacity-100"
            />
          </button>
        ))}
      </Section>
    </Management>
  )
}
