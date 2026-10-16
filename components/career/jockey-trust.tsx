import { jockeys } from './legacy-catalog'
import type { JockeyTrust } from '@/lib/career/jockey-trust-presentation'

const statusText = {
  loading: '불러오는 중…',
  error: '조회 실패',
  unavailable: '정보 없음',
  'no-horse': '현재 육성마 없음',
} as const

export function JockeyTrustValue({ trust }: { trust: JockeyTrust }) {
  return (
    <span
      data-trust-status={trust.status}
      className={
        trust.status === 'available'
          ? 'font-semibold tabular-nums text-primary'
          : 'text-muted-foreground'
      }
    >
      {trust.status === 'available' ? `${trust.value} / 100` : statusText[trust.status]}
    </span>
  )
}

/** Only confirmed receipts are accepted; undefined is distinct from an explicit zero change. */
export function TrustChangeValue({
  change,
}: {
  change?: { before: number; after: number; delta: number }
}) {
  return (
    <span data-trust-change={change ? 'confirmed' : 'unavailable'} className="tabular-nums">
      {!change
        ? '신뢰도 변화 정보 없음'
        : change.delta === 0
          ? `신뢰도 변화 없음 (${change.after} / 100)`
          : `신뢰도 ${change.before} → ${change.after} (${change.delta > 0 ? '+' : ''}${change.delta})`}
    </span>
  )
}
export function EventTrustChanges({
  changes,
}: {
  changes?: readonly { jockeyId: string; before: number; after: number; delta: number }[]
}) {
  if (!changes?.length) {
    return null
  }
  return (
    <ul aria-label="확정된 이벤트 신뢰도 변화" className="mt-2 space-y-1 text-sm">
      {changes.map((change, index) => (
        <li key={`${change.jockeyId}-${index}`}>
          {jockeys.find((j) => j.id === change.jockeyId)?.name ?? change.jockeyId} ·{' '}
          <TrustChangeValue change={change} />
        </li>
      ))}
    </ul>
  )
}
