'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { components } from '@/packages/shared/src/generated/api'
import { useResource } from '@/lib/race-catalog/use-resource'
import {
  catalogUrl,
  countries,
  defaultQuery,
  distanceText,
  gradeText,
  prizeText,
  queryParams,
  dateText,
  readLocation,
  selectedCourse,
  surfaces,
  type Query,
  type Race as CatalogRace,
  type Venue,
  type Course,
} from '@/lib/race-catalog/model'
import type { Client, Resource } from '@/lib/race-catalog/client'
import type { View } from './legacy-types'
import { Section } from './presentation'
import { Management } from './management'
import { RaceCatalogFilters } from './race-catalog-filters'

type Page = components['schemas']['RaceScheduleList']
export function CatalogStatus({
  resource,
  retry,
}: {
  resource: Resource<unknown>
  retry: () => void
}) {
  if (resource.status === 'ready') {
    return null
  }
  return (
    <div
      role={resource.status === 'error' ? 'alert' : 'status'}
      className="rounded-xl border border-border p-4 text-sm"
    >
      <p>{resource.status === 'loading' ? '공개 경주 카탈로그 조회 중…' : resource.message}</p>
      {resource.status === 'error' && (
        <button onClick={retry} className="mt-3 text-primary underline">
          다시 시도
        </button>
      )}
    </div>
  )
}
function useLocation() {
  const [location, setLocation] = useState<ReturnType<typeof readLocation> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const restore = () => {
      try {
        setLocation(readLocation(window.location.search))
        setError(null)
      } catch {
        setLocation(null)
        setError('주소의 조회 조건이 잘못되었습니다. 필터를 초기화해 주세요.')
      }
    }
    restore()
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  const change = (query: Query) => {
    history.replaceState(
      { ...history.state, raceCatalogScroll: 0, raceCatalogFocus: null },
      '',
      catalogUrl(window.location.href, query),
    )
    setLocation({ query, id: null })
    setError(null)
  }
  return { location, error, change }
}
export function Races({ setView }: { setView: (view: View) => void }) {
  const { location, error, change } = useLocation()
  const query = location?.query ?? defaultQuery
  const load = useCallback((client: Client) => client.list(query), [query])
  const { resource, retry } = useResource(location ? queryParams(query).toString() : null, load)
  const loadVenues = useCallback(
    (client: Client) => client.venues({ country: query.country, pageSize: 100 }),
    [query.country],
  )
  const venues = useResource(location ? `venues:${query.country ?? ''}` : null, loadVenues)
  const restored = useRef(false)
  useEffect(() => {
    if (resource.status !== 'ready' || restored.current) {
      return
    }
    const frame = requestAnimationFrame(() => {
      restored.current = true
      const id = history.state?.raceCatalogFocus
      if (id) {
        document.getElementById('catalog-' + id)?.focus({ preventScroll: true })
      }
      window.scrollTo(0, Number(history.state?.raceCatalogScroll) || 0)
    })
    return () => cancelAnimationFrame(frame)
  }, [resource])
  return (
    <Management
      title="경주 정보"
      eyebrow="RACE DATABASE"
      description="실제 개최 연도의 공개 참고 자료입니다. 육성마의 출전 후보 및 게임 달력과는 별개입니다."
    >
      {error ? (
        <div role="alert">
          {error}
          <button onClick={() => change(defaultQuery)} className="ml-2 text-primary underline">
            필터 초기화
          </button>
        </div>
      ) : (
        <>
          <RaceCatalogFilters
            query={query}
            venues={venues.resource.status === 'ready' ? venues.resource.data.data : []}
            onChange={change}
          />
          <CatalogStatus resource={venues.resource} retry={venues.retry} />
          <CatalogStatus resource={resource} retry={retry} />
          {resource.status === 'ready' && (
            <RaceCatalogList
              page={resource.data}
              venues={venues.resource.status === 'ready' ? venues.resource.data.data : []}
              onSelect={(race) => {
                history.replaceState(
                  {
                    ...history.state,
                    raceCatalogScroll: window.scrollY,
                    raceCatalogFocus: race.id,
                  },
                  '',
                )
                history.pushState(
                  history.state,
                  '',
                  catalogUrl(window.location.href, query, race.id),
                )
                setView('race')
                window.scrollTo(0, 0)
              }}
              onPage={(page) => {
                change({ ...query, page })
                document.getElementById('race-catalog-results')?.scrollIntoView()
              }}
            />
          )}
        </>
      )}
    </Management>
  )
}
export function RaceCatalogList({
  page,
  venues,
  onSelect,
  onPage,
}: {
  page: Page
  venues: Venue[]
  onSelect: (race: CatalogRace) => void
  onPage: (page: number) => void
}) {
  const names = new Map(venues.map((venue) => [venue.id, venue.name]))
  const p = page.pagination
  return (
    <section id="race-catalog-results" aria-label="경주 조회 결과" className="min-w-0">
      <p role="status" className="mb-3 text-xs text-muted-foreground">
        참고 원본 {p.total.toLocaleString('ko-KR')}행 · {p.page} / {Math.max(1, p.totalPages)}페이지
        · 중복 후보를 포함한 자료 수
      </p>
      {page.data.length === 0 ? (
        <p className="rounded-xl border border-border p-6 text-sm">
          조회 결과가 없습니다. 필터를 초기화해 보세요. 전체 조회도 비어 있다면 서버에 아직 수집된
          자료가 없습니다.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground md:hidden">
            표를 좌우로 스크롤해 나머지 정보를 확인하세요.
          </p>
          <div
            className="overflow-x-auto rounded-2xl border border-border bg-card"
            tabIndex={0}
            role="region"
            aria-label="경주 목록 표, 가로 스크롤 가능"
          >
            <table className="w-full min-w-[860px] table-fixed text-left text-xs">
              <caption className="sr-only">
                실제 경주 일정과 참가 조건. 경주명을 선택하면 상세를 조회합니다.
              </caption>
              <thead className="border-b border-border bg-accent/40 text-muted-foreground">
                <tr>
                  {[
                    '날짜 / 상태',
                    '국가 · 등급',
                    '경주명',
                    '노면 · 거리',
                    '경마장',
                    '연령 · 성별',
                    '상금',
                  ].map((label) => (
                    <th key={label} scope="col" className="px-3 py-3 font-normal">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.data.map((race) => (
                  <tr key={race.id} className="border-b border-border align-top hover:bg-accent/40">
                    <td className="break-words px-3 py-4">{dateText(race)}</td>
                    <td className="break-words px-3 py-4">
                      {countries[race.country]}
                      <p className="mt-1 text-primary">{gradeText(race)}</p>
                    </td>
                    <th scope="row" className="break-words px-3 py-4 font-normal">
                      <button
                        id={'catalog-' + race.id}
                        onClick={() => onSelect(race)}
                        className="text-left font-serif text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${race.name} 상세 보기`}
                      >
                        {race.name}
                      </button>
                      {race.duplicateGroup && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          중복 검토 후보 · {race.duplicateGroup}
                        </p>
                      )}
                    </th>
                    <td className="break-words px-3 py-4">
                      {surfaces[race.surface]}
                      <p>{distanceText(race)}</p>
                    </td>
                    <td className="break-words px-3 py-4">
                      {names.get(race.racecourseId) ?? race.racecourseId}
                    </td>
                    <td className="break-words px-3 py-4">
                      {race.ageCondition || '미확인'} · {race.sexCondition || '미확인'}
                    </td>
                    <td className="break-words px-3 py-4 text-primary">{prizeText(race)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <nav
        aria-label="경주 목록 페이지"
        className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs"
      >
        <button
          disabled={p.page <= 1}
          onClick={() => onPage(p.page - 1)}
          className="rounded-lg border border-border px-4 py-2 disabled:opacity-40"
        >
          이전
        </button>
        <form
          key={p.page}
          onSubmit={(event) => {
            event.preventDefault()
            const value = Number(new FormData(event.currentTarget).get('page'))
            if (Number.isInteger(value) && value >= 1 && value <= Math.max(1, p.totalPages)) {
              onPage(value)
            }
          }}
        >
          <label>
            페이지{' '}
            <input
              aria-label="경주 목록 페이지 이동"
              name="page"
              type="number"
              min={1}
              max={Math.max(1, p.totalPages)}
              defaultValue={p.page}
              className="ml-2 w-16 rounded-lg border border-border bg-card p-2"
            />
          </label>{' '}
          / {Math.max(1, p.totalPages)}{' '}
          <button type="submit" className="ml-2 text-primary underline">
            이동
          </button>
        </form>
        <button
          disabled={p.page >= p.totalPages}
          onClick={() => onPage(p.page + 1)}
          className="rounded-lg border border-border px-4 py-2 disabled:opacity-40"
        >
          다음
        </button>
      </nav>
    </section>
  )
}
export function Race({ setView }: { setView: (view: View) => void }) {
  const { location, error } = useLocation()
  const id = location?.id ?? null
  const load = useCallback((client: Client) => client.race(id!), [id])
  const { resource, retry } = useResource(id, load)
  const venueId = resource.status === 'ready' ? resource.data.racecourseId : null
  const loadVenue = useCallback((client: Client) => client.venue(venueId!), [venueId])
  const venue = useResource(venueId, loadVenue)
  return (
    <Management
      title={resource.status === 'ready' ? resource.data.name : '경주 상세'}
      eyebrow="RACE DETAIL"
      description="서버에 수집된 원문 조건과 코스 정보만 표시합니다. 게임 출전 대상이 아닙니다."
    >
      <button
        onClick={() => {
          history.replaceState(
            history.state,
            '',
            catalogUrl(window.location.href, location?.query ?? defaultQuery),
          )
          setView('races')
        }}
        className="self-start text-xs text-primary underline"
      >
        ← 경주 정보로 돌아가기
      </button>
      {error || (location && !id) ? (
        <p role="alert">{error ?? '선택한 경주 ID가 없습니다. 목록에서 다시 선택해 주세요.'}</p>
      ) : (
        <CatalogStatus resource={resource} retry={retry} />
      )}
      {resource.status === 'ready' && (
        <>
          <RaceCatalogDetail
            race={resource.data}
            venue={venue.resource.status === 'ready' ? venue.resource.data.racecourse : null}
            course={
              venue.resource.status === 'ready'
                ? selectedCourse(resource.data, venue.resource.data.courses)
                : null
            }
          />
          <CatalogStatus resource={venue.resource} retry={venue.retry} />
        </>
      )}
    </Management>
  )
}
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0 border-b border-border px-3 py-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value ?? '미확인'}</dd>
        </div>
      ))}
    </dl>
  )
}
function Source({ url }: { url: string | null }) {
  return url && /^https?:\/\//i.test(url) ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">
      원본 출처 보기
    </a>
  ) : (
    <>미확인</>
  )
}
export function RaceCatalogDetail({
  race,
  venue,
  course,
}: {
  race: CatalogRace
  venue: Venue | null
  course: Course | null
}) {
  return (
    <>
      <Section eyebrow="RACE SUMMARY" title={`${race.grade} · ${dateText(race)}`}>
        <Facts
          rows={[
            ['개최국 / 기준연도', `${countries[race.country]} / ${race.year}`],
            ['경마장', venue?.name ?? race.racecourseId],
            ['노면', surfaces[race.surface]],
            ['거리 / 원문', distanceText(race)],
            ['등급 / 체계', gradeText(race)],
            ['일정 / 상태', dateText(race)],
            ['원문 일자', race.originalDate],
            ['상금 / 기준', prizeText(race)],
          ]}
        />
      </Section>
      <Section eyebrow="ENTRY CONDITIONS" title="참가 조건">
        <Facts
          rows={[
            ['연령', race.ageCondition || '미확인'],
            ['성별', race.sexCondition || '미확인'],
            ['원문 참가 조건', race.originalEligibility || '미확인'],
            ['최대 출전두수', race.maxRunners === null ? '미확인' : `${race.maxRunners}두`],
          ]}
        />
      </Section>
      <Section eyebrow="COURSE PROFILE" title={course?.name ?? '코스 미확인'}>
        {course ? (
          <Facts
            rows={[
              ['방향', course.direction],
              ['코스 구성', course.configuration],
              ['형태', course.layout],
              [
                '직선 길이',
                course.straightLength === null ? '미확인' : `${course.straightLength}m`,
              ],
              [
                '고저차',
                course.elevationDifference === null ? '미확인' : `${course.elevationDifference}m`,
              ],
              ['원문 제원', course.originalSpecifications],
              ['확인된 거리', course.confirmedDistances],
              ['코스 출처', <Source key="course-source" url={course.sourceUrl} />],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            코스 미확인 · 이 경주에 연결된 코스 프로필을 확인할 수 없습니다.
          </p>
        )}
      </Section>
      <Section eyebrow="REFERENCE" title="출처와 검토 정보">
        <Facts
          rows={[
            ['경주 ID', race.id],
            ['검증 상태', race.verificationStatus],
            ['출처', <Source key="race-source" url={race.sourceUrl} />],
            [
              '중복 후보 그룹',
              race.duplicateGroup ? `중복 검토 후보 · ${race.duplicateGroup}` : '없음',
            ],
            ['메모', race.notes || '없음'],
            ['검토 항목', race.reviewIssues.join('\n') || '없음'],
          ]}
        />
        <p className="mt-4 text-xs text-muted-foreground">
          취소·미개최 및 일정 미확정 자료에는 개최일을 부여하지 않습니다. 원문 통화·상금 기준을
          유지하며 게임 상금이나 출전 조건으로 적용하지 않습니다.
        </p>
      </Section>
    </>
  )
}
