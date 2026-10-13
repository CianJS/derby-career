import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import standaloneCode from 'ajv/dist/standalone/index.js'
import { readContract, resolveSchema } from '../src/contracts'

export const EVENT_VALIDATOR_PATH = '../../packages/shared/src/generated/event-validation.mjs'
export const EVENT_VALIDATOR_TYPES_PATH =
  '../../packages/shared/src/generated/event-validation.d.mts'

export async function generateEventValidation() {
  const spec = await readContract()
  const listSource = spec.components.schemas.EventList
  if (listSource.properties.data.items.$ref !== '#/components/schemas/EventDefinition') {
    throw new Error('EventList item contract changed; update the validator generator')
  }
  const definition = resolveSchema(spec.components.schemas.EventDefinition, spec)
  const list = resolveSchema(listSource, spec)
  list.properties.data.items = { $ref: 'event-definition' }
  const ajv = new Ajv({
    strict: false,
    inlineRefs: false,
    ownProperties: true,
    code: { source: true, esm: true },
  })
  addFormats(ajv, { mode: 'fast' })
  ajv.addSchema(definition, 'event-definition')
  ajv.addSchema(list, 'event-list')
  const compiled = standaloneCode(ajv, {
    validateEventDefinition: 'event-definition',
    validateEventList: 'event-list',
  })
  // Unicode length is the only Ajv runtime helper needed by this contract. Keep the output portable
  // in Node and browsers without adding a frontend runtime dependency on Ajv.
  const portable = compiled.replace(
    /require\("ajv\/dist\/runtime\/ucs2length"\)\.default/g,
    '((value) => Array.from(value).length)',
  )
  if (/\brequire\(/.test(portable)) {
    throw new Error('Generated event validator requires an unsupported runtime dependency')
  }
  return {
    source:
      '// Generated from contracts/openapi.yaml. Run npm run contract:generate; do not edit.\n' +
      portable +
      '\n',
    types: `// Generated from contracts/openapi.yaml. Do not edit.
import type { components } from './api'
export declare function validateEventDefinition(value: unknown): value is components['schemas']['EventDefinition']
export declare function validateEventList(value: unknown): value is components['schemas']['EventList']
`,
  }
}
