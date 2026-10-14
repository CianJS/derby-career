import { writeFile } from 'node:fs/promises'
import { API_TYPES_PATH, generateApiTypes } from './api-types'

await writeFile(API_TYPES_PATH, await generateApiTypes())
