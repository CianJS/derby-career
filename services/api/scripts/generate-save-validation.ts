import { writeFile } from 'node:fs/promises'
import {
  generateSaveValidation,
  SAVE_VALIDATOR_PATH,
  SAVE_VALIDATOR_TYPES_PATH,
} from './save-validation'

const generated = await generateSaveValidation()
await writeFile(SAVE_VALIDATOR_PATH, generated.source)
await writeFile(SAVE_VALIDATOR_TYPES_PATH, generated.types)
