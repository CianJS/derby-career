'use client'
import { useState } from 'react'
import {
  applyFilters,
  countries,
  surfaces,
  statuses,
  grades,
  queryParams,
  type Query,
  type Venue,
} from '@/lib/race-catalog/model'
const inputClass =
  'min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
export function RaceCatalogFilters({
  query,
  venues,
  onChange,
}: {
  query: Query
  venues: Venue[]
  onChange: (query: Query) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const selects = [
    { name: 'country', label: '개최국', options: Object.entries(countries) },
    {
      name: 'month',
      label: '월',
      options: Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}월`]),
    },
    { name: 'grade', label: '등급', options: grades.map((value) => [value, value]) },
    { name: 'surface', label: '노면', options: Object.entries(surfaces) },
    {
      name: 'racecourseId',
      label: '경마장',
      options: [
        ...(query.racecourseId && !venues.some((v) => v.id === query.racecourseId)
          ? [[query.racecourseId, query.racecourseId]]
          : []),
        ...venues.map((v) => [v.id, v.name]),
      ],
    },
    { name: 'scheduleStatus', label: '일정 상태', options: Object.entries(statuses) },
  ] as const
  return (
    <form
      key={queryParams(query).toString()}
      aria-label="경주 조회 조건"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault()
        const params = new URLSearchParams()
        new FormData(event.currentTarget).forEach((value, key) => {
          if (String(value).trim()) {
            params.set(key, String(value).trim())
          }
        })
        try {
          onChange(applyFilters(params, query))
          setError(null)
        } catch (error) {
          setError(error instanceof Error ? error.message : '조회 조건을 확인해 주세요.')
        }
      }}
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement) {
          event.currentTarget.requestSubmit()
        }
      }}
    >
      {selects.map(({ name, label, options }) => (
        <label key={name} className="flex min-w-0 flex-col gap-1 text-xs">
          {label}
          <select name={name} defaultValue={query[name] ?? ''} className={inputClass}>
            <option value="">전체</option>
            {options.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="flex flex-col gap-1 text-xs">
        연도
        <input
          name="year"
          type="number"
          min={1900}
          max={2200}
          step={1}
          placeholder="전체 연도"
          defaultValue={query.year ?? ''}
          className={inputClass}
        />
      </label>
      {(['minDistance', 'maxDistance'] as const).map((name) => (
        <label key={name} className="flex flex-col gap-1 text-xs">
          {name === 'minDistance' ? '최소' : '최대'} 거리 (m)
          <input
            name={name}
            type="number"
            min={0}
            max={100000}
            step="any"
            defaultValue={query[name] ?? ''}
            className={inputClass}
          />
        </label>
      ))}
      <label className="col-span-2 flex flex-col gap-1 text-xs">
        경주명 검색
        <input
          type="search"
          name="search"
          maxLength={120}
          defaultValue={query.search ?? ''}
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        className="self-end rounded-lg border border-primary px-3 py-2 text-xs text-primary"
      >
        조건 적용 / 검색
      </button>
      <button
        type="button"
        onClick={() => {
          onChange({ page: 1, pageSize: 100 })
          setError(null)
        }}
        className="text-left text-xs text-primary underline"
      >
        필터 초기화
      </button>
      <p className="col-span-full text-xs text-muted-foreground">
        연도는 기준연도, 월은 실제 개최일 기준입니다. 월 필터는 날짜 미확정·미개최 자료를
        제외합니다. 부담중량 필터는 제공되지 않습니다.
      </p>
      {error && (
        <p role="alert" className="col-span-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
