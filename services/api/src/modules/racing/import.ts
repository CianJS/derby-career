import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import type { Database } from '../../db'
import { digest, normalizeRacingCatalog } from './catalog'

export async function readRacingSource(paths: string[]): Promise<unknown> {
  if (paths.length === 1 && paths[0].endsWith('.json')) {
    return JSON.parse(await readFile(paths[0], 'utf8'))
  }
  if (paths.length !== 3 || !paths.every((p) => p.endsWith('.csv'))) {
    throw new Error('Supply one Notion JSON packet or three CSV files: racecourses courses races')
  }
  const [racecourses, courses, races] = await Promise.all(
    paths.map(
      async (p) =>
        parse(await readFile(p, 'utf8'), {
          columns: true,
          bom: true,
          skip_empty_lines: true,
        }) as Record<string, string>[],
    ),
  )
  // Notion CSV uses visible property names and numeric cells as text.
  const numeric = new Set([
    '1주 길이 m',
    '결승 직선 m',
    '폭 최소 m',
    '폭 최대 m',
    '고저차 m',
    '기준연도',
    '거리(m)',
    '공식 상금액',
    '최대 출전두수',
    '게임 1착상금 KRW',
    '게임 등록비 KRW',
  ])
  const rows = (input: Record<string, string>[]) =>
    input.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([key, raw]) => {
          const k = key === '실제 개최일' ? 'date:실제 개최일:start' : key
          if (numeric.has(key) && raw.trim() !== '') {
            if (!/^\d+(?:,\d{3})*(?:\.\d+)?$/.test(raw.trim())) {
              throw new Error(`Invalid numeric CSV field: ${key}=${raw}`)
            }
            return [k, Number(raw.replaceAll(',', ''))]
          }
          return [k, numeric.has(key) ? '' : raw]
        }),
      ),
    )
  return {
    sourceVersion: 1,
    capturedAt: new Date().toISOString().slice(0, 10),
    racecourses: rows(racecourses),
    courses: rows(courses),
    races: rows(races),
  }
}

export async function importRacingCatalog(db: Database, input: unknown) {
  const counts = { created: 0, updated: 0, unchanged: 0, needsReview: 0, failed: 0 }
  try {
    // Validate the entire batch before any write. A partial export never deletes existing rows.
    const catalog = normalizeRacingCatalog(input)
    const result = await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('racing-reference-import-v1'))")
      const totals = { ...counts }
      const entities = [
        { table: 'racecourses', rows: catalog.racecourses, source: catalog.source.racecourses },
        { table: 'racecourse_courses', rows: catalog.courses, source: catalog.source.courses },
        { table: 'race_schedules', rows: catalog.races, source: catalog.source.races },
      ]
      for (const entity of entities) {
        for (const [index, record] of entity.rows.entries()) {
          const source = entity.source[index]
          const hash = digest({ record, source })
          const previous = (
            await tx.query(`SELECT source_hash FROM ${entity.table} WHERE id=$1`, [record.id])
          ).rows[0]
          if (previous?.source_hash === hash) {
            totals.unchanged++
          } else {
            const columns = ['id', 'payload', 'source_row', 'source_hash']
            const values: unknown[] = [
              record.id,
              JSON.stringify(record),
              JSON.stringify(source),
              hash,
            ]
            if ('racecourseId' in record) {
              columns.push('racecourse_id')
              values.push(record.racecourseId)
            }
            if ('raceDate' in record) {
              columns.push('course_id', 'race_date')
              values.push(record.courseId, record.raceDate)
            }
            const assignments = columns
              .slice(1)
              .map((c) => `${c}=EXCLUDED.${c}`)
              .join(',')
            await tx.query(
              `INSERT INTO ${entity.table} (${columns.join(',')}) VALUES (${values.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (id) DO UPDATE SET ${assignments},updated_at=now()`,
              values,
            )
            totals[previous ? 'updated' : 'created']++
          }
          if (record.reviewIssues.length || record.verificationStatus !== 'verified') {
            totals.needsReview++
          }
        }
      }
      return totals
    })
    return {
      ...result,
      committed: true,
      racecourses: catalog.racecourses.length,
      courses: catalog.courses.length,
      races: catalog.races.length,
      countries: Object.fromEntries(
        ['KOR', 'JPN', 'USA'].map((country) => [
          country,
          catalog.races.filter((r) => r.country === country).length,
        ]),
      ),
    }
  } catch (error) {
    // No successful writes are reported after rollback. CLI exits nonzero with this report.
    return {
      ...counts,
      failed: 1,
      committed: false,
      error: error instanceof Error ? error.message : 'Catalog import failed',
    }
  }
}
