import { randomUUID } from 'node:crypto'
import type { Query } from '../db'
import { ApiError } from '../errors'

// JSON/TypeScript amounts must stay exact before PostgreSQL can cast them to bigint.
export function assertMoney(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(500, 'INVALID_SETTLEMENT_AMOUNT', '저장된 정산 금액을 확인할 수 없습니다.')
  }
}

export async function stableFunds(tx: Query, stableId: string, lock = false): Promise<number> {
  const row = (
    await tx.query('SELECT funds FROM stables WHERE id=$1' + (lock ? ' FOR UPDATE' : ''), [
      stableId,
    ])
  ).rows[0]
  const funds = Number(row?.funds)
  assertMoney(funds)
  return funds
}

/** Called only inside executeCareerCommand's transaction, after its owner/Career locks. */
export async function settleRaceMoney(
  tx: Query,
  stableId: string,
  runId: string,
  kind: 'entry_fee' | 'prize',
  amount: number,
): Promise<void> {
  assertMoney(amount)
  const delta = kind === 'entry_fee' ? -amount : amount
  // Guard the update itself as well as the earlier eligibility check. Never round a JS sum.
  const changed = await tx.query(
    'UPDATE stables SET funds=funds+$2::bigint WHERE id=$1 AND funds+$2::bigint BETWEEN 0 AND 9007199254740991 RETURNING funds',
    [stableId, delta],
  )
  if (!changed.rows.length) {
    throw new ApiError(422, 'ECONOMY_LIMIT', '마방 잔액의 정산 가능 범위를 벗어났습니다.')
  }
  // A conflict must roll back the balance update; never ignore the existing immutable unique key.
  await tx.query(
    'INSERT INTO stable_ledger(id,stable_id,race_run_id,kind,amount) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), stableId, runId, kind, delta],
  )
}
