'use client'

import { Button } from '@/components/ui/button'
import {
  categoryLabels,
  conditionText,
  effectText,
  statusLabels,
  timingLabels,
  type CatalogEvent,
} from '@/lib/event-catalog/presentation'
import { useCatalogResource } from '@/lib/event-catalog/use-catalog-resource'

export function EventDetail({ id }: { id: string }) {
  const { resource, retry } = useCatalogResource<CatalogEvent>(
    `/api/event-catalog/${encodeURIComponent(id)}`,
  )

  if (resource.status === 'loading') {
    return <p role="status">이벤트 상세를 불러오는 중…</p>
  }
  if (resource.status === 'error') {
    return (
      <div role="alert" className="space-y-3">
        <p>{resource.message}</p>
        <Button variant="outline" onClick={retry}>
          상세 다시 불러오기
        </Button>
      </div>
    )
  }
  const event = resource.data

  return (
    <article className="space-y-5" aria-labelledby="catalog-detail-title">
      <header>
        <p className="text-xs text-muted-foreground">{event.id}</p>
        <h2 id="catalog-detail-title" className="mt-1 text-xl font-bold">
          {event.name}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {categoryLabels[event.category]} · {event.subtype} · {timingLabels[event.timing]}
        </p>
      </header>
      <p className="text-sm leading-7">{event.description ?? '등록된 설명이 없습니다.'}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">적용 상태</dt>
          <dd>
            {statusLabels[event.status]} · {event.enabled ? '활성' : '비활성'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">진행 방식</dt>
          <dd>{event.automatic ? '자동 적용' : '선택지 선택'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">추첨 가중치</dt>
          <dd>{event.weight}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">밸런스 버전</dt>
          <dd className="break-all">{event.balanceVersion}</dd>
        </div>
      </dl>
      <section aria-labelledby="catalog-conditions-title">
        <h3 id="catalog-conditions-title" className="font-semibold">
          발생 조건
        </h3>
        <ul className="mt-2 space-y-1 text-sm">
          {event.conditions.map((condition, index) => (
            <li key={index}>{conditionText(condition)}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="catalog-effects-title">
        <h3 id="catalog-effects-title" className="font-semibold">
          선택지와 효과
        </h3>
        {event.choices.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">등록된 실행 효과가 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {event.choices.map((choice) => (
              <li key={choice.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-semibold">{choice.label}</p>
                {choice.conditions.length > 0 ? (
                  <p className="mt-2 text-muted-foreground">
                    조건: {choice.conditions.map(conditionText).join(' · ')}
                  </p>
                ) : null}
                <ul className="mt-2 space-y-1">
                  {choice.effects.map((effect, index) => (
                    <li key={index}>{effectText(effect)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      {event.mappingNotes.length > 0 ? (
        <section aria-labelledby="catalog-notes-title">
          <h3 id="catalog-notes-title" className="font-semibold">
            검토 메모
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {event.mappingNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="break-all text-xs text-muted-foreground">정의 버전: {event.revision}</p>
    </article>
  )
}
