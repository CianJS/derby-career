import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import standaloneCode from 'ajv/dist/standalone/index.js'
import { fastFormats } from 'ajv-formats/dist/formats.js'
import { readContract } from '../src/contracts'

export const SAVE_VALIDATOR_PATH = '../../packages/shared/src/generated/save-validation.mjs'
export const SAVE_VALIDATOR_TYPES_PATH = '../../packages/shared/src/generated/save-validation.d.mts'

function portableSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(portableSchema)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const schema = value as Record<string, unknown>
  if (schema.nullable) {
    const { nullable: _nullable, ...rest } = schema
    return { anyOf: [portableSchema(rest), { type: 'null' }] }
  }
  if (typeof schema.$ref === 'string') {
    return { $ref: schema.$ref.replace('#/components/schemas/', '') }
  }
  const result = Object.fromEntries(
    Object.entries(schema).map(([key, part]) => [key, portableSchema(part)]),
  )
  for (const bound of ['Minimum', 'Maximum']) {
    if (result[`exclusive${bound}`] === true) {
      result[`exclusive${bound}`] = result[bound.toLowerCase()]
      delete result[bound.toLowerCase()]
    }
  }
  return result
}

export async function generateSaveValidation() {
  const spec = await readContract()
  const models = [
    'Racecourse',
    'Course',
    'RaceSchedule',
    'RacecourseList',
    'RacecourseDetail',
    'RaceScheduleList',
    'ServerSaveCommand',
    'CareerWorkspace',
    'HorseCatalog',
    'CareerResponse',
    'ActionResponse',
    'RetireCareerResponse',
    'EnterRace',
    'CompleteRace',
    'RaceEntryOptions',
    'JockeyRelationsResponse',
    'RaceEntryResponse',
    'RaceRunResponse',
    'RaceLogResponse',
    'RaceCompleteResponse',
  ]
  const ajv = new Ajv({
    strict: false,
    inlineRefs: false,
    ownProperties: true,
    code: { source: true, esm: true },
  })
  addFormats(ajv, { mode: 'fast' })
  // Use the installed fast format's RegExp directly so standalone output has no Ajv runtime import.
  const dateTime = fastFormats['date-time']
  const date = fastFormats.date
  if (typeof date !== 'object' || !('validate' in date) || !(date.validate instanceof RegExp)) {
    throw new Error('The date validator is no longer portable')
  }
  ajv.addFormat('date', date.validate)
  if (
    typeof dateTime !== 'object' ||
    !('validate' in dateTime) ||
    !(dateTime.validate instanceof RegExp)
  ) {
    throw new Error('The date-time validator is no longer portable')
  }
  ajv.addFormat('date-time', dateTime.validate)
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    ajv.addSchema(portableSchema(schema) as object, name)
  }
  const compiled = standaloneCode(
    ajv,
    Object.fromEntries(models.map((name) => [`validate${name}`, name])),
  )
  const portable = compiled.replace(
    /require\("ajv\/dist\/runtime\/ucs2length"\)\.default/g,
    '((value) => Array.from(value).length)',
  )
  if (/\brequire\(/.test(portable)) {
    throw new Error('Generated save validator requires an unsupported runtime dependency')
  }
  return {
    source:
      '// Generated from contracts/openapi.yaml. Run npm run contract:generate; do not edit.\n' +
      portable +
      '\n',
    types:
      "// Generated from contracts/openapi.yaml. Do not edit.\nimport type { components } from './api'\n" +
      models
        .map(
          (name) =>
            `export declare function validate${name}(value: unknown): value is components['schemas']['${name}']\n`,
        )
        .join(''),
  }
}
