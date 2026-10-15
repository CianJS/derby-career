import { readFile, writeFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import { buildExpansion } from '../src/modules/events/expansion'
import { digest } from '../src/services/identity'
const fields = [
  '이벤트 ID',
  '이벤트명',
  '대분류',
  '도입',
  '등장조건',
  '발동시점',
  '선택·효과',
  '세부유형',
  '사건그룹 ID',
]
const input = process.argv[2]
const source = input
  ? {
      rows: (
        parse(await readFile(input, 'utf8'), {
          columns: true,
          bom: true,
          skip_empty_lines: true,
        }) as Record<string, string>[]
      ).map((row) =>
        Object.fromEntries(fields.filter((k) => row[k] !== undefined).map((k) => [k, row[k]])),
      ),
    }
  : JSON.parse(await readFile('seeds/events.expansion.source.json', 'utf8'))
const catalog = buildExpansion(source)
const old = JSON.parse(await readFile('seeds/events.catalog.json', 'utf8'))
const oldSource = JSON.parse(await readFile('seeds/events.import.json', 'utf8'))
const archived = JSON.parse(
  await readFile('seeds/archives/events.expansion.csv-snapshot-2026-10-14.json', 'utf8'),
)
const sourceChanges = (source.rows as Record<string, string>[]).flatMap((row) => {
  const previous = archived.rows.find(
    (r: Record<string, string>) => r['이벤트 ID'] === row['이벤트 ID'],
  )
  const changed = fields.filter((key) => row[key] !== previous?.[key])
  return changed.length ? [{ id: row['이벤트 ID'], fields: changed, previous, current: row }] : []
})
const groups = new Map<string, string[]>(),
  duplicates = new Map<string, string[]>()
const legacyDifferences = []
for (const row of source.rows as Record<string, string>[]) {
  const key = row['사건그룹 ID']
  if (key) {
    groups.set(key, [...(groups.get(key) ?? []), row['이벤트 ID']])
  }
  const duplicateKey = digest({
    condition: row['등장조건'],
    effect: row['선택·효과'],
    timing: row['발동시점'],
  })
  duplicates.set(duplicateKey, [...(duplicates.get(duplicateKey) ?? []), row['이벤트 ID']])
  if (row['이벤트 ID'].startsWith('COM-')) {
    const previous = oldSource.rows.find(
      (r: Record<string, string>) => r['이벤트 ID'] === row['이벤트 ID'],
    )
    const changed = fields.slice(0, 8).filter((k) => row[k] !== previous?.[k])
    if (changed.length) {
      legacyDifferences.push({ id: row['이벤트 ID'], fields: changed })
    }
  }
}
const issueCounts: Record<string, number> = {}
for (const event of catalog.events) {
  for (const issue of event.mappingNotes) {
    const type = issue.split(':')[0]
    issueCounts[type] = (issueCounts[type] ?? 0) + 1
  }
}
const report = {
  sourceDigest: digest(source),
  registered: old.events.length + catalog.events.length,
  converted: catalog.events.filter((e) => e.review?.converted).length,
  executable: catalog.events.filter((e) => e.review?.executable).length,
  contentReviewed: 0,
  balanceReviewed: 0,
  activeExpansion: 0,
  activeLegacy: old.events.filter((e: { enabled: boolean }) => e.enabled).length,
  sourceComparison: {
    archive: 'seeds/archives/events.expansion.csv-snapshot-2026-10-14.json',
    archivedDigest: digest(archived),
    scope: source.snapshot ?? 'Supplied CSV properties only; Notion body approval not verified',
    compared: source.rows.length,
    changed: sourceChanges.length,
    changes: sourceChanges,
  },
  missingRiskOutcomes:
    'Revised source text contains risk proposals, but no approved structured four-outcome mapping. Unsupported choices remain inactive; no risk effects are inferred.',
  issueCounts,
  legacyDifferences,
  issues: catalog.events
    .filter((e) => e.mappingNotes.length)
    .map((e) => ({
      id: e.id,
      conditions: e.source.conditionText,
      effects: e.source.effectText,
      issues: e.mappingNotes,
    })),
  groups: [...groups]
    .filter(([, ids]) => ids.length > 1)
    .map(([groupId, ids]) => ({ groupId, ids, representativeId: null })),
  repeatedRules: [...duplicates]
    .filter(([, ids]) => ids.length > 1)
    .map(([ruleDigest, ids]) => ({ ruleDigest, ids })),
}
if (input) {
  await writeFile('seeds/events.expansion.source.json', JSON.stringify(source, null, 2) + '\n')
}
await writeFile('seeds/events.expansion.catalog.json', JSON.stringify(catalog, null, 2) + '\n')
await writeFile('reports/event-expansion.json', JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify({
    ...report,
    issues: report.issues.length,
    groups: report.groups.length,
    repeatedRules: report.repeatedRules.length,
    sourceComparison: { compared: report.sourceComparison.compared, changed: sourceChanges.length },
  }),
)
