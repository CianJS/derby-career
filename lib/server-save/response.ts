import { validateSaveResponse as shared } from '../../packages/shared/src/save-response-validation'
import { validateCareerResponse } from '../../packages/shared/src/generated/save-validation.mjs'
import type { SaveCommand } from './commands'
export function validateSaveResponse(kind: SaveCommand['kind'], value: unknown): boolean {
  return kind === 'expedition-start' || kind === 'expedition-return'
    ? validateCareerResponse(value)
    : shared(kind, value)
}
