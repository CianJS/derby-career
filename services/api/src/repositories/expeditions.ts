import type { RaceDefinitionSnapshot } from '../../../../packages/shared/src/domain'
import type { Query } from '../db'
import type { CareerRow } from './career-rows'
import { conflict, ApiError, notFound } from '../errors'
import type { components } from '../../../../packages/shared/src/generated/api'

type Models = components['schemas']
const supported = new Set(['KOR', 'JPN', 'USA'])
export type ExpeditionRow = {
  id: string
  stable_id: string
  career_id: string
  target_country: string
  target_race_definition_id: string | null
  status: 'active' | 'returned'
  started_revision: number
  started_turn: number
  ended_turn: number | null
  end_reason: 'return' | 'retirement' | null
  created_at: Date
  ended_at: Date | null
}
export const expeditionDto = (row: ExpeditionRow) => ({
  id: row.id,
  careerId: row.career_id,
  targetCountry: row.target_country,
  targetRaceDefinitionId: row.target_race_definition_id,
  status: row.status,
  startedRevision: row.started_revision,
  startedTurn: row.started_turn,
  endedTurn: row.ended_turn,
  endReason: row.end_reason,
  createdAt: new Date(row.created_at).toISOString(),
  endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
})
export function assertSupportedCountry(country: string) {
  if (!supported.has(country)) {
    throw new ApiError(422, 'UNSUPPORTED_COUNTRY', '아직 지원하지 않는 국가입니다.')
  }
}
export async function readTravel(
  tx: Query,
  stableId: string,
  lock = false,
): Promise<Models['StableTravel']> {
  const stable = (
    await tx.query(
      'SELECT home_country,travel_revision FROM stables WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
      [stableId],
    )
  ).rows[0]
  if (!stable) {
    throw notFound()
  }
  const active = (
    await tx.query<ExpeditionRow>(
      "SELECT * FROM stable_expeditions WHERE stable_id=$1 AND status='active'",
      [stableId],
    )
  ).rows[0]
  return {
    homeCountry: stable.home_country,
    locationCountry: active?.target_country ?? stable.home_country,
    revision: stable.travel_revision,
    activeExpedition: active ? expeditionDto(active) : null,
  }
}
export function countryRestriction(
  travel: Models['StableTravel'],
  country: string | null,
  careerId: string,
): string | null {
  if (!supported.has(travel.homeCountry) || !country || !supported.has(country)) {
    return '마방 또는 경주의 개최 국가를 지원하거나 확인할 수 없습니다.'
  }
  const active = travel.activeExpedition
  if (active && active.careerId !== careerId) {
    return '현재 육성마의 원정 상태를 확인해 주세요.'
  }
  if (country !== travel.locationCountry) {
    return active
      ? '방문 중인 국가의 경주에만 출전할 수 있습니다. 다른 국가는 귀국 후 원정을 신청해 주세요.'
      : '해당 개최 국가로 해외 원정을 먼저 신청해 주세요.'
  }
  return null
}
export async function endExpedition(tx: Query, row: CareerRow, reason: 'return' | 'retirement') {
  const ended = await tx.query(
    "UPDATE stable_expeditions SET status='returned',ended_at=now(),ended_turn=$2,end_reason=$3 WHERE stable_id=$1 AND career_id=$4 AND status='active' RETURNING id",
    [row.stable_id, row.turn, reason, row.id],
  )
  if (ended.rows.length) {
    await tx.query('UPDATE stables SET travel_revision=travel_revision+1 WHERE id=$1', [
      row.stable_id,
    ])
  }
}
export function assertTravelMutable(row: CareerRow) {
  if (row.status !== 'active') {
    throw conflict('종료된 Career는 원정을 변경할 수 없습니다.')
  }
  if (row.state.raceRun) {
    throw conflict('확정된 경주를 완료한 뒤 원정을 변경해 주세요.')
  }
}

export function withRaceCountry(
  definition: RaceDefinitionSnapshot,
  country: string | null,
): RaceDefinitionSnapshot {
  const { countryCode: _unverified, ...snapshot } = definition
  return { ...snapshot, ...(country ? { countryCode: country } : {}) }
}
