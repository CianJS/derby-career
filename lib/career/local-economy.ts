import type { LifecycleSave } from './lifecycle-save'

export const INITIAL_FUNDS_KRW = 20_000_000
export type EconomyEntry = {
  raceRunId: string
  kind: 'entry_fee' | 'prize'
  amount: number
}
export type LocalEconomy = { fundsKRW: number; economyLedger: EconomyEntry[] }
const invalid = () =>
  new Error('저장된 마방 자금 또는 정산 원장이 유효하지 않습니다. 기존 기록은 유지됩니다.')
export function assertMoney(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw invalid()
  }
}
export function assertEconomy(value: { fundsKRW?: unknown; economyLedger?: unknown }) {
  if (value.fundsKRW !== undefined) {
    assertMoney(value.fundsKRW)
  }
  if (value.economyLedger === undefined) {
    if (value.fundsKRW !== undefined) {
      throw invalid()
    }
    return
  }
  if (value.fundsKRW === undefined || !Array.isArray(value.economyLedger)) {
    throw invalid()
  }
  const keys = new Set<string>()
  for (const row of value.economyLedger) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.raceRunId !== 'string' ||
      !row.raceRunId ||
      !['entry_fee', 'prize'].includes(row.kind) ||
      !Number.isSafeInteger(row.amount) ||
      (row.kind === 'entry_fee' ? row.amount > 0 : row.amount < 0)
    ) {
      throw invalid()
    }
    const key = `${row.raceRunId}:${row.kind}`
    if (keys.has(key)) {
      throw invalid()
    }
    keys.add(key)
  }
}
/** Convert the old display string once; subsequent calculations only use the numeric document. */
export function migrateEconomy(saved: LifecycleSave): LifecycleSave & LocalEconomy {
  assertEconomy(saved)
  if (saved.fundsKRW !== undefined) {
    return saved as LifecycleSave & LocalEconomy
  }
  const legacy = saved.funds?.trim() ?? ''
  let fundsKRW = INITIAL_FUNDS_KRW
  if (legacy) {
    if (!/^(?:₩\s*)?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\s*원)?$/.test(legacy)) {
      throw invalid()
    }
    fundsKRW = Number(legacy.replace(/[₩,\s원]/g, ''))
    assertMoney(fundsKRW)
  }
  return { ...saved, fundsKRW, economyLedger: [] }
}
/** Called only by Local Save, inside the same lock and document write as the game transition. */
export function settleLocal(
  saved: LifecycleSave & LocalEconomy,
  row: EconomyEntry,
): LifecycleSave & LocalEconomy {
  assertEconomy(saved)
  assertEconomy({ fundsKRW: saved.fundsKRW, economyLedger: [row] })
  const existing = saved.economyLedger.find(
    (item) => item.raceRunId === row.raceRunId && item.kind === row.kind,
  )
  if (existing) {
    if (existing.amount !== row.amount) {
      throw invalid()
    }
    return saved
  }
  const fundsKRW = saved.fundsKRW + row.amount
  if (fundsKRW < 0) {
    throw new Error('마방 자금이 부족하여 등록비를 낼 수 없습니다.')
  }
  assertMoney(fundsKRW)
  return { ...saved, fundsKRW, economyLedger: [...saved.economyLedger, row] }
}
