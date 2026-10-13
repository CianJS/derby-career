'use client'

import { careerStore, useCareer } from '@/lib/career/store'
import { conditionText, effectText, timingLabels } from '@/lib/event-catalog/presentation'
import { Button } from '@/components/ui/button'

export function ServerMonthEvent({ busy }: { busy: boolean }) {
  const event = useCareer().workspace?.career?.event
  if (!event) {
    return null
  }
  return (
    <section aria-label="이번 달 서버 이벤트" className="mb-3 rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground">{timingLabels[event.definition.timing]}</p>
      <h3 className="mt-1 text-sm font-bold">{event.definition.name}</h3>
      <p className="mt-2 text-sm">{event.definition.description}</p>
      {event.state === 'pending' ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            이벤트 선택을 확정하면 다음 행동을 진행할 수 있습니다.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {event.definition.choices.map((choice) => (
              <div key={choice.id} className="rounded border border-border p-3">
                <p className="text-sm font-semibold">{choice.label}</p>
                <p className="my-2 text-xs text-muted-foreground">
                  {choice.conditions.map(conditionText).join(' · ')}
                </p>
                <ul className="mb-3 text-xs">
                  {choice.effects.map((effect, index) => (
                    <li key={index}>{effectText(effect)}</li>
                  ))}
                </ul>
                <Button
                  disabled={busy}
                  size="sm"
                  onClick={() => void careerStore.chooseServerEvent(choice.id)}
                >
                  {choice.label} 선택
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {event.state === 'expired'
            ? '이번 달 행동과 맞지 않아 효과가 종료되었습니다.'
            : event.state === 'selected'
              ? '선택이 저장되었습니다. 해당 행동을 실행할 때 효과가 적용됩니다.'
              : '서버에 저장된 상태에 효과가 반영되었습니다.'}
        </p>
      )}
    </section>
  )
}
