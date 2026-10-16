import type { components } from '../../packages/shared/src/generated/api'
import type { DerbyApiClient } from '../../packages/shared/src/client'
import { validateJockeyRelationsResponse } from '../../packages/shared/src/generated/save-validation.mjs'
type JockeyRelations = components['schemas']['JockeyRelations']

/** Pure API DTO read/validation boundary: no browser store, hooks or game calculation imports. */
export type RelationIdentity = Pick<
  components['schemas']['JockeyRelationsResponse'],
  'careerId' | 'ownedHorseId' | 'revision' | 'status'
>
export async function readServerRelations(
  api: DerbyApiClient,
  expected: RelationIdentity,
): Promise<JockeyRelations> {
  const value: unknown = await api.getJockeyRelations(expected.careerId)
  if (
    !validateJockeyRelationsResponse(value) ||
    value.careerId !== expected.careerId ||
    value.ownedHorseId !== expected.ownedHorseId ||
    value.revision !== expected.revision ||
    value.status !== expected.status ||
    new Set(value.data.map((row) => row.jockeyId)).size !== value.data.length
  ) {
    throw new Error('말의 신뢰도 기록이 변경되었습니다. 다시 조회해 주세요.')
  }
  return Object.fromEntries(
    value.data.map((row) => [row.jockeyId, { starts: row.starts, trust: row.trust }]),
  )
}
