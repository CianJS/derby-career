'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EventDetail } from './event-detail'
import {
  categoryLabels,
  statusLabels,
  timingLabels,
  type CatalogPage,
} from '@/lib/event-catalog/presentation'
import { useCatalogResource } from '@/lib/event-catalog/use-catalog-resource'

type Filters = { category: string; status: string; enabled: string; sort: string; order: string }
const defaultFilters: Filters = {
  category: '',
  status: 'ready',
  enabled: 'true',
  sort: 'id',
  order: 'asc',
}
const selectClass = 'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm'

export function EventCatalog() {
  const [filters, setFilters] = useState(defaultFilters)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const params = new URLSearchParams({ page: String(page), pageSize: '20' })
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value)
    }
  }
  const { resource, retry } = useCatalogResource<CatalogPage>(`/api/event-catalog?${params}`)
  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }))
    setPage(1)
    setSelectedId(null)
  }
  const movePage = (next: number) => {
    setPage(next)
    setSelectedId(null)
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header>
        <Link href="/" className="text-sm text-primary underline underline-offset-4">
          게임으로 돌아가기
        </Link>
        <p className="mt-6 text-xs font-semibold text-muted-foreground">
          개발용 · DB 카탈로그 조회
        </p>
        <h1 className="mt-1 text-2xl font-bold">이벤트 카탈로그</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          서버에 등록된 이벤트와 효과를 확인합니다. 현재 밸런스는 제안치이며 조정될 수 있습니다.
        </p>
      </header>

      <section
        aria-label="이벤트 조회 조건"
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5"
      >
        <label className="text-sm">
          분류
          <select
            className={selectClass}
            value={filters.category}
            onChange={(event) => updateFilter('category', event.target.value)}
          >
            <option value="">전체 분류</option>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          적용 상태
          <select
            className={selectClass}
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
          >
            <option value="">전체 상태</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          활성 여부
          <select
            className={selectClass}
            value={filters.enabled}
            onChange={(event) => updateFilter('enabled', event.target.value)}
          >
            <option value="">전체</option>
            <option value="true">활성</option>
            <option value="false">비활성</option>
          </select>
        </label>
        <label className="text-sm">
          정렬 기준
          <select
            className={selectClass}
            value={filters.sort}
            onChange={(event) => updateFilter('sort', event.target.value)}
          >
            <option value="id">이벤트 ID</option>
            <option value="name">이름</option>
          </select>
        </label>
        <label className="text-sm">
          정렬 방향
          <select
            className={selectClass}
            value={filters.order}
            onChange={(event) => updateFilter('order', event.target.value)}
          >
            <option value="asc">오름차순</option>
            <option value="desc">내림차순</option>
          </select>
        </label>
      </section>

      {resource.status === 'loading' ? <p role="status">이벤트 목록을 불러오는 중…</p> : null}
      {resource.status === 'error' ? (
        <div role="alert" className="space-y-3 rounded-xl border border-border p-5">
          <p>{resource.message}</p>
          <Button variant="outline" onClick={retry}>
            목록 다시 불러오기
          </Button>
        </div>
      ) : null}
      {resource.status === 'ready' ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <section aria-label="이벤트 목록" className="space-y-3">
            <p role="status" className="text-sm text-muted-foreground">
              조회 결과 {resource.data.pagination.total}개
            </p>
            {resource.data.data.length === 0 ? (
              <p className="rounded-xl border border-border p-5 text-sm">
                조건에 맞는 이벤트가 없습니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {resource.data.data.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      aria-pressed={selectedId === event.id}
                      onClick={() => setSelectedId(event.id)}
                      className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-primary ${selectedId === event.id ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-accent/40'}`}
                    >
                      <span className="text-xs text-muted-foreground">
                        {event.id} · {event.subtype}
                      </span>
                      <span className="mt-1 block font-semibold">{event.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {timingLabels[event.timing]} · {statusLabels[event.status]} ·{' '}
                        {event.enabled ? '활성' : '비활성'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <nav
              aria-label="이벤트 페이지 이동"
              className="flex items-center justify-between gap-3"
            >
              <Button variant="outline" disabled={page <= 1} onClick={() => movePage(page - 1)}>
                이전 페이지
              </Button>
              <span className="text-sm">
                {page} / {Math.max(1, resource.data.pagination.totalPages)}
              </span>
              <Button
                variant="outline"
                disabled={page >= resource.data.pagination.totalPages}
                onClick={() => movePage(page + 1)}
              >
                다음 페이지
              </Button>
            </nav>
          </section>
          <section
            aria-label="이벤트 상세"
            className="rounded-xl border border-border bg-card p-5"
            aria-live="polite"
          >
            {selectedId ? (
              <EventDetail key={selectedId} id={selectedId} />
            ) : (
              <p className="text-sm text-muted-foreground">
                목록에서 이벤트를 선택하면 상세 내용이 표시됩니다.
              </p>
            )}
          </section>
        </div>
      ) : null}
    </main>
  )
}
