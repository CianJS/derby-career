import { writeFile } from 'node:fs/promises'
import {
  EVENT_VALIDATOR_PATH,
  EVENT_VALIDATOR_TYPES_PATH,
  generateEventValidation,
} from './event-validation'

const generated = await generateEventValidation()
await writeFile(EVENT_VALIDATOR_PATH, generated.source)
await writeFile(EVENT_VALIDATOR_TYPES_PATH, generated.types)
console.log('Generated portable event response validators')
