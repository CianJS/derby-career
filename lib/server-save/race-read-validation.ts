import {
  validateRaceRunResponse,
  validateRaceLogResponse,
} from '../../packages/shared/src/generated/save-validation.mjs'

/** Compatibility wrapper for callers; all versions use the generated OpenAPI validators. */
export function validateRaceReadResponse(value: unknown, log: boolean): boolean {
  return log ? validateRaceLogResponse(value) : validateRaceRunResponse(value)
}
