import { legacyCareer as startCareer } from '../../../tests/helpers/legacy-career'
import { readFile } from 'node:fs/promises'
import { applyCareer, archiveActiveHorse, type LifecycleHorse } from '../../../lib/career/lifecycle'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  horses,
  tactics,
  completeRace,
  applyRaceResult,
  createRaceRun,
  raceDefinitions,
  contractedJockeys,
  contractedRoster,
  simulateRace,
  raceLogDigest,
  trustAfterRace,
  trustLossRule,
  trustRaceRoll,
  createTrustContext,
  careerJockeyRelations,
  applyTrustEvent,
  trustExecutionBonus,
  TRUST_EVENT_AMOUNTS,
  assertCareer,
  chooseEvent,
  type Career,
  type RaceRunInput,
  type TrustContext,
} from '../../../packages/shared/src/domain'
import { simulateRaceV3 } from '../../../lib/career/race-sim-v3'
import { createEventCatalog } from '../../../lib/career/events/repository'
import type { EventDefinition as LocalEvent } from '../../../lib/career/events/types'
import type { EventDefinition } from '../../../packages/shared/src/events'
import {
  validateJockeyRelationsResponse,
  validateRaceRunResponse,
} from '../../../packages/shared/src/generated/save-validation.mjs'
import { applyImmediateEffects } from '../src/modules/events/resolver'
import { effectSchema } from '../src/modules/events/schema'
import { trustChoiceAvailable } from '../src/modules/events/director'
import { importEvents } from '../src/modules/events/import'
import { digest } from '../src/services/identity'
import { fixture } from './helpers'

function input(trust = 0): RaceRunInput {
  const career = startCareer('DEV_HORSE_SERENE_STEP')
  let n = 0
  return createRaceRun(
    career,
    raceDefinitions[1],
    { ...contractedJockeys[1], chemistry: trust },
    '선입',
    () => (n++ === 0 ? 'fixed-trust-run' : 'fixed-trust-seed'),
  )
}
function withContext(run: RaceRunInput, favorite = false): RaceRunInput {
  return {
    ...run,
    trustContext: {
      version: 'jockey-trust-v1',
      favorite,
      playerRating: 17,
      strongestOpponentRating: 17,
    },
  }
}

test('trust growth boundaries, clamps, loss probabilities and all rank bands including odd fields', () => {
  for (const [before, after] of [
    [0, 15],
    [39, 54],
    [40, 50],
    [69, 79],
    [70, 75],
    [99, 100],
    [100, 100],
  ]) {
    assert.equal(trustAfterRace(before, 1, 12, false, 0).after, after)
  }
  for (const favorite of [false, true]) {
    const rows = [
      [1, 0, 0],
      [2, favorite ? 0.01 : 0.005, 2],
      [3, favorite ? 0.02 : 0.01, 2],
      [4, favorite ? 0.07 : 0.04, 4],
      [6, favorite ? 0.07 : 0.04, 4],
      [7, favorite ? 0.12 : 0.08, 6],
    ]
    for (const [placing, probability, amount] of rows) {
      assert.deepEqual(trustLossRule(placing, 12, favorite), { probability, amount })
      let declines = 0
      for (let draw = 0; draw < 10000; draw++) {
        if (trustAfterRace(40, placing, 12, favorite, draw / 10000).reason === 'decline') {
          declines++
        }
      }
      assert.equal(declines, Math.round(probability * 10000))
      if (probability) {
        assert.equal(
          trustAfterRace(40, placing, 12, favorite, probability - 0.000001).after,
          40 - amount,
        )
      }
      assert.equal(trustAfterRace(40, placing, 12, favorite, probability).after, 50)
    }
  }
  assert.equal(trustAfterRace(69, 12, 12, true, 0).after, 63)
  assert.equal(trustAfterRace(70, 12, 12, true, 0).after, 67)
  assert.equal(trustAfterRace(100, 4, 12, false, 0).after, 97)
  assert.equal(trustAfterRace(0, 12, 12, true, 0).after, 0)
  assert.equal(trustLossRule(6, 11, false).amount, 4)
  assert.equal(trustLossRule(7, 11, false).amount, 6)
  assert.equal(trustLossRule(3, 4, false).amount, 2)
  for (const value of [-1, 101, 0.1, NaN]) {
    assert.throws(() => trustAfterRace(value, 1, 12, false, 0))
  }
  assert.throws(() => trustAfterRace(0, 0, 12, false, 0))
  assert.throws(() => trustAfterRace(0, 13, 12, false, 0))
  assert.throws(() => trustAfterRace(0, 1, 12, false, 1))
})

test('independent trust stream is deterministic and resolves saved favorite context without recalculation', () => {
  const run = withContext(input(70), true)
  assert.equal(trustRaceRoll(run), trustRaceRoll(structuredClone(run)))
  assert.notEqual(trustRaceRoll(run), trustRaceRoll({ ...run, raceRunId: 'another' }))
  assert.notEqual(trustRaceRoll(run), trustRaceRoll({ ...run, raceSeed: 'another' }))
  const state = { ...startCareer('DEV_HORSE_SERENE_STEP'), raceRun: run }
  const applied = applyRaceResult(state, run.raceRunId, 12, 0)
  assert.equal(applied.raceRecords[0].trustChange!.favorite, true)
  assert.equal(applied.raceRecords[0].trustChange!.lossProbability, 0.12)
  assert.equal(applied.raceRecords[0].trustChange!.rated, true)
  assert.equal(applied.jockeyTrust!.SEO_JIAN.trust, applied.raceRecords[0].trustChange!.after)
  assert.deepEqual(applyRaceResult(applied, run.raceRunId, 12, 0), applied)
})

test('favorite rating locks only pre-entry field data and includes v3 abilities, aptitudes and condition', () => {
  const run = input()
  const context = createTrustContext(run)
  assert.deepEqual(
    context,
    createTrustContext({
      ...run,
      raceSeed: 'different-real-seed',
      simulation: {
        engineVersion: 'race-sim-v3',
        digest: 'ignored',
        durationMs: 1,
        result: {
          playerHorseId: run.playerHorseId,
          placing: 1,
          prizeMoney: 999,
          finishTime: 1,
          marginToWinner: 0,
        },
      },
    }),
  )
  const changed = structuredClone(run)
  changed.player.horseSnapshot.values = {
    speed: 1000,
    stamina: 1000,
    power: 1000,
    guts: 1000,
    intelligence: 1000,
    fatigue: 0,
    bodyLoad: 0,
  }
  changed.player.horseSnapshot.aptitude = changed.player.horseSnapshot.aptitude.map(([key]) => [
    key,
    'A',
  ])
  changed.player.jockeySnapshot = {
    ...changed.player.jockeySnapshot,
    start: 100,
    pace: 100,
    path: 100,
    timing: 100,
    stability: 100,
  }
  changed.runners[0] = changed.player
  const strong = createTrustContext(changed)
  assert.equal(strong.favorite, true)
  assert.ok(strong.playerRating >= strong.strongestOpponentRating * 1.02)
  const tired = structuredClone(changed)
  tired.player.horseSnapshot.values.fatigue = 200
  tired.player.horseSnapshot.values.bodyLoad = 200
  tired.runners[0] = tired.player
  assert.ok(createTrustContext(tired).playerRating < strong.playerRating)
  const weak = structuredClone(run)
  weak.player.horseSnapshot.values = {
    ...weak.player.horseSnapshot.values,
    speed: 0,
    power: 0,
    stamina: 0,
  }
  weak.runners[0] = weak.player
  assert.equal(createTrustContext(weak).favorite, false)
  const trustOnly = structuredClone(run)
  trustOnly.player.jockeySnapshot.chemistry = 100
  trustOnly.runners[0] = trustOnly.player
  assert.deepEqual(createTrustContext(trustOnly), context)
})

test('v4 changes only bounded execution: zero trust replays v3 physics; all old engines ignore trust', () => {
  assert.equal(trustExecutionBonus(0), 0)
  assert.equal(trustExecutionBonus(100), 0.08)
  const zero = input(0),
    high = input(100)
  for (const version of ['race-sim-v1', 'race-sim-v2', 'race-sim-v3']) {
    assert.equal(
      JSON.stringify(simulateRace(zero, version)),
      JSON.stringify(simulateRace(high, version)),
    )
  }
  const v3 = simulateRaceV3(zero)
  const v4 = simulateRace(zero, 'race-sim-v4')
  assert.deepEqual({ ...v4, engineVersion: 'race-sim-v3' }, v3)
  assert.equal(JSON.stringify(simulateRace(zero, 'race-sim-v4')), JSON.stringify(v4))
  assert.notEqual(raceLogDigest(simulateRace(high, 'race-sim-v4')), raceLogDigest(v4))
  const capped = input(0)
  capped.player.horseSnapshot.values.intelligence = 1000
  capped.runners[0] = capped.player
  const cappedHigh = structuredClone(capped)
  cappedHigh.player.jockeySnapshot.chemistry = 100
  cappedHigh.runners[0] = cappedHigh.player
  assert.equal(
    JSON.stringify(simulateRace(capped, 'race-sim-v4')),
    JSON.stringify(simulateRace(cappedHigh, 'race-sim-v4')),
  )
})

test('high trust cannot routinely overturn a large jockey ability advantage across distances/tactics/seeds', () => {
  const statistics = []
  for (const distance of [1400, 1600, 2200]) {
    for (const tactic of ['도주', '선행', '선입', '추입'] as const) {
      let strongTime = 0,
        weakTime = 0
      for (let seed = 0; seed < 12; seed++) {
        const run = input()
        run.raceDefinitionSnapshot = { ...run.raceDefinitionSnapshot, distance }
        run.player.tactic = tactic
        run.runners[0] = run.player
        run.raceSeed = `trust-balance-${seed}`
        const strong = structuredClone(run),
          weak = structuredClone(run)
        for (const key of ['start', 'pace', 'path', 'timing', 'stability'] as const) {
          strong.player.jockeySnapshot[key] = 90
          weak.player.jockeySnapshot[key] = 60
        }
        weak.player.jockeySnapshot.chemistry = 100
        strong.runners[0] = strong.player
        weak.runners[0] = weak.player
        strongTime += simulateRace(strong, 'race-sim-v4').result.finishTime
        weakTime += simulateRace(weak, 'race-sim-v4').result.finishTime
      }
      assert.ok(strongTime < weakTime, `${distance}/${tactic}: ${strongTime} vs ${weakTime}`)
      statistics.push({
        distance,
        tactic,
        strongMean: strongTime / 12,
        weakHighTrustMean: weakTime / 12,
      })
    }
  }
  assert.equal(statistics.length, 12)
})

test('Local shared state preserves jockey return, retirement and explicit event effects; legacy records never invent trust', () => {
  let career = startCareer('DEV_HORSE_SERENE_STEP')
  for (const amount of TRUST_EVENT_AMOUNTS) {
    const base = { ...career, jockeyTrust: { SEO_JIAN: { starts: 2, trust: 50 } } }
    const direct = applyTrustEvent(base, { jockeyId: 'SEO_JIAN', amount })
    const server = applyImmediateEffects(base, [
      { type: 'jockey_trust', jockeyId: 'SEO_JIAN', amount },
    ])
    assert.deepEqual(server.career.jockeyTrust, direct.career.jockeyTrust)
    assert.equal(direct.career.jockeyTrust!.SEO_JIAN.trust, 50 + amount)
    assert.equal(direct.career.jockeyTrust!.SEO_JIAN.starts, 2)
    assert.ok(
      effectSchema.safeParse({ type: 'jockey_trust', jockeyId: 'SEO_JIAN', amount }).success,
    )
  }
  assert.equal(
    effectSchema.safeParse({ type: 'jockey_trust', jockeyId: 'SEO_JIAN', amount: 15 }).success,
    false,
  )
  assert.throws(() => applyTrustEvent(career, { jockeyId: 'unknown', amount: 5 }))
  const definition: LocalEvent = {
    id: 'TRUST_TEST',
    name: 'test only',
    description: 'test',
    kind: 'life',
    timing: 'month-start',
    condition: {},
    weight: 1,
    limitedToMonth: true,
    effects: [],
    choices: [
      { id: 'A', effects: [{ scope: 'immediate', trust: { jockeyId: 'SEO_JIAN', amount: 8 } }] },
      { id: 'B', effects: [] },
    ],
  }
  career = { ...career, event: { eventId: definition.id, month: 1, seed: 1, status: 'offered' } }
  const catalog = createEventCatalog([definition])
  career = chooseEvent(career, definition.id, 'A', catalog)
  assert.equal(career.jockeyTrust!.SEO_JIAN.trust, 8)
  assert.deepEqual(chooseEvent(career, definition.id, 'A', catalog), career)
  assert.equal(career.action, null)
  const first = withContext(input(8))
  career = completeRace({ ...career, raceRun: first }, first.raceRunId, 1, 8000000)
  const original = career.jockeyTrust!.SEO_JIAN
  const other = withContext(input(0))
  other.raceRunId = 'other-jockey-run'
  other.player.jockeySnapshot = { ...contractedJockeys[0] }
  other.runners[0] = other.player
  career = completeRace({ ...career, raceRun: other }, other.raceRunId, 1, 8000000)
  assert.deepEqual(career.jockeyTrust!.SEO_JIAN, original)
  assert.equal(contractedRoster(career).find((j) => j.id === 'SEO_JIAN')!.chemistry, original.trust)
  const restored = JSON.parse(JSON.stringify(career)) as Career
  assertCareer(restored)
  const projected = applyCareer(
    { activeHorse: null, month: 1, year: 2028, archive: [] as LifecycleHorse[] },
    restored,
  )
  const archive = archiveActiveHorse(projected, restored.horse.id, 'separate-archive')
  assert.deepEqual(archive.archive[0].jockeyTrust, career.jockeyTrust)
  assert.deepEqual({ ...careerJockeyRelations(startCareer(career.horse.id)) }, {})
  const legacy = { ...career }
  delete legacy.jockeyTrust
  const relations = careerJockeyRelations(legacy)
  assert.equal(relations.SEO_JIAN.starts, 1)
  assert.equal(relations.SEO_JIAN.trust, 0)
  const ambiguous = { ...legacy, raceRecords: [{ race: 'old', date: '2028.04', result: '1착' }] }
  assert.deepEqual({ ...careerJockeyRelations(ambiguous) }, {})
  assert.throws(() =>
    assertCareer({ ...career, jockeyTrust: { SEO_JIAN: { starts: 1, trust: 101 } } }),
  )
})

type Fixture = Awaited<ReturnType<typeof fixture>>
async function call(f: Fixture, method: 'GET' | 'POST', url: string, body?: unknown, status = 200) {
  const response = await f.call(method, url, body)
  assert.equal(response.statusCode, status, response.body)
  return response.json()
}
async function advance(f: Fixture, id: string, target: number) {
  let career = (await call(f, 'GET', `/v1/careers/${id}`)).career
  while (career.state.careerTurnIndex < target) {
    const actionId = randomUUID(),
      expectedTurn = career.state.careerTurnIndex
    await call(f, 'POST', `/v1/careers/${id}/actions`, { actionId, choice: 'rest', expectedTurn })
    career = (
      await call(f, 'POST', `/v1/careers/${id}/months/advance`, {
        commandId: randomUUID(),
        actionId,
        expectedTurn,
      })
    ).career
  }
}

test('Server trust is atomic, matches Local, restores after retry and remains isolated through jockey/horse retirement', async () => {
  const f = await fixture()
  try {
    await f.db.query('UPDATE event_definitions SET enabled=false')
    const { id } = await f.create()
    const path = `/v1/careers/${id}`
    const initial = await call(f, 'GET', path + '/jockey-relations')
    assert.ok(validateJockeyRelationsResponse(initial))
    assert.ok(initial.data.every((r) => r.starts === 0 && r.trust === 0))
    let previousTrust = 0,
      firstContext: TrustContext | undefined,
      firstRun = '',
      firstLog = ''
    for (const [turn, jockeyId] of [
      [3, 'SEO_JIAN'],
      [6, 'HAN_DOYUN'],
      [9, 'SEO_JIAN'],
    ] as const) {
      await advance(f, id, turn)
      const options = await call(f, 'GET', path + '/race-entries')
      assert.equal(options.defaultEngineVersion, 'race-sim-v4')
      const race = options.races.find(
        (r: { eligible: boolean; definition: { id: string } }) => r.eligible,
      )!
      assert.ok(race)
      const raceRunId = randomUUID()
      await call(f, 'POST', path + '/race-entries', {
        raceRunId,
        raceDefinitionId: race.definition.id,
        jockeyId,
        tactic: '선입',
        expectedTurn: turn,
      })
      const details = await call(f, 'GET', path + `/race-runs/${raceRunId}`)
      assert.ok(validateRaceRunResponse(details))
      assert.equal(details.metadata.engineVersion, 'race-sim-v4')
      const run = details.raceRun as RaceRunInput
      assert.ok(run.trustContext)
      assert.equal(run.player.jockeySnapshot.chemistry, jockeyId === 'SEO_JIAN' ? previousTrust : 0)
      if (!firstRun) {
        firstRun = raceRunId
        firstContext = run.trustContext
        firstLog = (await f.call('GET', path + `/race-runs/${raceRunId}/log`)).body
        await f.db
          .query(`CREATE FUNCTION fail_trust_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
          CREATE TRIGGER fail_trust_receipt BEFORE INSERT ON commands FOR EACH ROW WHEN(NEW.operation='race.complete') EXECUTE FUNCTION fail_trust_receipt()`)
        await call(
          f,
          'POST',
          path + `/race-runs/${raceRunId}/complete`,
          { commandId: randomUUID() },
          500,
        )
        const unchanged = await call(f, 'GET', path + '/jockey-relations')
        assert.ok(
          unchanged.data.every(
            (r: { starts: number; trust: number }) => r.starts === 0 && r.trust === 0,
          ),
        )
        await f.db.query(
          'DROP TRIGGER fail_trust_receipt ON commands; DROP FUNCTION fail_trust_receipt()',
        )
      }
      const locked = (await call(f, 'GET', path)).career.state as Career
      const result = run.simulation!.result
      const local = completeRace(locked, raceRunId, result.placing, result.prizeMoney)
      const body = { commandId: randomUUID() }
      const done = await call(f, 'POST', path + `/race-runs/${raceRunId}/complete`, body)
      assert.deepEqual(done.career.state.jockeyTrust, local.jockeyTrust)
      assert.deepEqual(await call(f, 'POST', path + `/race-runs/${raceRunId}/complete`, body), done)
      const retries = await Promise.all(
        Array.from({ length: 3 }, () =>
          call(f, 'POST', path + `/race-runs/${raceRunId}/complete`, { commandId: randomUUID() }),
        ),
      )
      assert.ok(retries.every((r) => r.career.revision === done.career.revision))
      const relations = await call(f, 'GET', path + '/jockey-relations')
      assert.equal(
        relations.data.find(
          (r: { jockeyId: string; starts: number; trust: number }) => r.jockeyId === jockeyId,
        )!.starts,
        jockeyId === 'SEO_JIAN' && turn === 9 ? 2 : 1,
      )
      if (jockeyId === 'SEO_JIAN') {
        previousTrust = local.jockeyTrust!.SEO_JIAN.trust
      } else {
        assert.equal(
          relations.data.find(
            (r: { jockeyId: string; starts: number; trust: number }) => r.jockeyId === 'SEO_JIAN',
          )!.trust,
          previousTrust,
        )
      }
    }
    assert.equal((await f.call('GET', path + `/race-runs/${firstRun}/log`)).body, firstLog)
    assert.deepEqual(
      (await call(f, 'GET', path + `/race-runs/${firstRun}`)).raceRun.trustContext,
      firstContext,
    )
    assert.equal(
      (await f.call('GET', path + '/jockey-relations', undefined, f.other.token)).statusCode,
      404,
    )
    assert.equal(
      (await f.app.inject({ method: 'GET', url: path + '/jockey-relations' })).statusCode,
      401,
    )
    assert.equal((await f.call('GET', '/v1/careers/not-a-uuid/jockey-relations')).statusCode, 400)
    assert.equal(
      (await f.call('GET', `/v1/careers/${randomUUID()}/jockey-relations`)).statusCode,
      404,
    )
    const before = await call(f, 'GET', path + '/jockey-relations')
    const current = (await call(f, 'GET', path)).career
    const retired = await call(f, 'POST', path + '/retirement', {
      commandId: randomUUID(),
      expectedRevision: current.revision,
    })
    assert.deepEqual(retired.retirement.snapshot.state.jockeyTrust, current.state.jockeyTrust)
    const after = await call(f, 'GET', path + '/jockey-relations')
    assert.deepEqual(after.data, before.data)
    assert.equal(after.status, 'retired')
    await assert.rejects(
      () =>
        f.db.query('UPDATE jockey_chemistry SET chemistry=0 WHERE horse_id=$1', [
          after.ownedHorseId,
        ]),
      /immutable/i,
    )
    const fresh = (await f.create()).response.career
    assert.notEqual(fresh.ownedHorseId, after.ownedHorseId)
    const freshRelations = await call(f, 'GET', `/v1/careers/${fresh.id}/jockey-relations`)
    assert.ok(
      freshRelations.data.every(
        (r: { starts: number; trust: number }) => r.trust === 0 && r.starts === 0,
      ),
    )
    const noStore = await f.call('GET', path + '/jockey-relations')
    assert.equal(noStore.headers['cache-control'], 'no-store')
  } finally {
    await f.close()
  }
})

test('explicit catalog trust choice applies once without an extra monthly action or extra draw; unavailable targets excluded', async () => {
  const f = await fixture({ probability: 1 })
  try {
    const source = (await f.call('GET', '/v1/events/COM-0001')).json<EventDefinition>()
    const { revision: _revision, ...base } = source
    const definition = {
      ...base,
      id: 'TEST-TRUST',
      timing: 'month_start' as const,
      automatic: false,
      enabled: true,
      status: 'ready' as const,
      conditions: [{ type: 'always' as const }],
      choices: [
        {
          id: 'A',
          label: 'test positive',
          conditions: [],
          effects: [{ type: 'jockey_trust' as const, jockeyId: 'SEO_JIAN', amount: 8 as const }],
        },
        {
          id: 'B',
          label: 'test negative',
          conditions: [],
          effects: [{ type: 'jockey_trust' as const, jockeyId: 'SEO_JIAN', amount: -5 as const }],
        },
      ],
    }
    await importEvents(f.db, {
      schemaVersion: 1,
      events: [{ ...definition, revision: digest(definition) }],
    })
    await f.db.query("UPDATE event_definitions SET enabled=(id='TEST-TRUST')")
    const { id, response } = await f.create()
    const event = response.career.event
    assert.equal(event.eventId, 'TEST-TRUST')
    const path = `/v1/careers/${id}`
    const body = { commandId: randomUUID(), choiceId: 'A', expectedTurn: 1 }
    const chosen = await call(f, 'POST', path + `/events/${event.id}/choice`, body)
    assert.equal(chosen.career.state.jockeyTrust.SEO_JIAN.trust, 8)
    assert.equal(chosen.career.state.jockeyTrust.SEO_JIAN.starts, 0)
    assert.equal(chosen.career.event.result.trustChanges[0].delta, 8)
    assert.deepEqual(await call(f, 'POST', path + `/events/${event.id}/choice`, body), chosen)
    await call(f, 'POST', path + `/events/${event.id}/choice`, { ...body, commandId: randomUUID() })
    await call(
      f,
      'POST',
      path + `/events/${event.id}/choice`,
      { ...body, commandId: randomUUID(), choiceId: 'B' },
      409,
    )
    const relation = await call(f, 'GET', path + '/jockey-relations')
    assert.equal(
      relation.data.find(
        (r: { jockeyId: string; starts: number; trust: number }) => r.jockeyId === 'SEO_JIAN',
      )!.trust,
      8,
    )
    assert.equal(
      (await f.db.query('SELECT count(*)::int AS n FROM monthly_actions WHERE career_id=$1', [id]))
        .rows[0].n,
      0,
    )
    assert.equal(
      (await f.db.query('SELECT count(*)::int AS n FROM event_draws WHERE career_id=$1', [id]))
        .rows[0].n,
      1,
    )
    const career = chosen.career.state as Career
    assert.equal(
      trustChoiceAvailable(
        {
          ...definition.choices[0],
          effects: [{ type: 'jockey_trust', jockeyId: 'PARK_SEOYUN', amount: 5 }],
        },
        career,
      ),
      false,
    )
    const automatic = applyImmediateEffects(career, [
      { type: 'jockey_trust', jockeyId: 'SEO_JIAN', amount: -12 },
    ])
    assert.equal(automatic.career.jockeyTrust!.SEO_JIAN.trust, 0)
    await advance(f, id, 2)
    const next = (await call(f, 'GET', path)).career.event
    const negative = await call(f, 'POST', path + `/events/${next.id}/choice`, {
      commandId: randomUUID(),
      choiceId: 'B',
      expectedTurn: 2,
    })
    assert.equal(negative.career.state.jockeyTrust.SEO_JIAN.trust, 3)
  } finally {
    await f.close()
  }
})

test('frozen v2/v3 kernels match 144 golden digests captured from develop 307876b before trust changes', async () => {
  const expected: Record<string, string> = JSON.parse(
    await readFile(new URL('./fixtures/race-v2-v3-trust.digests.json', import.meta.url), 'utf8'),
  )
  for (const [key, digest] of Object.entries(expected)) {
    const [engine, h, r, t, seed] = key.split('/')
    let identity = 0
    const run = createRaceRun(
      startCareer(horses[Number(h)].id),
      raceDefinitions[Number(r)],
      contractedJockeys[Number(h)],
      tactics[Number(t)],
      () => (identity++ === 0 ? 'legacy-trust-run' : `legacy-trust-seed-${seed}`),
    )
    assert.equal(raceLogDigest(simulateRace(run, engine)), digest, key)
  }
  assert.equal(Object.keys(expected).length, 144)
})

test('legacy pending runs do not infer favorite after the result or backfill trust into old records', () => {
  const run = input(0)
  const prior = {
    raceRunId: 'verified-old-run',
    jockeyId: 'SEO_JIAN',
    race: 'old',
    result: '1착',
    date: '2028.04',
  }
  const state = { ...startCareer('DEV_HORSE_SERENE_STEP'), raceRun: run, raceRecords: [prior] }
  const completed = completeRace(state, run.raceRunId, 1, 8000000)
  assert.deepEqual(completed.raceRecords[0], prior)
  assert.equal(completed.raceRecords[1].trustChange!.rated, false)
  assert.equal(completed.raceRecords[1].trustChange!.favorite, false)
  assert.deepEqual(completed.jockeyTrust!.SEO_JIAN, { starts: 2, trust: 15 })
  assert.deepEqual(completeRace(completed, run.raceRunId, 1, 8000000), completed)
})

test('an explicitly declared automatic trust event persists on initial Career creation exactly once', async () => {
  const f = await fixture({ probability: 1 })
  try {
    const source = (await f.call('GET', '/v1/events/COM-0001')).json<EventDefinition>()
    const { revision: _revision, ...base } = source
    const definition = {
      ...base,
      id: 'TEST-TRUST-AUTO',
      timing: 'month_start' as const,
      automatic: true,
      enabled: true,
      status: 'ready' as const,
      conditions: [{ type: 'always' as const }],
      choices: [
        {
          id: 'auto',
          label: 'test only',
          conditions: [],
          effects: [{ type: 'jockey_trust' as const, jockeyId: 'SEO_JIAN', amount: 5 as const }],
        },
      ],
    }
    await importEvents(f.db, {
      schemaVersion: 1,
      events: [{ ...definition, revision: digest(definition) }],
    })
    await f.db.query("UPDATE event_definitions SET enabled=(id='TEST-TRUST-AUTO')")
    const { id, response } = await f.create()
    assert.equal(response.career.event.state, 'applied')
    assert.equal(response.career.state.jockeyTrust.SEO_JIAN.trust, 5)
    assert.equal(response.career.state.jockeyTrust.SEO_JIAN.starts, 0)
    const current = await call(f, 'GET', `/v1/careers/${id}`)
    assert.equal(current.career.state.jockeyTrust.SEO_JIAN.trust, 5)
    await call(f, 'POST', `/v1/careers/${id}/events/${response.career.event.id}/choice`, {
      commandId: randomUUID(),
      choiceId: 'auto',
      expectedTurn: 1,
    })
    const relations = await call(f, 'GET', `/v1/careers/${id}/jockey-relations`)
    assert.equal(
      relations.data.find((r: { jockeyId: string; trust: number }) => r.jockeyId === 'SEO_JIAN')!
        .trust,
      5,
    )
  } finally {
    await f.close()
  }
})
