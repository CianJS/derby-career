import { readFile, writeFile } from 'node:fs/promises'
import { normalizeRacingCatalog, digest } from '../src/modules/racing/catalog'
import { referenceRaceReport } from '../../../packages/shared/src/race-playability'
const source = JSON.parse(await readFile('seeds/racing.notion.source.json', 'utf8'))
const catalog = normalizeRacingCatalog(source)
const report = { sourceDigest: digest(source), ...referenceRaceReport(catalog.races) }
await writeFile('reports/race-playability.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, rows: report.rows.length }))

// Review-only second-stage mapping candidates. Never used as DB seed/import input.
const { buildRaceMappingReport } = await import('../src/modules/racing/mapping')
const mappingReport = buildRaceMappingReport(catalog.races, catalog.courses)
await writeFile('reports/race-mapping-candidates.json', JSON.stringify(mappingReport) + '\n')
console.log(JSON.stringify({ ...mappingReport, candidates: mappingReport.candidates.length }))
