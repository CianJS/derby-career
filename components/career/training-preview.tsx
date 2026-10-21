'use client'

import { labels, trainingPreview, type Career, type Stat } from '@/lib/career/model'
import { effectText } from '@/lib/career/events/text'

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`

export function TrainingPreview({
  career,
  type,
  serverMode,
}: {
  career: Career
  type: Stat
  serverMode: boolean
}) {
  // A Server workspace does not expose its authoritative pending modifiers. Never substitute Local ones.
  const preview = trainingPreview(
    serverMode ? { values: career.values, event: undefined } : career,
    type,
  )
  return (
    <div className="space-y-2 text-[11px] leading-5" aria-live="polite" aria-atomic="true">
      <p className="font-semibold text-primary">
        {serverMode ? '기본 기준 예상 · 이벤트 미반영' : '이벤트 반영 최종 예상'}
      </p>
      <dl className="space-y-2">
        {preview.costs.map((cost) => (
          <div key={cost.key}>
            <dt className="font-semibold">{labels[cost.key]}</dt>
            <dd className="tabular-nums">
              <b>
                {cost.before} → {cost.after} ({signed(cost.final)})
              </b>
              <p className="text-muted-foreground">
                기본 {signed(cost.base)} · 이벤트 {serverMode ? '미확인' : signed(cost.event)}
                {' · '}
                {serverMode ? '최종 미확인' : `최종 ${signed(cost.final)}`}
              </p>
            </dd>
          </div>
        ))}
      </dl>
      {!serverMode &&
        preview.effects.map((effect, index) => (
          <p key={index} className="text-primary">
            이벤트 · {effectText(effect)}
          </p>
        ))}
      <p className="text-muted-foreground">
        {serverMode
          ? '현재 상태와 기본 비용만 반영했습니다. 이벤트 보정·최종 수치는 서버 확정 시 변동 가능합니다.'
          : '현재 적용 가능한 이벤트 기준입니다. 비용과 상태 하한 0을 반영하며, 이벤트 보정은 하한 적용 후 값입니다.'}
      </p>
      <p className="text-muted-foreground">
        성장량은 실행 시 계산·이벤트와 능력치 상한에 따라 달라집니다. 결과 시점 이벤트·부상 여부는
        실행 후 확정됩니다.
      </p>
    </div>
  )
}
