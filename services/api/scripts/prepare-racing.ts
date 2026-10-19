import { writeFile } from 'node:fs/promises'
import { normalizeRacingCatalog, digest } from '../src/modules/racing/catalog'
import { readRacingSource } from '../src/modules/racing/import'
const paths = process.argv.slice(2)
const catalog = normalizeRacingCatalog(
  await readRacingSource(paths.length ? paths : ['seeds/racing.notion.source.json']),
)
const { source, racecourses, courses, races } = catalog
// The persisted packet uses stable catalog relations, without private Notion page identities.
const sanitize = (row: Record<string, unknown>, racecourseId?: string) => {
  const copy = { ...row }
  delete copy.url
  delete copy.createdTime
  if (racecourseId) {
    copy['경마장'] = JSON.stringify([racecourseId])
  }
  return copy
}
const snapshot = {
  ...source,
  racecourses: source.racecourses.map((r) => {
    const copy = sanitize(r)
    delete copy['코스']
    return copy
  }),
  courses: source.courses.map((r, i) => sanitize(r, courses[i].racecourseId)),
  races: source.races.map((r, i) => sanitize(r, races[i].racecourseId)),
}
if (paths.length) {
  await writeFile('seeds/racing.notion.source.json', JSON.stringify(snapshot, null, 2) + '\n')
}
const duplicateGroups = [
  ...new Set(races.map((r) => r.duplicateGroup).filter((g) => g !== null)),
].map((group) =>
  races
    .filter((r) => r.duplicateGroup === group)
    .map((r) => ({
      id: r.id,
      name: r.name,
      raceDate: r.raceDate,
      scheduleStatus: r.scheduleStatus,
    })),
)
const report = {
  sourceDigest: digest(snapshot),
  capturedAt: source.capturedAt,
  counts: {
    racecourses: racecourses.length,
    courses: courses.length,
    races: races.length,
    dated: races.filter((r) => r.raceDate !== null).length,
    dateUnconfirmed: races.filter((r) => r.scheduleStatus === 'date_unconfirmed').length,
    notRun: races.filter((r) => r.scheduleStatus === 'not_run').length,
    gameEnabled: 0,
  },
  countries: Object.fromEntries(
    ['KOR', 'JPN', 'USA'].map((country) => [
      country,
      races.filter((r) => r.country === country).length,
    ]),
  ),
  providers: {
    KRA: races.filter((r) => r.gradeSystem === 'KRA_domestic').length,
    JRA: races.filter((r) => r.gradeSystem === 'JRA').length,
    NAR: races.filter((r) => r.gradeSystem === 'NAR').length,
    USA_TOBA_ID: races.filter((r) => r.id.includes('_TOBA_')).length,
    USA_OTHER_ID: races
      .filter((r) => r.country === 'USA' && !r.id.includes('_TOBA_'))
      .map((r) => r.id),
  },
  duplicateGroups,
  racecoursesWithoutCourses: racecourses
    .filter((r) => !courses.some((c) => c.racecourseId === r.id))
    .map((r) => r.id),
  review: [...racecourses, ...courses, ...races]
    .filter((r) => r.reviewIssues.length || r.verificationStatus !== 'verified')
    .map((r) => ({ id: r.id, verificationStatus: r.verificationStatus, issues: r.reviewIssues })),
}
await writeFile(
  'seeds/racing.catalog.json',
  JSON.stringify({ racecourses, courses, races }, null, 2) + '\n',
)
await writeFile('reports/racing-catalog.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report.counts, providers: report.providers }))
