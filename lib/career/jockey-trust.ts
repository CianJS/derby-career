import type { useCareer } from './store'
import type { components } from '../../packages/shared/src/generated/api'

export type JockeyTrust =
  | { status: 'available'; value: number }
  | { status: 'loading' | 'error' | 'unavailable' | 'no-horse' }

type TrustSnapshot = Pick<
  ReturnType<typeof useCareer>,
  'ready' | 'busy' | 'pending' | 'error' | 'mode' | 'career' | 'workspace' | 'raceOptions'
>

/** Only this existing owner-scoped response supplies a current relationship value today.
 * Catalog chemistry and frozen RaceRun snapshots are not current horse–jockey trust.
 */
export function raceEntryJockeyTrust(
  options: components['schemas']['RaceEntryOptions'] | null | undefined,
  jockeyId: string,
): JockeyTrust {
  const value = options?.jockeys.find((jockey) => jockey.id === jockeyId)?.chemistry
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
    ? { status: 'available', value }
    : { status: 'unavailable' }
}

/** Presentation only. Never creates, updates, migrates or guesses a relationship. */
export function jockeyTrust(snapshot: TrustSnapshot, jockeyId: string): JockeyTrust {
  if (!snapshot.ready || snapshot.mode === null) {
    return { status: 'loading' }
  }
  if (snapshot.error) {
    return { status: 'error' }
  }
  if (snapshot.mode === 'server' && (snapshot.busy || snapshot.pending)) {
    return { status: 'loading' }
  }
  if (!snapshot.career) {
    return { status: 'no-horse' }
  }
  if (snapshot.mode === 'local') {
    // Career v1 has no relationship map. Do not use the catalog's constant zero.
    return { status: 'unavailable' }
  }
  const current = snapshot.workspace?.career
  const options = snapshot.raceOptions
  if (
    !current ||
    !options ||
    current.state !== snapshot.career ||
    options.career.id !== current.id ||
    options.career.ownedHorseId !== current.ownedHorseId ||
    options.career.revision !== current.revision
  ) {
    return { status: 'unavailable' }
  }
  return raceEntryJockeyTrust(options, jockeyId)
}
