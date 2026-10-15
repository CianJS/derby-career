import { readFile, writeFile, rename, mkdir, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import {
  inspectEventCatalog,
  preflightEventDrafts,
  readDraftSource,
} from '../src/modules/events/preflight'
import { catalogSchema } from '../src/modules/events/schema'

const [input, reportPath, draftPath, ...extra] = process.argv.slice(2)
if (!input || extra.length) {
  throw new Error('Usage: events:check -- input [report.json] [drafts.json]')
}
const canonicalPath = async (path: string) => {
  try {
    return await realpath(resolve(path))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return resolve(path)
    }
    throw error
  }
}
const protectedFiles = await Promise.all(
  [input, 'seeds/events.import.json', 'seeds/events.catalog.json'].map(canonicalPath),
)
for (const output of [reportPath, draftPath].filter((path): path is string => !!path)) {
  if (protectedFiles.includes(await canonicalPath(output))) {
    throw new Error('Report/draft output must not overwrite the input or existing 350-event seeds')
  }
}
if (
  reportPath &&
  draftPath &&
  (await canonicalPath(reportPath)) === (await canonicalPath(draftPath))
) {
  throw new Error('Report and draft packet need different output paths')
}
async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n')
  await rename(temporary, path)
}
let result: ReturnType<typeof preflightEventDrafts>
try {
  const source = readDraftSource(
    await readFile(input, 'utf8'),
    input.toLowerCase().endsWith('.csv') ? 'csv' : 'json',
  )
  if (source && typeof source === 'object' && !Array.isArray(source) && 'events' in source) {
    if (draftPath) {
      throw new Error(
        'Structured catalog inspection does not produce draft packets; supply source rows',
      )
    }
    const inspection = inspectEventCatalog(source)
    result = {
      report: {
        ...inspection,
        sourceDigest: null,
        summary: { ...inspection.summary, staged: 0 },
      },
      catalog: null,
    }
  } else {
    const baseline = catalogSchema.parse(
      JSON.parse(await readFile('seeds/events.catalog.json', 'utf8')),
    )
    result = preflightEventDrafts(
      source,
      baseline.events.map((event) => event.id),
    )
  }
} catch (error) {
  result = {
    catalog: null,
    report: {
      inspectionVersion: 'event-preflight-v1',
      sourceDigest: null,
      summary: {
        rows: 0,
        errors: 1,
        unmapped: 0,
        engineGaps: 0,
        reviews: 0,
        unmappedRows: 0,
        engineGapRows: 0,
        categories: {},
        staged: 0,
        enabled: 0,
      },
      issues: [
        {
          kind: 'error',
          code: 'SOURCE_PARSE',
          path: '',
          detail: error instanceof Error ? error.message : 'Source cannot be parsed',
        },
      ],
    },
  }
}
if (reportPath) {
  await writeJson(reportPath, result.report)
}
if (draftPath && result.catalog) {
  await writeJson(draftPath, result.catalog)
}
console.log(
  JSON.stringify({
    ...result.report.summary,
    sourceDigest: result.report.sourceDigest,
    report: reportPath ?? null,
    draftPacket: result.catalog && draftPath ? draftPath : null,
  }),
)
process.exitCode = result.report.summary.errors ? 1 : 0
