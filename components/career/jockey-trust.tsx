import type { JockeyTrust } from '@/lib/career/jockey-trust'

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
