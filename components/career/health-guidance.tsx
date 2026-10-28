import {
  healthGuidance,
  recoveryGuidance,
  RACE_ELIGIBILITY_NOTICE,
  type HealthSource,
} from '@/lib/career/health-presentation'

export function HealthGuidance({
  career,
  compact = false,
}: {
  career: HealthSource
  compact?: boolean
}) {
  const health = healthGuidance(career)
  return (
    <aside
      aria-label="현재 건강과 행동 안내"
      className="mt-2 text-xs leading-5"
      data-health-guidance
    >
      <p className="font-semibold">
        건강 · {health.health} · 현재 회복 필요량 {health.recovery}
      </p>
      <p>
        {health.trainingText} · {health.raceText}
      </p>
      {health.caution && <p className="text-primary">{health.caution}</p>}
      {compact ? (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">출전 자격 안내</summary>
          <p>{RACE_ELIGIBILITY_NOTICE}</p>
        </details>
      ) : (
        <p className="text-muted-foreground">{RACE_ELIGIBILITY_NOTICE}</p>
      )}
    </aside>
  )
}

export function RecoveryPreview({
  career,
  action,
}: {
  career: HealthSource
  action: 'rest' | 'treatment'
}) {
  const { before, after, amount, outcome } = recoveryGuidance(career, action)
  return (
    <aside
      aria-label={`${action === 'rest' ? '휴식' : '치료'} 실행 전 회복 예상`}
      className="w-full rounded border border-border p-3 text-xs leading-5"
      data-recovery-preview={action}
    >
      <p className="font-semibold">실행 전 예상 · 회복 필요량 최대 {amount} 감소</p>
      <p>
        현재 건강 {before.health} → 실행 후 예상 {after.health}
      </p>
      <p className="tabular-nums">
        현재 회복 필요량 {before.recovery} → 실행 후 예상 {after.recovery}
      </p>
      <p className="mt-1">{outcome}</p>
      <p className="text-muted-foreground">
        이번 달 행동 1회를 사용합니다. 같은 달에 훈련·경주를 추가로 할 수 없습니다. 실제 결과는 행동
        실행·저장 후 확인하세요.
      </p>
      <p className="text-muted-foreground">{RACE_ELIGIBILITY_NOTICE}</p>
    </aside>
  )
}
