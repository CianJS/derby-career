import { legacyRaceFixture, seedLegacyCatalog } from './legacy-race-fixture'
import test from 'node:test'
import { importRacingCatalog, readRacingSource } from '../src/modules/racing/import'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueryResultRow } from 'pg'
import { fixture } from './helpers'
import { createApp } from '../src/app'
import { migrate } from '../src/services/migrations'
import { createApiClient } from '../../../packages/shared/src/client'
import type { components } from '../../../packages/shared/src/generated/api'
import {
  validateEnterRace,
  validateCompleteRace,
  validateRaceEntryOptions,
  validateRaceEntryResponse,
  validateRaceRunResponse,
  validateRaceLogResponse,
  validateRaceCompleteResponse,
  validateCareerWorkspace,
} from '../../../packages/shared/src/generated/save-validation.mjs'
import {
  raceLogDigest,
  simulateRace,
  validateRaceLog,
  createRaceRun,
  raceDefinitions,
  contractedJockeys,
  summarizeRaceLog,
  type RaceRunInput,
  type RaceSimulationLog,
} from '../../../packages/shared/src/domain'
import { simulateRaceV3 } from '../../../lib/career/race-sim-v3'
import {
  startServerCareer,
  resolveServerAction,
  advanceServerMonth,
} from '../../../packages/shared/src/server-domain'

type Models = components['schemas']
type Fixture = Awaited<ReturnType<typeof fixture>>

async function advanceToRaceMonth(f: Fixture, id: string) {
  for (const turn of [1, 2]) {
    const actionId = randomUUID()
    const action = await f.call('POST', `/v1/careers/${id}/actions`, {
      actionId,
      choice: 'rest',
      expectedTurn: turn,
    })
    assert.equal(action.statusCode, 200, action.body)
    const next = await f.call('POST', `/v1/careers/${id}/months/advance`, {
      commandId: randomUUID(),
      actionId,
      expectedTurn: turn,
    })
    assert.equal(next.statusCode, 200, next.body)
  }
}

const entryBody = (): Models['EnterRace'] => ({
  engineVersion: 'race-sim-v3',
  raceRunId: randomUUID(),
  raceDefinitionId: 'DEV_M3_MILE_1600',
  jockeyId: 'SEO_JIAN',
  tactic: '선입',
  expectedTurn: 3,
})

function clientFor(f: Fixture) {
  return createApiClient({
    baseUrl: 'http://127.0.0.1:4000',
    getSessionToken: () => f.user.token,
    fetch: async (input, init) => {
      const url = new URL(String(input))
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((value, name) => {
        headers[name] = value
      })
      const response = await f.app.inject({
        method: init?.method === 'POST' ? 'POST' : 'GET',
        url: url.pathname + url.search,
        payload: init?.body as string | undefined,
        headers,
      })
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
}

test('fixed v3 input reproduces the same persisted JSON and digest when raw samples contain negative zero', () => {
  let state = startServerCareer('DEV_HORSE_SERENE_STEP')
  state.horse = { ...state.horse, id: '7d9632d8-18cb-4db3-b4db-52990fe706b3' }
  for (let turn = 1; turn <= 2; turn++) {
    state = resolveServerAction(state, 'rest')
    state = advanceServerMonth(state, state.action!.actionId)
  }
  const identities = [
    '6bb52167-5e94-4df5-b4a1-2292856bb635',
    '0b21527a-f041-480f-9ca2-433ae35769e9',
  ]
  const run = createRaceRun(state, raceDefinitions[1], contractedJockeys[1], '선입', () =>
    identities.shift()!,
  )
  const raw = simulateRace(run, 'race-sim-v3')
  assert.ok(
    raw.samples.some((sample) => sample.runners.some((runner) => Object.is(runner.lane, -0))),
  )
  const json = JSON.stringify(raw)
  const persisted: unknown = JSON.parse(json)
  assert.ok(validateRaceLogResponse({ log: persisted }))
  validateRaceLog(persisted, { ...run, simulation: summarizeRaceLog(raw) })
  assert.equal(raceLogDigest(raw), '1ctenlc')
  assert.equal(raceLogDigest(persisted), raceLogDigest(raw))
  assert.equal(JSON.stringify(persisted), json)
  assert.equal(JSON.stringify(simulateRaceV3(run)), json)
})

test('explicit v3 API data validates and fits playback types; restart and catalogue changes reuse the exact saved log', async () => {
  const f = await fixture()
  try {
    await f.db.query("UPDATE event_definitions SET enabled=(id='COM-0034')")
    const { id } = await f.create()
    await advanceToRaceMonth(f, id)
    const api = clientFor(f)
    const options = await api.getRaceEntryOptions(id)
    assert.ok(validateRaceEntryOptions(options))
    assert.equal(options.defaultEngineVersion, 'race-sim-v4')
    assert.equal(options.restrictionReason, null)
    assert.equal(options.races.filter((race) => race.eligible).length, 3)
    assert.deepEqual(await api.getRaceEntryOptions(id), options)
    assert.equal(
      (await f.db.query('SELECT * FROM race_runs WHERE career_id=$1', [id])).rows.length,
      0,
    )
    const body = entryBody()
    assert.ok(validateEnterRace(body))
    const entered = await api.enterRace(id, body)
    assert.ok(validateRaceEntryResponse(entered))
    assert.deepEqual(await api.enterRace(id, body), entered)
    const details = await api.getRaceRun(id, body.raceRunId)
    const stored = await api.getRaceLog(id, body.raceRunId)
    assert.ok(validateRaceRunResponse(details))
    assert.ok(validateRaceLogResponse(stored))
    assert.equal(validateEnterRace({ ...body, engineVersion: 'race-sim-v5' }), false)
    assert.equal(
      validateRaceLogResponse({ log: { ...stored.log, engineVersion: 'race-sim-v5' } }),
      false,
    )
    const badPair = structuredClone(details)
    badPair.raceRun.player.horseSnapshot.aptitude[0].push('extra')
    assert.equal(validateRaceRunResponse(badPair), false)
    // Compile-time assignments also protect the current playback component's domain data shapes.
    const run: RaceRunInput = details.raceRun
    const log: RaceSimulationLog = stored.log
    validateRaceLog(log, run)
    assert.equal(details.metadata.engineVersion, 'race-sim-v3')
    assert.equal(run.engineVersion, 'entry-contract-v1')
    assert.equal(run.simulation?.engineVersion, 'race-sim-v3')
    assert.equal(details.metadata.digest, raceLogDigest(log))
    assert.equal(details.metadata.byteLength, Buffer.byteLength(JSON.stringify(log)))
    // Compare the exact persisted wire representation: JSON represents both -0 and 0 as 0.
    assert.equal(JSON.stringify(simulateRace(run, 'race-sim-v3')), JSON.stringify(log))
    assert.equal(JSON.stringify(simulateRaceV3(run)), JSON.stringify(log))

    for (const change of [
      { tactic: '도주' },
      { jockeyId: 'HAN_DOYUN' },
      { raceDefinitionId: 'DEV_M3_SPRINT_1400' },
      { engineVersion: 'race-sim-v2' },
      { raceRunId: randomUUID() },
    ]) {
      assert.equal(
        (await f.call('POST', `/v1/careers/${id}/race-entries`, { ...body, ...change })).statusCode,
        409,
      )
    }
    for (const extra of [
      { seed: randomUUID() },
      { result: log.result },
      { snapshot: run.player },
    ]) {
      assert.equal(
        (await f.call('POST', `/v1/careers/${id}/race-entries`, { ...body, ...extra })).statusCode,
        400,
      )
    }
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/actions`, {
          actionId: randomUUID(),
          choice: 'rest',
          expectedTurn: 3,
        })
      ).statusCode,
      409,
    )
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/months/advance`, {
          commandId: randomUUID(),
          actionId: body.raceRunId,
          expectedTurn: 3,
        })
      ).statusCode,
      409,
    )

    await f.db.query(
      "UPDATE race_definitions SET payload=jsonb_set(payload,'{distance}','2400') WHERE id=$1",
      [body.raceDefinitionId],
    )
    await f.db.query(
      "UPDATE jockey_definitions SET payload=jsonb_set(payload,'{pace}','1') WHERE id=$1",
      [body.jockeyId],
    )
    const restarted = await createApp({ ...f.db, close: async () => {} }, f.config)
    try {
      const reloaded = await restarted.inject({
        url: `/v1/careers/${id}/race-runs/${body.raceRunId}/log`,
        headers: { authorization: `Bearer ${f.user.token}` },
      })
      assert.equal(reloaded.statusCode, 200, reloaded.body)
      assert.equal(reloaded.body, JSON.stringify(stored))
    } finally {
      await restarted.close()
    }
    assert.deepEqual(await api.getRaceRun(id, body.raceRunId), details)
    assert.deepEqual(await api.getRaceLog(id, body.raceRunId), stored)
    const locked = await api.getCareerWorkspace()
    assert.ok(validateCareerWorkspace(locked))
    assert.equal(locked.confirmedActionId, body.raceRunId)
    assert.deepEqual(locked.career?.state.raceRun, run)
    const command = { commandId: randomUUID() }
    assert.ok(validateCompleteRace(command))
    const completed = await api.completeRace(id, body.raceRunId, command)
    assert.ok(validateRaceCompleteResponse(completed))
    assert.deepEqual(completed.result, log.result)
    assert.equal(completed.career.state.careerTurnIndex, 4)
    assert.equal(completed.career.state.raceRun, undefined)
    assert.deepEqual(await api.completeRace(id, body.raceRunId, command), completed)
    assert.deepEqual(
      await api.completeRace(id, body.raceRunId, { commandId: randomUUID() }),
      completed,
    )

    if (completed.career.event?.state === 'pending') {
      await api.chooseEvent(id, completed.career.event.id, {
        commandId: randomUUID(),
        choiceId: 'A',
        expectedTurn: 4,
      })
    }
    const nextAction = await api.confirmAction(id, {
      actionId: randomUUID(),
      choice: 'rest',
      expectedTurn: 4,
    })
    assert.deepEqual(await api.enterRace(id, body), entered)
    assert.deepEqual(await api.completeRace(id, body.raceRunId, command), completed)
    assert.deepEqual((await api.getCareerWorkspace()).career, nextAction.career)
    assert.deepEqual(
      (await api.completeRace(id, body.raceRunId, { commandId: randomUUID() })).career,
      nextAction.career,
    )
    assert.deepEqual(await api.getRaceLog(id, body.raceRunId), stored)
  } finally {
    await f.close()
  }
})

test('entry options and confirmation agree on health, records, paid entry, contracts, current turn and action locks', async () => {
  const f = await fixture()
  try {
    const { id } = await f.create()
    const path = `/v1/careers/${id}/race-entries`
    const empty = (await f.call('GET', path)).json<Models['RaceEntryOptions']>()
    assert.ok(validateRaceEntryOptions(empty))
    assert.equal(empty.races.length, 0)
    assert.ok(empty.restrictionReason)
    assert.equal((await f.call('GET', path, undefined, f.other.token)).statusCode, 404)
    assert.equal((await f.app.inject({ url: path })).statusCode, 401)
    await advanceToRaceMonth(f, id)
    await f.db.query(
      "UPDATE race_definitions SET payload=jsonb_set(payload,'{minWins}','1') WHERE id='DEV_M3_SPRINT_1400'",
    )
    await f.db.query(
      "UPDATE race_definitions SET payload=jsonb_set(payload,'{entryFee}','500000') WHERE id='DEV_M3_MIDDLE_2000'",
    )
    await f.db.query(
      'UPDATE jockey_chemistry SET chemistry=37 WHERE horse_id=(SELECT horse_id FROM careers WHERE id=$1) AND jockey_id=$2',
      [id, 'SEO_JIAN'],
    )
    for (const health of [
      '정상',
      '경상',
      '경미',
      '중등도',
      'MODERATE',
      '중상',
      '중증',
      'SEVERE',
      'unknown',
    ]) {
      await f.db.query(
        "UPDATE careers SET state=jsonb_set(state,'{health}',to_jsonb($2::text)) WHERE id=$1",
        [id, health],
      )
      const response = await f.call('GET', path)
      const options = response.json<Models['RaceEntryOptions']>()
      assert.equal(response.headers['cache-control'], 'no-store')
      assert.ok(validateRaceEntryOptions(options))
      const allowed = ['정상', '경상', '경미', '중등도', 'MODERATE'].includes(health)
      assert.equal(
        options.races.some((race) => race.eligible),
        allowed,
        health,
      )
      if (!allowed) {
        assert.equal((await f.call('POST', path, entryBody())).statusCode, 422, health)
      }
    }
    await f.db.query(
      "UPDATE careers SET state=jsonb_set(state,'{health}','\"중등도\"') WHERE id=$1",
      [id],
    )
    const options = (await f.call('GET', path)).json<Models['RaceEntryOptions']>()
    assert.equal(options.jockeys.find((jockey) => jockey.id === 'SEO_JIAN')?.chemistry, 37)
    assert.ok(!options.jockeys.some((jockey) => jockey.id === 'PARK_SEOYUN'))
    for (const race of options.races.filter((race) => !race.eligible)) {
      assert.ok(race.restrictionReason)
      const denied = await f.call('POST', path, {
        ...entryBody(),
        raceDefinitionId: race.definition.id,
      })
      assert.equal(denied.statusCode, 422)
      assert.equal(denied.json().error.message, race.restrictionReason)
    }
    assert.equal((await f.call('POST', path, { ...entryBody(), expectedTurn: 2 })).statusCode, 409)
    assert.equal(
      (await f.call('POST', path, { ...entryBody(), jockeyId: 'PARK_SEOYUN' })).statusCode,
      422,
    )
    const entered = await f.call('POST', path, entryBody())
    assert.equal(entered.statusCode, 200, entered.body)
    assert.equal(entered.json().career.state.raceRun.player.jockeySnapshot.chemistry, 37)
    const locked = (await f.call('GET', path)).json<Models['RaceEntryOptions']>()
    assert.ok(locked.restrictionReason)
    assert.ok(locked.races.every((race) => !race.eligible))
    const firstLog = (
      await f.call('GET', `/v1/careers/${id}/race-runs/${entered.json().raceRunId}/log`)
    ).body
    const finish = async (runId: string) => {
      const body = { commandId: randomUUID() }
      const url = `/v1/careers/${id}/race-runs/${runId}/complete`
      const completed = await f.call('POST', url, body)
      assert.equal(completed.statusCode, 200, completed.body)
      assert.deepEqual((await f.call('POST', url, body)).json(), completed.json())
      const again = await f.call('POST', url, { commandId: randomUUID() })
      assert.equal(again.statusCode, 200, again.body)
      assert.deepEqual(again.json().career, completed.json().career)
      return completed.json().career.state
    }
    let state = await finish(entered.json().raceRunId)
    for (const turn of [13, 15, 18, 24, 60, 61, 63, 66]) {
      // A legacy live save has a stale age, but keeps all actual records, logs, money and trust.
      state = {
        ...state,
        month: turn,
        careerTurnIndex: turn,
        age: 2,
        health: '정상',
        healthRecovery: 0,
        calendarDate: { year: 2028 + Math.floor((turn + 2) / 12), month: ((turn + 2) % 12) + 1 },
      }
      await f.db.query('UPDATE careers SET turn=$2,state=$3 WHERE id=$1', [
        id,
        turn,
        JSON.stringify(state),
      ])
      const recurring = (await f.call('GET', path)).json<Models['RaceEntryOptions']>()
      assert.ok(validateRaceEntryOptions(recurring))
      assert.equal(recurring.career.state.age, 2 + Math.floor((turn - 1) / 12))
      assert.ok(recurring.races.every((race) => race.definition.month === turn))
      assert.deepEqual(
        recurring.races
          .filter((race) => race.definition.countryCode === 'KOR')
          .map((race) => race.definition.id)
          .sort(),
        raceDefinitions
          .filter((race) => race.month === ((turn - 1) % 12) + 1)
          .map((race) => race.id)
          .sort(),
      )
      const candidate = recurring.races.find(
        (race) => race.eligible && race.definition.entryFee === 0,
      )
      if (!candidate) {
        continue
      }
      const command = {
        ...entryBody(),
        engineVersion: 'race-sim-v4' as const,
        expectedTurn: turn,
        raceDefinitionId: candidate.definition.id,
      }
      const next = await f.call('POST', path, command)
      assert.equal(next.statusCode, 200, next.body)
      assert.deepEqual((await f.call('POST', path, command)).json(), next.json())
      const run = next.json().career.state.raceRun
      assert.equal(run.month, turn)
      assert.equal(run.raceDefinitionSnapshot.month, turn)
      assert.equal(run.player.horseSnapshot.age, recurring.career.state.age)
      const beforeRecords = state.raceRecords.length
      state = await finish(command.raceRunId)
      assert.equal(state.raceRecords.length, beforeRecords + 1)
      assert.equal(state.raceRecords.at(-1).month, turn)
      assert.equal(state.careerTurnIndex, turn + 1)
      assert.equal(state.age, 2 + Math.floor(turn / 12))
    }
    assert.equal(
      (await f.call('GET', `/v1/careers/${id}/race-runs/${entered.json().raceRunId}/log`)).body,
      firstLog,
    )
    assert.equal(
      (await f.db.query('SELECT count(*)::int AS n FROM race_definitions')).rows[0].n,
      19,
    )
  } finally {
    await f.close()
  }
})

test('entry options preserve pending event, completed monthly action and retirement restrictions', async () => {
  for (const probability of [0, 1]) {
    const f = await fixture({ probability })
    try {
      if (probability === 1) {
        await f.db.query("UPDATE event_definitions SET enabled=(id='COM-0034')")
      }
      const { id } = await f.create()
      if (probability === 0) {
        await advanceToRaceMonth(f, id)
        assert.equal(
          (
            await f.call('POST', `/v1/careers/${id}/actions`, {
              actionId: randomUUID(),
              choice: 'rest',
              expectedTurn: 3,
            })
          ).statusCode,
          200,
        )
      }
      const options = (await f.call('GET', `/v1/careers/${id}/race-entries`)).json<
        Models['RaceEntryOptions']
      >()
      assert.ok(options.restrictionReason?.includes(probability === 1 ? '이벤트' : '행동'))
      assert.equal(
        (
          await f.call('POST', `/v1/careers/${id}/race-entries`, {
            ...entryBody(),
            expectedTurn: probability === 1 ? 1 : 3,
          })
        ).statusCode,
        409,
      )
      assert.equal(
        (await f.db.query('SELECT * FROM race_runs WHERE career_id=$1', [id])).rows.length,
        0,
      )
      const retired = await f.call('POST', `/v1/careers/${id}/retirement`, {
        commandId: randomUUID(),
        expectedRevision: options.career.revision,
      })
      assert.equal(retired.statusCode, 200, retired.body)
      const final = (await f.call('GET', `/v1/careers/${id}/race-entries`)).json<
        Models['RaceEntryOptions']
      >()
      assert.ok(final.restrictionReason?.includes('종료'))
      assert.ok(final.races.every((race) => !race.eligible))
    } finally {
      await f.close()
    }
  }
})

test('corrupt saved logs and payout failures roll back completion without regenerating results', async () => {
  const f = await fixture()
  try {
    const { id } = await f.create()
    await advanceToRaceMonth(f, id)
    const body = entryBody()
    const entered = await f.call('POST', `/v1/careers/${id}/race-entries`, body)
    assert.equal(entered.statusCode, 200, entered.body)
    const before = (await f.call('GET', `/v1/careers/${id}`)).json()
    for (const failure of ['corrupt-log', 'ledger']) {
      const failedApp = await createApp(
        {
          ...f.db,
          close: async () => {},
          transaction: (fn) =>
            f.db.transaction((tx) =>
              fn({
                query: async <T extends QueryResultRow = QueryResultRow>(
                  sql: string,
                  values?: unknown[],
                ) => {
                  if (failure === 'ledger' && sql.startsWith('INSERT INTO stable_ledger')) {
                    throw new Error('Injected payout failure')
                  }
                  const result = await tx.query<T>(sql, values)
                  if (
                    failure === 'corrupt-log' &&
                    sql.startsWith('SELECT * FROM race_simulation_logs')
                  ) {
                    Object.assign(result.rows[0], { digest: 'corrupt' })
                  }
                  return result
                },
              }),
            ),
        },
        f.config,
      )
      const commandId = randomUUID()
      try {
        const result = await failedApp.inject({
          method: 'POST',
          url: `/v1/careers/${id}/race-runs/${body.raceRunId}/complete`,
          headers: { authorization: `Bearer ${f.user.token}` },
          payload: { commandId },
        })
        assert.equal(result.statusCode, 500)
        if (failure === 'corrupt-log') {
          assert.equal(result.json().error.code, 'CORRUPT_LOG')
        }
      } finally {
        await failedApp.close()
      }
      assert.deepEqual((await f.call('GET', `/v1/careers/${id}`)).json(), before)
      assert.equal(
        (await f.db.query('SELECT * FROM commands WHERE request_id=$1', [commandId])).rows.length,
        0,
      )
      assert.equal(
        (await f.db.query('SELECT * FROM race_results WHERE race_run_id=$1', [body.raceRunId])).rows
          .length,
        0,
      )
      assert.equal(
        (await f.db.query('SELECT * FROM stable_ledger WHERE race_run_id=$1', [body.raceRunId]))
          .rows.length,
        1,
      )
    }
    const completed = await f.call(
      'POST',
      `/v1/careers/${id}/race-runs/${body.raceRunId}/complete`,
      { commandId: randomUUID() },
    )
    assert.equal(completed.statusCode, 200, completed.body)
  } finally {
    await f.close()
  }
})

test('004 upgrades the v1/v2 database in place, preserves logs and receipts, and readiness requires v3 migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'derby-race-v3-migrations-'))
  let f: Fixture | undefined
  try {
    for (const name of [
      '001_foundation.sql',
      '002_history_guards.sql',
      '003_exact_race_log_json.sql',
    ]) {
      await copyFile(join('migrations', name), join(directory, name))
    }
    f = await fixture({ migrationsDirectory: directory, seed: false })
    await seedLegacyCatalog(f.db)
    assert.equal((await f.app.inject({ url: '/health/ready' })).statusCode, 503)
    const previous: { id: string; body: Models['EnterRace']; response: unknown; log: string }[] = []
    for (const engineVersion of ['race-sim-v1', 'race-sim-v2'] as const) {
      previous.push(await legacyRaceFixture(f.db, f.user.principalId, engineVersion))
    }
    const checksums = (
      await f.db.query('SELECT name,checksum FROM schema_migrations ORDER BY name')
    ).rows
    const oldFunds = (
      await f.db.query('SELECT id,funds,calendar_year,calendar_month FROM stables ORDER BY id')
    ).rows
    assert.deepEqual(await migrate(f.db), [
      '004_race_sim_v3.sql',
      '005_event_activation_guards.sql',
      '006_racing_reference_catalog.sql',
      '007_jockey_trust.sql',
      '008_overseas_expeditions.sql',
      '009_unselected_event_expiry.sql',
    ])
    assert.deepEqual(await migrate(f.db), [])
    assert.deepEqual(
      (await f.db.query('SELECT id,funds,calendar_year,calendar_month FROM stables ORDER BY id'))
        .rows,
      oldFunds,
    )
    assert.ok(
      (await f.db.query('SELECT home_country FROM stables')).rows.every(
        (row) => row.home_country === 'KOR',
      ),
    )

    assert.equal((await f.app.inject({ url: '/health/ready' })).statusCode, 200)
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT name,checksum FROM schema_migrations WHERE name < '004' ORDER BY name",
        )
      ).rows,
      checksums,
    )
    const imported = await importRacingCatalog(
      f.db,
      await readRacingSource(['seeds/racing.notion.source.json']),
    )
    assert.equal(imported.committed, true, JSON.stringify(imported))
    for (const saved of previous) {
      assert.equal(
        (await f.call('GET', `/v1/careers/${saved.id}/race-runs/${saved.body.raceRunId}/log`)).body,
        saved.log,
      )
      assert.deepEqual(
        (await f.call('POST', `/v1/careers/${saved.id}/race-entries`, saved.body)).json(),
        saved.response,
      )
    }
    const { id } = await f.create()
    await advanceToRaceMonth(f, id)
    const body = entryBody()
    const entered = await f.call('POST', `/v1/careers/${id}/race-entries`, body)
    assert.equal(entered.statusCode, 200, entered.body)
    assert.equal(entered.json().career.state.raceRun.simulation.engineVersion, 'race-sim-v3')
  } finally {
    await f?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
