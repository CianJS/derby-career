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
        assert.ok(validateRaceSchedule(await client.getRaceSchedule('RACE_KOR_2026_KOREA_CUP')))
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
