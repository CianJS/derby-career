import {
  referenceRacePlayability,
  referenceRaceReport,
} from '../../../packages/shared/src/race-playability'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fixture } from './helpers'
import type { Query } from '../src/db'
import { normalizeRacingCatalog, digest } from '../src/modules/racing/catalog'
import { importRacingCatalog, readRacingSource } from '../src/modules/racing/import'
import { createApiClient } from '../../../packages/shared/src/client'
import { sapporoPilot } from '../../../packages/shared/src/sapporo-pilot'
import {
  validateRacecourseList,
  validateRacecourseDetail,
  validateRaceScheduleList,
  validateRaceSchedule,
} from '../../../packages/shared/src/generated/save-validation.mjs'
const source = () => readRacingSource(['seeds/racing.notion.source.json'])
test('Notion snapshot preserves every source ID, parent and reviewed exception', async () => {
  const catalog = normalizeRacingCatalog(await source())
  const generated = JSON.parse(await readFile('seeds/racing.catalog.json', 'utf8'))
  const report = JSON.parse(await readFile('reports/racing-catalog.json', 'utf8'))
  assert.equal(report.sourceDigest, digest(catalog.source))
  assert.equal(report.counts.races, 851)
  assert.deepEqual(generated, {
    racecourses: catalog.racecourses,
    courses: catalog.courses,
    races: catalog.races,
  })
  assert.equal(catalog.racecourses.length, 90)
  assert.equal(catalog.courses.length, 101)
  assert.equal(catalog.races.length, 851)
  const sapporo = catalog.races.find((r) => r.id === sapporoPilot.source.id)!
  const course = catalog.courses.find((c) => c.id === sapporoPilot.courseModel.id)!
  assert.equal(digest(sapporo), sapporoPilot.source.digest)
  assert.equal(digest(course), sapporoPilot.courseModel.digest)
  assert.equal(sapporo.courseId, null)
  assert.equal(sapporo.maxRunners, null)
  assert.equal(sapporo.prizeMoney, sapporoPilot.source.firstPrizeJPY)
  assert.equal(sapporoPilot.state, 'candidate')
  assert.equal(sapporoPilot.courseModel.actual2026Rail, 'unconfirmed')
  assert.deepEqual(
    ['KOR', 'JPN', 'USA'].map((c) => catalog.races.filter((r) => r.country === c).length),
    [51, 176, 624],
  )
  assert.equal(catalog.races.filter((r) => r.gradeSystem === 'JRA').length, 130)
  assert.equal(catalog.races.filter((r) => r.gradeSystem === 'NAR').length, 46)
  assert.equal(catalog.races.filter((r) => r.id.includes('_TOBA_')).length, 622)
  assert.deepEqual(
    catalog.races.map((r) => r.id),
    catalog.source.races.map((r) => r['경주 ID']),
  )
  assert.equal(catalog.races.filter((r) => r.raceDate === null).length, 41)
  assert.equal(catalog.races.filter((r) => r.scheduleStatus === 'not_run').length, 18)
  assert.equal(new Set(catalog.races.map((r) => r.duplicateGroup).filter(Boolean)).size, 3)
  assert.equal(catalog.races.filter((r) => r.duplicateGroup).length, 6)
  assert.ok(catalog.courses.every((c) => catalog.racecourses.some((r) => r.id === c.racecourseId)))
  assert.ok(
    [...catalog.racecourses, ...catalog.courses, ...catalog.races].every(
      (r) => r.gameEnabled === false,
    ),
  )
  assert.ok(
    catalog.races.every((r) => r.courseId === null && r.entryEligibility === 'not_evaluated'),
  )
  const cup = catalog.races.find((r) => r.id === 'RACE_KOR_2026_KOREA_CUP')!
  assert.equal(cup.grade, 'G1')
  assert.equal(cup.internationalGrade, 'IGⅡ')
  assert.equal(cup.prizeMoney, 1600000000)
  assert.equal(cup.gamePrizeMoney, null)
  assert.ok(catalog.races.some((r) => r.originalGrade === 'LR' && r.grade === 'Listed'))
  assert.ok(
    catalog.races
      .filter((r) => r.gradeSystem === 'NAR')
      .every((r) => r.grade === '기타' && r.prizeMoney === null),
  )
  const original = structuredClone(catalog.source)
  original.races[0]['게임 활성'] = '__YES__'
  assert.equal(normalizeRacingCatalog(original).races[0].gameEnabled, false)
  for (const mutate of [
    (p: typeof original) => {
      p.races.push(p.races[0])
    },
    (p: typeof original) => {
      p.races[0]['경마장'] = '["RC_MISSING"]'
    },
    (p: typeof original) => {
      p.races[0]['거리(m)'] = -1
    },
    (p: typeof original) => {
      p.races[0]['date:실제 개최일:start'] = '2026-02-30'
    },
    (p: typeof original) => {
      p.courses[0]['폭 최소 m'] = 99999
    },
  ]) {
    const invalid = structuredClone(catalog.source)
    mutate(invalid)
    assert.throws(() => normalizeRacingCatalog(invalid))
  }
})

test('three CSV exports preserve numeric, date and explicit relation fields without inference', async () => {
  const packet = normalizeRacingCatalog(await source()).source
  const directory = await mkdtemp(join(tmpdir(), 'derby-racing-'))
  try {
    const paths: string[] = []
    for (const [name, rows] of Object.entries({
      racecourses: packet.racecourses,
      courses: packet.courses,
      races: packet.races,
    })) {
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
      const cell = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
      const text = [
        keys.map((k) => cell(k === 'date:실제 개최일:start' ? '실제 개최일' : k)).join(','),
        ...rows.map((r) => keys.map((k) => cell(r[k])).join(',')),
      ].join('\n')
      const path = join(directory, name + '.csv')
      paths.push(path)
      await writeFile(path, '\uFEFF' + text)
    }
    const csv = normalizeRacingCatalog(await readRacingSource(paths))
    assert.deepEqual(csv.racecourses, normalizeRacingCatalog(packet).racecourses)
    assert.deepEqual(csv.courses, normalizeRacingCatalog(packet).courses)
    assert.deepEqual(csv.races, normalizeRacingCatalog(packet).races)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('catalog SQL import, public reads and protected game state', async (t) => {
  const f = await fixture()
  try {
    const input = await source()
    const legacy = (await f.call('GET', '/v1/catalog/races')).json()
    assert.equal(legacy.data.length, 19)
    const career = await f.create()
    const before = (await f.call('GET', `/v1/careers/${career.id}`)).json()
    await t.test('transactional first import and idempotent replay', async () => {
      const first = await importRacingCatalog(f.db, input)
      assert.equal(first.committed, true, JSON.stringify(first))
      assert.equal(first.created, 1042)
      assert.equal(first.failed, 0)
      const repeat = await importRacingCatalog(f.db, input)
      assert.equal(repeat.created, 0)
      assert.equal(repeat.updated, 0)
      assert.equal(repeat.unchanged, 1042)
      assert.deepEqual((await f.call('GET', '/v1/catalog/races')).json(), legacy)
      assert.deepEqual((await f.call('GET', `/v1/careers/${career.id}`)).json(), before)
    })
    await t.test(
      'validation and mid-write failure both preserve the previous catalog',
      async () => {
        const catalog = normalizeRacingCatalog(input)
        const broken = structuredClone(catalog.source)
        broken.races[0]['경주 ID'] = 'bad'
        assert.equal((await importRacingCatalog(f.db, broken)).committed, false)
        const changed = structuredClone(catalog.source)
        changed.racecourses[0]['경마장'] = '수정 테스트'
        changed.racecourses[1]['경마장'] = '실패 테스트'
        let writes = 0
        const faulty = {
          ...f.db,
          transaction: <T>(fn: (tx: Query) => Promise<T>) =>
            f.db.transaction((tx) =>
              fn({
                query: async (sql, params) => {
                  if (sql.startsWith('INSERT INTO') && ++writes === 2) {
                    throw new Error('Injected write failure')
                  }
                  return tx.query(sql, params)
                },
              }),
            ),
        }
        const failed = await importRacingCatalog(faulty, changed)
        assert.equal(failed.committed, false)
        assert.equal(failed.created + failed.updated, 0)
        assert.equal((await importRacingCatalog(f.db, input)).unchanged, 1042)
        const good = structuredClone(catalog.source)
        good.racecourses[0]['도시'] = '수정 검증'
        assert.equal((await importRacingCatalog(f.db, good)).updated, 1)
        assert.equal((await importRacingCatalog(f.db, input)).updated, 1)
        await assert.rejects(
          f.db.query("UPDATE race_schedules SET payload=jsonb_set(payload,'{gameEnabled}','true')"),
        )
        await assert.rejects(
          f.db.query("UPDATE racecourses SET payload=jsonb_set(payload,'{gameEnabled}','true')"),
        )
        await assert.rejects(
          f.db.query(
            "UPDATE racecourse_courses SET payload=jsonb_set(payload,'{gameEnabled}','true')",
          ),
        )
        assert.equal((await importRacingCatalog(f.db, input)).unchanged, 1042)
      },
    )
    await t.test(
      'public endpoints, generated validators, client and facilities without a course',
      async () => {
        const client = createApiClient({
          baseUrl: 'http://localhost',
          getSessionToken: () => {
            throw new Error('Public request must not use a token')
          },
          fetch: async (url) => {
            const response = await f.app.inject({
              method: 'GET',
              url: new URL(String(url)).pathname + new URL(String(url)).search,
            })
            return new Response(response.body, { status: response.statusCode })
          },
        })
        const venues = await client.listRacecourses({ pageSize: 100 })
        assert.ok(validateRacecourseList(venues))
        assert.equal(venues.pagination.total, 90)
        const venue = await client.getRacecourse('RC_KOR_SEOUL')
        assert.ok(validateRacecourseDetail(venue))
        assert.ok(venue.courses.length > 0)
        const noCourse = normalizeRacingCatalog(input).racecourses.find(
          (r) => !normalizeRacingCatalog(input).courses.some((c) => c.racecourseId === r.id),
        )!
        assert.deepEqual((await client.getRacecourse(noCourse.id)).courses, [])
        const list = await client.listRaceSchedule({ country: 'KOR' })
        assert.ok(validateRaceScheduleList(list))
        assert.equal(list.pagination.total, 51)
        const detail = await client.getRaceSchedule('RACE_KOR_2026_KOREA_CUP')
        assert.ok(validateRaceSchedule(detail))
        assert.deepEqual(detail.playability, referenceRacePlayability(detail))
        assert.ok(list.data.every((r) => r.playability?.eligible === false))
      },
    )
    await t.test('combined filters and literal search are applied before counting', async () => {
      const response = await f.call(
        'GET',
        '/v1/race-schedule?country=KOR&year=2026&month=9&racecourseId=RC_KOR_SEOUL&grade=G1&surface=sand&minDistance=1200&maxDistance=1800&verificationStatus=verified',
      )
      assert.equal(response.statusCode, 200, response.body)
      assert.deepEqual(
        response
          .json()
          .data.map((r: { id: string }) => r.id)
          .sort(),
        ['RACE_KOR_2026_KOREA_CUP', 'RACE_KOR_2026_KOREA_SPRINT'],
      )
      assert.equal(response.json().pagination.total, 2)
      for (const term of ['%', '_', "'; DROP TABLE race_schedules; --"]) {
        assert.equal(
          (await f.call('GET', '/v1/race-schedule?search=' + encodeURIComponent(term))).json()
            .pagination.total,
          0,
        )
      }
      const unraced = (
        await f.call('GET', '/v1/race-schedule?scheduleStatus=not_run&pageSize=100')
      ).json()
      assert.equal(unraced.pagination.total, 18)
      assert.ok(unraced.data.every((r: { raceDate: unknown }) => r.raceDate === null))
    })
    await t.test(
      'date/id ordering is stable across all pages, with 39 undated distinct records last',
      async () => {
        const ids: string[] = []
        const dates: (string | null)[] = []
        for (let page = 1; page <= 9; page++) {
          const result = (await f.call('GET', `/v1/race-schedule?pageSize=100&page=${page}`)).json()
          assert.equal(result.pagination.total, 848)
          ids.push(...result.data.map((r: { id: string }) => r.id))
          dates.push(...result.data.map((r: { raceDate: string | null }) => r.raceDate))
        }
        assert.equal(new Set(ids).size, 848)
        assert.ok(dates.slice(0, 809).every(Boolean))
        assert.ok(dates.slice(809).every((d) => d === null))
        const expected = normalizeRacingCatalog(input)
          .races.sort(
            (a, b) =>
              (a.raceDate ?? '9999').localeCompare(b.raceDate ?? '9999') || (a.id < b.id ? -1 : 1),
          )
          .filter(
            (race, index, rows) =>
              !race.duplicateGroup ||
              rows.findIndex((candidate) => candidate.duplicateGroup === race.duplicateGroup) ===
                index,
          )
          .map((r) => r.id)
        assert.deepEqual(ids, expected)
        const duplicateGroups = normalizeRacingCatalog(input).races.filter((r) => r.duplicateGroup)
        assert.equal(duplicateGroups.length, 6)
        assert.equal(new Set(ids.filter((id) => duplicateGroups.some((r) => r.id === id))).size, 3)
      },
    )
    await t.test('invalid queries and missing IDs have explicit errors', async () => {
      for (const query of [
        'page=0',
        'page=-1',
        'page=1.5',
        'page=NaN',
        'pageSize=101',
        'month=13',
        'year=abc',
        'country=CAN',
        'minDistance=-1',
        'minDistance=2000&maxDistance=1000',
        'unknown=x',
        'grade=Jpn1',
        'surface=ice',
        'page=1&page=2',
        'search=%20',
      ]) {
        assert.equal((await f.call('GET', '/v1/race-schedule?' + query)).statusCode, 400, query)
      }
      for (const path of ['/v1/racecourses/RC_MISSING', '/v1/race-schedule/RACE_MISSING']) {
        assert.equal((await f.call('GET', path)).statusCode, 404)
      }
      assert.equal((await f.call('GET', '/v1/racecourses?country=CAN')).statusCode, 400)
    })
    await t.test('a stored v3 log survives import and completion pays only once', async () => {
      for (let turn = 1; turn <= 2; turn++) {
        const actionId = randomUUID()
        assert.equal(
          (
            await f.call('POST', `/v1/careers/${career.id}/actions`, {
              actionId,
              choice: 'rest',
              expectedTurn: turn,
            })
          ).statusCode,
          200,
        )
        assert.equal(
          (
            await f.call('POST', `/v1/careers/${career.id}/months/advance`, {
              commandId: randomUUID(),
              actionId,
              expectedTurn: turn,
            })
          ).statusCode,
          200,
        )
      }
      const forbidden = await f.call('POST', `/v1/careers/${career.id}/race-entries`, {
        raceRunId: randomUUID(),
        raceDefinitionId: 'RACE_KOR_2026_KOREA_CUP',
        jockeyId: 'SEO_JIAN',
        tactic: '선입',
        expectedTurn: 3,
      })
      assert.equal(forbidden.statusCode, 422)
      const runId = randomUUID()
      const entry = await f.call('POST', `/v1/careers/${career.id}/race-entries`, {
        raceRunId: runId,
        raceDefinitionId: 'DEV_M3_MILE_1600',
        jockeyId: 'SEO_JIAN',
        tactic: '선입',
        expectedTurn: 3,
      })
      assert.equal(entry.statusCode, 200, entry.body)
      const path = `/v1/careers/${career.id}/race-runs/${runId}`
      const log = (await f.call('GET', path + '/log')).body
      assert.equal((await importRacingCatalog(f.db, input)).unchanged, 1042)
      assert.equal((await f.call('GET', path + '/log')).body, log)
      const first = await f.call('POST', path + '/complete', { commandId: randomUUID() })
      const repeat = await f.call('POST', path + '/complete', { commandId: randomUUID() })
      assert.equal(first.statusCode, 200, first.body)
      assert.equal(repeat.statusCode, 200, repeat.body)
      assert.deepEqual(first.json().career, repeat.json().career)
      assert.equal(repeat.json().career.state.careerTurnIndex, 4)
      assert.equal((await f.call('GET', '/v1/catalog/races')).json().data.length, 19)
    })
  } finally {
    await f.close()
  }
})

test('reference playability audits all 851 rows without inferring rules or changing snapshots', async () => {
  const { races } = normalizeRacingCatalog(await source())
  const before = digest(races)
  const report = referenceRaceReport(races)
  assert.equal(report.referenceRows, 851)
  assert.equal(report.publicDistinctRows, 848)
  assert.equal(report.playable, 0)
  assert.equal(report.reasonCounts.game_economy_unapproved, 851)
  assert.equal(report.reasonCounts.course_unassigned, 851)
  assert.equal(report.reasonCounts.duplicate_review, 6)
  assert.equal(report.reasonCounts.not_run, 18)
  assert.equal(report.reasonCounts.date_unconfirmed, 41)
  for (const race of races) {
    const state = referenceRacePlayability(race)
    assert.equal(state.sourceRaceId, race.id)
    assert.equal(state.sourceYear, 2026)
    assert.equal(state.raceDefinitionId, null)
    assert.equal(state.eligible, false)
    assert.equal(state.calendarPolicy, 'not_approved')
  }
  assert.equal(digest(races), before)
  assert.throws(() => referenceRaceReport([...races, races[0]]))
  const stored = JSON.parse(await readFile('reports/race-playability.json', 'utf8'))
  assert.deepEqual(stored, { sourceDigest: digest(await source()), ...report })
})

test('mapping candidates are reproducible, inactive, hash-pinned and cannot turn fixtures into official races', async () => {
  const { buildRaceMappingReport, inspectRaceMapping } =
    await import('../src/modules/racing/mapping')
  const { raceMappingRegistry } = await import('../../../packages/shared/src/race-mapping')
  const catalog = normalizeRacingCatalog(await source())
  const before = digest(catalog)
  const report = buildRaceMappingReport(catalog.races, catalog.courses)
  assert.deepEqual(
    report,
    JSON.parse(await readFile('reports/race-mapping-candidates.json', 'utf8')),
  )
  assert.equal(report.referenceRows, 851)
  assert.equal(report.publicDistinctRows, 848)
  assert.equal(report.verifiedSources, 669)
  assert.equal(report.missingSourceFacts, 851)
  assert.equal(report.playable, 0)
  assert.equal(report.approvedMappings, 0)
  assert.equal(report.existingGameDefinitions.length, 19)
  assert.equal(report.candidates.length, 851)
  assert.equal(new Set(report.candidates.map((c) => c.mapping.referenceId)).size, 851)
  for (const candidate of report.candidates) {
    const ref = catalog.races.find((r) => r.id === candidate.mapping.referenceId)!
    assert.equal(candidate.mapping.state, 'candidate')
    assert.equal(candidate.mapping.gameDefinitionId, null)
    assert.equal(candidate.mapping.sourceDigest, digest(ref))
    assert.equal(candidate.decisionsRequired.length, 13)
    assert.ok(candidate.validationReasons.includes('mapping_not_approved'))
    assert.deepEqual(candidate.matchingGameDefinitions, [])
    assert.ok(
      inspectRaceMapping({ ...candidate.mapping, state: 'approved' }, ref, null, null).reasons
        .length > 0,
    )
  }
  assert.equal(raceMappingRegistry.activation, 'disabled')
  assert.equal(raceMappingRegistry.mappings.length, 0)
  assert.ok(Object.isFrozen(raceMappingRegistry) && Object.isFrozen(raceMappingRegistry.mappings))
  assert.equal(digest(catalog), before)
})

test('approved mapping verifier rejects stale provenance, partial decisions and cross-mode rule divergence', async () => {
  const {
    mappingSourceFacts,
    validateRaceMapping,
    validateMappingRegistry,
    previewMappedEntry,
    mappingDecisionFields,
  } = await import('../../../packages/shared/src/race-mapping')
  const { inspectRaceMapping } = await import('../src/modules/racing/mapping')
  const { startCareer, raceDefinitions, commitAction } =
    await import('../../../packages/shared/src/domain')
  const catalog = normalizeRacingCatalog(await source())
  // Entirely synthetic approval proof. Never registered in the compiled registry or database.
  const ref = {
    ...catalog.races[0],
    id: 'RACE_TEST_2026',
    name: '매핑 검증 전용',
    year: 2026,
    raceDate: '2026-03-01',
    scheduleStatus: 'dated' as const,
    country: 'KOR' as const,
    racecourseId: 'RC_TEST',
    // Match the actual normalized catalog: approval must not rewrite source nulls.
    courseId: null,
    grade: 'Listed' as const,
    surface: 'turf' as const,
    distanceMeters: 1400,
    distanceBasis: 'source_meters' as const,
    ageCondition: '2세 이상',
    sexCondition: null,
    originalEligibility: '2세 이상',
    maxRunners: 10,
    entryFee: null,
    gamePrizeMoney: null,
    duplicateGroup: null,
    verificationStatus: 'verified' as const,
    sourceUrl: 'https://example.invalid/official-test',
  }
  const course = {
    ...catalog.courses[0],
    id: 'COURSE_TEST',
    racecourseId: 'RC_TEST',
    surface: 'turf' as const,
    verificationStatus: 'verified' as const,
    configuration: '표준',
    direction: 'left',
    straightLength: 300,
    sourceUrl: 'https://example.invalid/course-test',
  }
  const game = {
    ...raceDefinitions[0],
    id: 'GAME_TEST_1400',
    name: ref.name,
    countryCode: 'KOR',
    month: 3,
    raceClass: 'Listed' as const,
    minWins: 0,
    maxWins: undefined,
    prize: 8000000,
    entryFee: 500000,
  }
  const body = {
    version: 1 as const,
    referenceId: ref.id,
    gameDefinitionId: game.id,
    state: 'approved' as const,
    sourceDigest: digest(ref),
    source: mappingSourceFacts(ref),
    definitionDigest: digest(game),
    definition: game,
    courseId: course.id,
    courseDigest: digest(course),
    courseSnapshot: course,
    eligibility: { minAge: 2, maxAge: null, sex: 'any' as const, minWins: 0, maxWins: null },
    calendar: {
      referenceYear: 2026,
      firstGameYear: 2028 as const,
      seasonMonth: 3,
      policy: 'repeat_season_month' as const,
    },
    economy: {
      entryFee: 500000,
      firstPrize: 8000000,
      currency: 'KRW' as const,
      basis: 'game_balance' as const,
    },
    opponents: { profile: 'shared-development-v1' as const, runners: 10 },
    decisions: Object.fromEntries(
      mappingDecisionFields.map((k) => [
        k,
        {
          status: 'approved' as const,
          reference: 'https://example.invalid/test-decision',
          reviewer: 'fixture-only',
        },
      ]),
    ),
  }
  const mapping = { ...body, revision: digest(body) },
    context = { reference: ref, course, definition: game }
  assert.deepEqual(inspectRaceMapping(mapping, ref, course, game).reasons, [])
  assert.deepEqual(validateRaceMapping(mapping, context), [])
  const g3Ref = { ...ref, grade: 'G3' as const, maxRunners: null }
  const g3Game = { ...game, id: sapporoPilot.definition.id, raceClass: 'G3' as const, minAge: 2 }
  const g3Body = {
    ...body,
    source: mappingSourceFacts(g3Ref),
    sourceDigest: digest(g3Ref),
    definition: g3Game,
    gameDefinitionId: g3Game.id,
    definitionDigest: digest(g3Game),
    opponents: { profile: 'sapporo-g3-2yo-v1' as const, runners: g3Game.runners },
  }
  const g3Mapping = { ...g3Body, revision: digest(g3Body) }
  assert.deepEqual(inspectRaceMapping(g3Mapping, g3Ref, course, g3Game).reasons, [])
  assert.ok(
    validateRaceMapping(
      { ...g3Mapping, opponents: { ...g3Mapping.opponents, profile: 'shared-development-v1' } },
      { reference: g3Ref, course, definition: g3Game },
    ).includes('opponents_not_approved'),
  )
  assert.ok(
    validateRaceMapping(
      { ...g3Mapping, definition: { ...g3Game, minAge: 3 } },
      {
        reference: g3Ref,
        course,
        definition: { ...g3Game, minAge: 3 },
      },
    ).includes('age_unconfirmed'),
  )
  assert.ok(
    validateRaceMapping(g3Mapping, {
      reference: { ...g3Ref, grade: 'G1' },
      course,
      definition: g3Game,
    }).includes('grade_unsupported'),
  )
  const sourceBefore = digest(ref)
  // Re-pin all source proofs so conflicts fail on their own rule, not stale provenance.
  const inspectSource = (reference: (typeof catalog.races)[number]) => {
    const updated = {
      ...body,
      source: mappingSourceFacts(reference),
      sourceDigest: digest(reference),
    }
    return inspectRaceMapping({ ...updated, revision: digest(updated) }, reference, course, game)
  }
  assert.deepEqual(inspectSource({ ...ref, courseId: course.id }).reasons, [])
  assert.deepEqual(inspectSource({ ...ref, maxRunners: null }).reasons, [])
  assert.ok(
    inspectSource({ ...ref, maxRunners: game.runners + 1 }).reasons.includes('runners_unconfirmed'),
  )
  const noOpponentDecision = structuredClone(mapping)
  delete noOpponentDecision.decisions.opponents
  const nullRunnersRef = { ...ref, maxRunners: null }
  const nullRunnersBody = {
    ...noOpponentDecision,
    source: mappingSourceFacts(nullRunnersRef),
    sourceDigest: digest(nullRunnersRef),
  }
  assert.ok(
    validateRaceMapping(nullRunnersBody, { ...context, reference: nullRunnersRef }).includes(
      'approval_required:opponents',
    ),
  )
  assert.ok(
    inspectSource({ ...ref, courseId: 'COURSE_OTHER' }).reasons.includes(
      'course_unassigned_or_unverified',
    ),
  )
  assert.ok(
    inspectSource({ ...ref, racecourseId: 'RC_OTHER' }).reasons.includes(
      'course_unassigned_or_unverified',
    ),
  )
  const unverifiedCourse = { ...course, verificationStatus: 'unverified' as const }
  const unverifiedBody = {
    ...body,
    courseSnapshot: unverifiedCourse,
    courseDigest: digest(unverifiedCourse),
  }
  assert.ok(
    inspectRaceMapping(
      { ...unverifiedBody, revision: digest(unverifiedBody) },
      ref,
      unverifiedCourse,
      game,
    ).reasons.includes('course_unassigned_or_unverified'),
  )
  for (const entryFee of [null, game.entryFee]) {
    for (const gamePrizeMoney of [null, game.prize]) {
      assert.deepEqual(inspectSource({ ...ref, entryFee, gamePrizeMoney }).reasons, [])
    }
  }
  for (const reference of [
    { ...ref, entryFee: game.entryFee + 1 },
    { ...ref, gamePrizeMoney: game.prize + 1 },
  ]) {
    assert.ok(inspectSource(reference).reasons.includes('game_economy_source_unconfirmed'))
  }
  for (const economy of [
    null,
    { ...body.economy, entryFee: game.entryFee + 1 },
    { ...body.economy, firstPrize: game.prize + 1 },
    { ...body.economy, firstPrize: ref.prizeMoney ?? 1600000000 },
  ]) {
    const updated = { ...body, economy }
    assert.ok(
      inspectRaceMapping(
        { ...updated, revision: digest(updated) },
        ref,
        course,
        game,
      ).reasons.includes('game_economy_unapproved'),
    )
  }
  const purseBody = { ...body, economy: { ...body.economy, basis: 'official_total' } }
  assert.ok(
    inspectRaceMapping(
      { ...purseBody, revision: digest(purseBody) },
      ref,
      course,
      game,
    ).reasons.includes('mapping_schema_invalid'),
  )
  for (const reference of [
    { ...ref, courseId: course.id },
    { ...ref, entryFee: game.entryFee },
    { ...ref, gamePrizeMoney: game.prize },
  ]) {
    const reasons = inspectRaceMapping(mapping, reference, course, game).reasons
    assert.ok(reasons.includes('reference_changed'))
    assert.ok(reasons.includes('source_digest_changed'))
  }
  assert.equal(digest(ref), sourceBefore)
  for (const field of mappingDecisionFields) {
    const altered = structuredClone(mapping)
    delete altered.decisions[field]
    assert.ok(validateRaceMapping(altered, context).includes('approval_required:' + field))
  }
  const wrongGame = { ...game, prize: ref.prizeMoney ?? 1600000000 }
  assert.ok(
    validateRaceMapping(mapping, { ...context, definition: wrongGame }).includes(
      'game_definition_changed',
    ),
  )
  assert.ok(
    validateRaceMapping(mapping, { ...context, reference: { ...ref, year: 2027 } }).includes(
      'reference_changed',
    ),
  )
  assert.ok(
    validateRaceMapping(mapping, { ...context, course: null }).includes(
      'course_unassigned_or_unverified',
    ),
  )
  assert.ok(
    inspectRaceMapping(
      { ...mapping, sourceDigest: '0'.repeat(64) },
      ref,
      course,
      game,
    ).reasons.includes('source_digest_changed'),
  )
  assert.ok(
    inspectRaceMapping({ ...mapping, definition: { id: 12 } }, ref, course, game).reasons.includes(
      'definition_schema_invalid',
    ),
  )
  assert.ok(
    inspectRaceMapping({ ...mapping, unexpected: true }, ref, course, game).reasons.includes(
      'mapping_schema_invalid',
    ),
  )
  assert.ok(
    inspectRaceMapping(
      { ...mapping, revision: '0'.repeat(64) },
      ref,
      course,
      game,
    ).reasons.includes('mapping_revision_changed'),
  )
  assert.ok(
    validateMappingRegistry([mapping, mapping], [context])[0].reasons.includes(
      'duplicate_reference_mapping',
    ),
  )
  assert.ok(
    validateMappingRegistry([mapping], [context, context])[0].reasons.includes(
      'ambiguous_reference_context',
    ),
  )
  assert.ok(
    inspectRaceMapping(mapping, ref, { ...course, straightLength: 301 }, game).reasons.includes(
      'course_definition_changed',
    ),
  )
  const career = startCareer('DEV_HORSE_RED_COMET', { starterJockeyId: 'HAN_DOYUN' })
  const travel = {
    homeCountry: 'KOR' as const,
    locationCountry: 'KOR' as const,
    revision: 0,
    activeExpedition: null,
  }
  for (const turn of [3, 15, 63]) {
    const state = { ...career, month: turn, careerTurnIndex: turn }
    const local = await previewMappedEntry(mapping, context, state, 500000, travel, 'HAN_DOYUN')
    // Server rows use the same shared snapshot and rules after ownership/pending checks.
    const server = await previewMappedEntry(
      structuredClone(mapping),
      structuredClone(context),
      structuredClone(state),
      500000,
      structuredClone(travel),
      'HAN_DOYUN',
    )
    assert.deepEqual(local, server)
    assert.equal(local.reason, null)
    assert.equal(local.race!.month, turn)
    assert.equal(
      (await previewMappedEntry(mapping, context, state, 499999, travel, 'HAN_DOYUN')).reason,
      '마방 자금이 부족하여 등록비를 낼 수 없습니다.',
    )
    assert.equal(
      (await previewMappedEntry(mapping, context, state, 500000, travel, 'MISSING')).reason,
      'jockey_not_contracted',
    )
    assert.equal(
      (
        await previewMappedEntry(
          mapping,
          context,
          { ...state, health: '중상' },
          500000,
          travel,
          'HAN_DOYUN',
        )
      ).reason,
      'health_restricted',
    )
    assert.equal(
      (
        await previewMappedEntry(
          mapping,
          context,
          commitAction(state, 'rest'),
          500000,
          travel,
          'HAN_DOYUN',
        )
      ).reason,
      'monthly_action_locked',
    )
    assert.notEqual(
      (
        await previewMappedEntry(
          mapping,
          context,
          state,
          500000,
          { ...travel, locationCountry: 'USA' },
          'HAN_DOYUN',
        )
      ).reason,
      null,
    )
  }
  assert.equal(
    (
      await previewMappedEntry(
        mapping,
        context,
        { ...career, month: 4, careerTurnIndex: 4 },
        500000,
        travel,
        'HAN_DOYUN',
      )
    ).reason,
    'not_current_season_month',
  )
  const ageRef = { ...ref, ageCondition: '3세', originalEligibility: '3세' }
  const ageBody = {
    ...mapping,
    sourceDigest: digest(ageRef),
    source: mappingSourceFacts(ageRef),
    eligibility: { ...mapping.eligibility, minAge: 3, maxAge: 3 },
  }
  const { revision: _oldAgeRevision, ...ageRevisionBody } = ageBody
  const ageRestricted = { ...ageRevisionBody, revision: digest(ageRevisionBody) }
  assert.equal(
    (
      await previewMappedEntry(
        ageRestricted,
        { ...context, reference: { ...ref, ageCondition: '3세', originalEligibility: '3세' } },
        { ...career, month: 63, careerTurnIndex: 63 },
        500000,
        travel,
        'HAN_DOYUN',
      )
    ).reason,
    'age_restricted',
  )
  assert.equal(
    (
      await previewMappedEntry(
        { ...mapping, revision: '0'.repeat(64) },
        context,
        { ...career, month: 3, careerTurnIndex: 3 },
        500000,
        travel,
        'HAN_DOYUN',
      )
    ).reason,
    'mapping_provenance_changed',
  )
  assert.equal(
    (
      await previewMappedEntry(
        mapping,
        context,
        { ...career, calendarDate: { year: 2027, month: 3 }, month: 3, careerTurnIndex: 3 },
        500000,
        travel,
        'HAN_DOYUN',
      )
    ).reason,
    'game_calendar_year_restricted',
  )
  assert.equal(raceDefinitions.length, 17)
})
