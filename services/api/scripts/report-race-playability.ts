import { readFile, writeFile } from 'node:fs/promises'
import { normalizeRacingCatalog, digest } from '../src/modules/racing/catalog'
import { referenceRaceReport } from '../../../packages/shared/src/race-playability'
const source = JSON.parse(await readFile('seeds/racing.notion.source.json', 'utf8'))
const catalog = normalizeRacingCatalog(source)
const report = { sourceDigest: digest(source), ...referenceRaceReport(catalog.races) }
await writeFile('reports/race-playability.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, rows: report.rows.length }))
