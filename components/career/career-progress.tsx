import { CAREER_SEASON_TURNS, type CareerProgress } from '@/packages/shared/src/domain'

export function SeasonSummary({
  progress,
  showAge = true,
}: {
  progress: CareerProgress
  showAge?: boolean
}) {
  return (
    <>
      {progress.seasonIndex}년 차 · {progress.seasonTurn}/{CAREER_SEASON_TURNS}개월
      {showAge && ` · ${progress.age}세`}
    </>
  )
}

export function CareerProgressView({ progress }: { progress: CareerProgress }) {
  const label = progress.extended
    ? `${progress.turn}턴 · 연장 육성`
    : `${progress.turn} / ${progress.baseTurns}턴`
  const completed = Math.min(progress.turn, progress.baseTurns)
  return (
    <>
      <p className="mt-1 text-sm font-semibold tabular-nums">{label}</p>
      <p className="mt-0.5 text-muted-foreground">
        <SeasonSummary progress={progress} />
      </p>
      <div
        role="progressbar"
        aria-label="기본 육성 진행률"
        aria-valuemin={0}
        aria-valuemax={progress.baseTurns}
        aria-valuenow={completed}
        aria-valuetext={label}
        className="lab-meter mt-1.5"
      >
        <i style={{ width: `${Math.min(100, (completed / progress.baseTurns) * 100)}%` }} />
      </div>
      {progress.extended && (
        <p className="mt-1 text-muted-foreground">
          기본 육성을 마쳤습니다. 계속 육성하거나 원할 때 은퇴할 수 있습니다.
        </p>
      )}
    </>
  )
}
