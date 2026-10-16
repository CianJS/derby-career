import type { useCareer } from './store'
import { jockeyTrust as currentLocalTrust, type JockeyRelations } from './jockey-trust'
import type { components } from '../../packages/shared/src/generated/api'
import type { DerbyApiClient } from '../../packages/shared/src/client'
import { validateJockeyRelationsResponse } from '../../packages/shared/src/generated/save-validation.mjs'

export type JockeyTrust =
  | { status: 'available'; value: number }
  | { status: 'loading' | 'error' | 'unavailable' | 'no-horse' }
type TrustSnapshot = Pick<
  ReturnType<typeof useCareer>,
  'ready' | 'busy' | 'pending' | 'error' | 'mode' | 'career' | 'workspace' | 'raceOptions'
>
export function storedTrust(relations: JockeyRelations | undefined, id: string): JockeyTrust {
  const value = relations?.[id]?.trust
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
    ? { status: 'available', value }
    : { status: 'unavailable' }
}
export function raceEntryJockeyTrust(
  options: components['schemas']['RaceEntryOptions'] | null | undefined,
  id: string,
): JockeyTrust {
  const value = options?.jockeys.find((j) => j.id === id)?.chemistry
  return value === undefined
    ? { status: 'unavailable' }
    : storedTrust({ [id]: { starts: 0, trust: value } }, id)
}
/** Reads only. Local initial/legacy zero follows the shared domain's documented migration rule. */
export function jockeyTrust(snapshot: TrustSnapshot, id: string): JockeyTrust {
  if (!snapshot.ready || snapshot.mode === null) {
    return { status: 'loading' }
  }
  if (snapshot.error) {
    return { status: 'error' }
  }
  if (snapshot.busy || snapshot.pending) {
    return { status: 'loading' }
  }
  const career = snapshot.career
  if (!career) {
    return { status: 'no-horse' }
  }
  if (snapshot.mode === 'local') {
    return { status: 'available', value: currentLocalTrust(career, id) }
  }
  const current = snapshot.workspace?.career
  if (!current || current.state !== career || current.status !== 'active') {
    return { status: 'unavailable' }
  }
  const options = snapshot.raceOptions
  if (
    options &&
    (options.career.id !== current.id ||
      options.career.ownedHorseId !== current.ownedHorseId ||
      options.career.revision !== current.revision)
  ) {
    return { status: 'unavailable' }
  }
  return storedTrust(career.jockeyTrust, id)
}
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
