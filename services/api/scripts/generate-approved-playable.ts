import { readFile, writeFile } from 'node:fs/promises'
import { normalizeRacingCatalog } from '../src/modules/racing/catalog'
import {
  deriveApprovedPlayable,
  deriveApprovedHistory,
} from '../src/modules/racing/mapping-release'

const source = JSON.parse(await readFile('seeds/racing.notion.source.json', 'utf8'))
const catalog = normalizeRacingCatalog(source)
const inputs = JSON.parse(await readFile('config/approved-race-mappings.json', 'utf8'))
const result = deriveApprovedPlayable(inputs, catalog.races, catalog.courses)
const historical = JSON.parse(await readFile('config/approved-race-history.json', 'utf8'))
const archive = deriveApprovedHistory(historical)
if (result.some((entry) => !archive.some((old) => JSON.stringify(old) === JSON.stringify(entry)))) {
  throw new Error('Every active approval must also be retained in the historical registry')
}
await writeFile(
  '../../packages/shared/src/approved-playable-history.json',
  JSON.stringify(archive, null, 2) + '\n',
)
await writeFile(
  '../../packages/shared/src/approved-playable.json',
  JSON.stringify(result, null, 2) + '\n',
)
console.log(`Verified release mappings: ${result.length}`)
