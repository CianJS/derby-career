import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { API_TYPES_PATH, generateApiTypes } from './api-types'
import SwaggerParser from '@apidevtools/swagger-parser'
import {
  EVENT_VALIDATOR_PATH,
  EVENT_VALIDATOR_TYPES_PATH,
  generateEventValidation,
} from './event-validation'
import {
  generateSaveValidation,
  SAVE_VALIDATOR_PATH,
  SAVE_VALIDATOR_TYPES_PATH,
} from './save-validation'
const contract = resolve('../../contracts/openapi.yaml')
await SwaggerParser.validate(contract)
const generated = await generateApiTypes()
const current = await readFile(API_TYPES_PATH, 'utf8')
if (generated !== current) {
  throw new Error(
    'Generated API types are stale. Run npm run contract:generate and commit both files.',
  )
}
const validators = await generateEventValidation()
if (
  (await readFile(EVENT_VALIDATOR_PATH, 'utf8')) !== validators.source ||
  (await readFile(EVENT_VALIDATOR_TYPES_PATH, 'utf8')) !== validators.types
) {
  throw new Error('Generated event response validators are stale. Run npm run contract:generate.')
}
const saveValidators = await generateSaveValidation()
if (
  (await readFile(SAVE_VALIDATOR_PATH, 'utf8')) !== saveValidators.source ||
  (await readFile(SAVE_VALIDATOR_TYPES_PATH, 'utf8')) !== saveValidators.types
) {
  throw new Error('Generated save validators are stale. Run npm run contract:generate.')
}
console.log('OpenAPI is valid and generated types/response validators match')
