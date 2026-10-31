import { readFile, writeFile } from 'node:fs/promises'
import { normalizeRacingCatalog } from '../src/modules/racing/catalog'
import { deriveApprovedPlayable } from '../src/modules/racing/mapping-release'

const source = JSON.parse(await readFile('seeds/racing.notion.source.json', 'utf8'))
const catalog = normalizeRacingCatalog(source)
const inputs = JSON.parse(await readFile('config/approved-race-mappings.json', 'utf8'))
const result = deriveApprovedPlayable(inputs, catalog.races, catalog.courses)
await writeFile(
  '../../packages/shared/src/approved-playable.json',
  JSON.stringify(result, null, 2) + '\n',
)
console.log(`Verified release mappings: ${result.length}`)
