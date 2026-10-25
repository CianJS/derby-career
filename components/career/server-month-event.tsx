'use client'

import { useId } from 'react'
import { careerStore, useCareer } from '@/lib/career/store'
import { canTrain } from '@/packages/shared/src/domain'
import { conditionText, effectText, timingLabels } from '@/lib/event-catalog/presentation'
import { EventTrustChanges } from './jockey-trust'
import { eventChoiceReason, serverMonthEventAvailability } from './event-choice-guidance'
import { Button } from '@/components/ui/button'

export function ServerMonthEvent({ busy }: { busy: boolean }) {
  const snapshot = useCareer()
  const reasonId = useId()
  const shown =
    snapshot.mode === 'server'
      ? serverMonthEventAvailability(snapshot.workspace?.career ?? null)
      : null
  if (!shown) {
    return null
  }
  const { event, career, current, choices, recoveryPending } = shown
  const blocked = busy || snapshot.busy || snapshot.pending || !snapshot.ready
  return (
    <section aria-label="이번 달 서버 이벤트" className="mb-3 rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground">{timingLabels[event.definition.timing]}</p>
      <h3 className="mt-1 text-sm font-bold">{event.definition.name}</h3>
      <p className="mt-2 text-sm">{event.definition.description}</p>
      {event.state === 'pending' ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            {recoveryPending
              ? '부상으로 모든 선택지의 훈련 보상을 사용할 수 없습니다. 아래 월간 행동에서 휴식·치료를 실행할 수 있습니다. 행동 저장이 성공하면 서버에서 이 이벤트를 보상 없이 만료합니다.'
              : '가능한 이벤트 선택을 확정하면 다음 행동을 진행할 수 있습니다.'}
          </p>
          {!current && (
            <p role="status">현재 턴의 이벤트가 아닙니다. 최신 서버 기록을 다시 불러와 주세요.</p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {choices.map(({ choice, availability }, index) => {
              const reason = eventChoiceReason(availability, career)
              const descriptionId = `${reasonId}-${index}`
              return (
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
                  {reason && (
                    <p id={descriptionId} className="mb-3 text-xs text-muted-foreground">
                      {reason}
                    </p>
                  )}
                  {availability.available &&
                    !canTrain(career.health) &&
                    [...choice.effects, ...Object.values(choice.risk?.outcomes ?? {}).flat()].some(
                      (effect) => effect.type === 'action_modifier' && effect.action === 'training',
                    ) && (
                      <p className="mb-3 text-xs text-muted-foreground">
                        실행하지 않은 훈련 보정은 이번 달 행동·월 종료 시 기존 규칙에 따라
                        만료됩니다.
                      </p>
                    )}
                  <Button
                    aria-describedby={reason ? descriptionId : undefined}
                    disabled={blocked || !current || !availability.available}
                    size="sm"
                    onClick={() => void careerStore.chooseServerEvent(choice.id)}
                  >
                    {choice.label} 선택
                  </Button>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {event.state === 'expired'
            ? event.choiceId === null
              ? '선택하지 않은 이벤트가 서버에서 만료되었습니다. 이 이벤트의 선택 보상은 적용되지 않았습니다.'
              : '이번 달 행동과 맞지 않아 효과가 종료되었습니다.'
            : event.state === 'selected'
              ? '선택이 저장되었습니다. 해당 행동을 실행할 때 효과가 적용됩니다.'
              : '서버에 저장된 상태에 효과가 반영되었습니다.'}
        </p>
      )}
      <EventTrustChanges changes={event.result?.trustChanges} />
    </section>
  )
}
