import type { components } from './generated/api'
import {
  validateCareerResponse,
  validateActionResponse,
  validateRetireCareerResponse,
  validateRaceEntryResponse,
  validateRaceCompleteResponse,
} from './generated/save-validation.mjs'

// Race envelopes extend the existing journal locally; the HTTP/OpenAPI contract stays unchanged.
export type SaveResponseKind =
  components['schemas']['ServerSaveCommand']['kind'] | 'race-entry' | 'race-complete'
const validators = {
  create: validateCareerResponse,
  action: validateActionResponse,
  advance: validateCareerResponse,
  event: validateCareerResponse,
  retire: validateRetireCareerResponse,
  'race-entry': validateRaceEntryResponse,
  'race-complete': validateRaceCompleteResponse,
} satisfies Record<SaveResponseKind, (value: unknown) => boolean>

export function validateSaveResponse(kind: SaveResponseKind, value: unknown): boolean {
  return validators[kind](value)
}
