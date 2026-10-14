import type { components } from '../../packages/shared/src/generated/api'
import {
  validateServerSaveCommand,
  validateEnterRace,
  validateCompleteRace,
} from '../../packages/shared/src/generated/save-validation.mjs'

type Models = components['schemas']
export type SaveCommand =
  | Models['ServerSaveCommand']
  | { kind: 'race-entry'; careerId: string; body: Models['EnterRace'] }
  | { kind: 'race-complete'; careerId: string; raceRunId: string; body: Models['CompleteRace'] }
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
export function validateSaveCommand(value: unknown): value is SaveCommand {
  if (validateServerSaveCommand(value)) {
    return true
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('kind' in value) ||
    !('careerId' in value) ||
    typeof value.careerId !== 'string' ||
    !uuid.test(value.careerId) ||
    !('body' in value)
  ) {
    return false
  }
  if (value.kind === 'race-entry') {
    return Object.keys(value).length === 3 && validateEnterRace(value.body)
  }
  if (value.kind === 'race-complete') {
    return (
      Object.keys(value).length === 4 &&
      'raceRunId' in value &&
      typeof value.raceRunId === 'string' &&
      uuid.test(value.raceRunId) &&
      validateCompleteRace(value.body)
    )
  }
  return false
}
