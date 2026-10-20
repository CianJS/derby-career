import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Database } from '../src/db'
import { fixture } from './helpers'
import { createApp } from '../src/app'
import { simulateRace, raceLogDigest, raceTrustChange } from '../../../packages/shared/src/domain'
import {
  validateCareerResponse,
  validateCareerWorkspace,
  validateExpeditionResponse,
  validateStartExpedition,
  validateReturnExpedition,
} from '../../../packages/shared/src/generated/save-validation.mjs'

type Fixture = Awaited<ReturnType<typeof fixture>>
const path = (id: string) => `/v1/careers/${id}`
const raceId = (country: string) => `DEV_${country}_M3_MILE_1600`
const entry = (country: string) => ({
  raceRunId: randomUUID(),
  raceDefinitionId: raceId(country),
  jockeyId: 'SEO_JIAN',
  tactic: '선입' as const,
  expectedTurn: 3,
})
async function choosePending(f: Fixture, id: string) {
  const career = (await f.call('GET', path(id))).json().career
  if (career.event?.state !== 'pending') {
    return
  }
  let chosen = false
  for (const choice of career.event.definition.choices) {
    const result = await f.call('POST', path(id) + `/events/${career.event.id}/choice`, {
      commandId: randomUUID(),
      choiceId: choice.id,
      expectedTurn: career.state.careerTurnIndex,
    })
    if (result.statusCode === 200) {
      chosen = true
      break
    }
    assert.equal(result.statusCode, 422, result.body)
  }
  assert.ok(chosen, 'A pending event must have an eligible choice')
}
async function advance(f: Fixture, id: string, turn: number) {
  await choosePending(f, id)
  const actionId = randomUUID()
  const action = await f.call('POST', path(id) + '/actions', {
    actionId,
    choice: 'rest',
    expectedTurn: turn,
  })
  assert.equal(action.statusCode, 200, action.body)
  const next = await f.call('POST', path(id) + '/months/advance', {
    commandId: randomUUID(),
    actionId,
    expectedTurn: turn,
  })
  assert.equal(next.statusCode, 200, next.body)
}
async function ready(f: Fixture) {
  const created = await f.create()
  await advance(f, created.id, 1)
  await advance(f, created.id, 2)
  await choosePending(f, created.id)
  return created
}
async function current(f: Fixture, id: string) {
  return (await f.call('GET', path(id))).json().career
}
async function travel(f: Fixture, id: string) {
  const response = await f.call('GET', path(id) + '/expedition')
  assert.equal(response.statusCode, 200, response.body)
  assert.ok(validateExpeditionResponse(response.json()))
  return response.json().travel
}
async function snapshot(f: Fixture, id: string) {
  const career = await current(f, id)
  const expeditions = (
    await f.db.query('SELECT * FROM stable_expeditions WHERE stable_id=$1 ORDER BY id', [
      career.stableId,
    ])
  ).rows
  const ledger = (
    await f.db.query('SELECT * FROM stable_ledger WHERE stable_id=$1 ORDER BY id', [
      career.stableId,
    ])
  ).rows
  const actions = (
    await f.db.query('SELECT * FROM monthly_actions WHERE career_id=$1 ORDER BY id', [id])
  ).rows
  return { career, expeditions, ledger, actions }
}
async function receiptFault(f: Fixture, commandId: string) {
  const name = 'expedition_fail_' + randomUUID().replaceAll('-', '')
  await f.db.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${commandId}'::uuid THEN RAISE EXCEPTION 'injected expedition receipt failure'; END IF; RETURN NEW; END $$`,
  )
  await f.db.query(
    `CREATE TRIGGER ${name} BEFORE INSERT ON commands FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  )
  return async () => {
    await f.db.query(`DROP TRIGGER ${name} ON commands`)
    await f.db.query(`DROP FUNCTION ${name}()`)
  }
}
export function registerExpeditionTests(label: string, database?: () => Database) {
  const setup = () => fixture(database ? { db: database() } : {})
  for (const country of ['JPN', 'USA']) {
    test(`${label}: KOR → ${country} race → KOR restores eligibility, economy, logs and trust`, async () => {
      const f = await setup()
      const original = (
        await f.db.query('SELECT payload FROM race_definitions WHERE id=$1', [raceId(country)])
      ).rows[0].payload
      try {
        const { id } = await ready(f)
        const start = await current(f, id)
        assert.deepEqual(start.travel, {
          homeCountry: 'KOR',
          locationCountry: 'KOR',
          revision: 0,
          activeExpedition: null,
        })
        const options = (await f.call('GET', path(id) + '/race-entries')).json()
        assert.ok(
          options.races.some(
            (r: { definition: { countryCode: string }; eligible: boolean }) =>
              r.definition.countryCode === 'KOR' && r.eligible,
          ),
        )
        assert.ok(
          options.races
            .filter(
              (r: { definition: { countryCode: string } }) => r.definition.countryCode !== 'KOR',
            )
            .every((r: { eligible: boolean }) => !r.eligible),
        )
        const runBody = entry(country)
        assert.equal((await f.call('POST', path(id) + '/race-entries', runBody)).statusCode, 422)
        const body = {
          commandId: randomUUID(),
          targetCountry: country,
          expectedTravelRevision: 0,
          raceDefinitionId: raceId(country),
        }
        assert.ok(validateStartExpedition(body))
        const departed = await f.call('POST', path(id) + '/expeditions', body)
        assert.equal(departed.statusCode, 200, departed.body)
        assert.ok(validateCareerResponse(departed.json()))
        assert.deepEqual(departed.json().career.state, start.state)
        assert.equal(departed.json().career.funds, start.funds)
        const trip = await travel(f, id)
        assert.equal(trip.activeExpedition.targetRaceDefinitionId, raceId(country))
        assert.equal(trip.locationCountry, country)
        assert.equal(trip.revision, 1)
        assert.deepEqual(
          (await f.call('POST', path(id) + '/expeditions', body)).json(),
          departed.json(),
        )
        const restarted = await createApp({ ...f.db, close: async () => {} }, f.config)
        try {
          const restored = await restarted.inject({
            url: path(id) + '/expedition',
            headers: { authorization: `Bearer ${f.user.token}` },
          })
          assert.deepEqual(restored.json().travel, trip)
        } finally {
          await restarted.close()
        }
        for (const raceDefinitionId of [
          'DEV_M3_MILE_1600',
          raceId(country === 'JPN' ? 'USA' : 'JPN'),
        ]) {
          assert.equal(
            (await f.call('POST', path(id) + '/race-entries', { ...runBody, raceDefinitionId }))
              .statusCode,
            422,
          )
        }
        // Existing health, contract and economic restrictions remain authoritative overseas.
        assert.equal(
          (
            await f.call('POST', path(id) + '/race-entries', {
              ...runBody,
              jockeyId: 'PARK_SEOYUN',
            })
          ).statusCode,
          422,
        )
        await f.db.query(
          "UPDATE careers SET state=jsonb_set(state,'{health}','\"중상\"') WHERE id=$1",
          [id],
        )
        assert.equal((await f.call('POST', path(id) + '/race-entries', runBody)).statusCode, 422)
        await f.db.query('UPDATE careers SET state=$2 WHERE id=$1', [
          id,
          JSON.stringify(start.state),
        ])
        await f.db.query(
          "UPDATE race_definitions SET payload=jsonb_set(payload,'{entryFee}','500000') WHERE id=$1",
          [raceId(country)],
        )
        await f.db.query('UPDATE stables SET funds=499999 WHERE id=$1', [start.stableId])
        assert.equal((await f.call('POST', path(id) + '/race-entries', runBody)).statusCode, 422)
        await f.db.query('UPDATE stables SET funds=20000000 WHERE id=$1', [start.stableId])
        const entered = await f.call('POST', path(id) + '/race-entries', runBody)
        assert.equal(entered.statusCode, 200, entered.body)
        const run = entered.json().career.state.raceRun
        assert.equal(run.raceDefinitionSnapshot.countryCode, country)
        assert.equal(entered.json().career.funds, 19500000)
        const logPath = path(id) + `/race-runs/${runBody.raceRunId}/log`
        const saved = (await f.call('GET', logPath)).json().log
        assert.equal(saved.engineVersion, 'race-sim-v4')
        assert.equal(raceLogDigest(saved), raceLogDigest(simulateRace(run, 'race-sim-v4')))
        const returnPath = path(id) + `/expeditions/${trip.activeExpedition.id}/return`
        const back = { commandId: randomUUID(), expectedTravelRevision: 1 }
        assert.ok(validateReturnExpedition(back))
        assert.equal((await f.call('POST', returnPath, back)).statusCode, 409)
        assert.equal(
          (
            await f.call('POST', path(id) + '/actions', {
              actionId: randomUUID(),
              choice: 'rest',
              expectedTurn: 3,
            })
          ).statusCode,
          409,
        )
        // Completion reads locked country/amounts even if the current catalog is subsequently corrected.
        await f.db.query(
          'UPDATE race_definitions SET country_code=$2,payload=payload || \'{"prize":1,"entryFee":1}\'::jsonb WHERE id=$1',
          [raceId(country), country === 'JPN' ? 'USA' : 'JPN'],
        )
        const finish = { commandId: randomUUID() }
        const completePath = path(id) + `/race-runs/${runBody.raceRunId}/complete`
        const completed = await f.call('POST', completePath, finish)
        assert.equal(completed.statusCode, 200, completed.body)
        assert.deepEqual(completed.json().result, saved.result)
        for (const retry of [finish, { commandId: randomUUID() }]) {
          assert.deepEqual((await f.call('POST', completePath, retry)).json(), completed.json())
        }
        assert.equal(completed.json().career.funds, 19500000 + saved.result.prizeMoney)
        assert.equal(completed.json().career.state.jockeyTrust.SEO_JIAN.starts, 1)
        assert.equal(
          completed.json().career.state.jockeyTrust.SEO_JIAN.trust,
          raceTrustChange(run, saved.result.placing).after,
        )
        assert.deepEqual((await f.call('GET', logPath)).json().log, saved)
        const returned = await f.call('POST', returnPath, back)
        assert.equal(returned.statusCode, 200, returned.body)
        assert.equal(returned.json().career.travel.locationCountry, 'KOR')
        assert.equal(returned.json().career.travel.revision, 2)
        assert.deepEqual(returned.json().career.state, completed.json().career.state)
        assert.deepEqual((await f.call('POST', returnPath, back)).json(), returned.json())
        assert.deepEqual(
          (await f.call('POST', returnPath, { ...back, commandId: randomUUID() })).json(),
          returned.json(),
        )
        assert.equal(
          (
            await f.call('POST', path(id) + '/expeditions', {
              ...body,
              commandId: randomUUID(),
              raceDefinitionId: undefined,
            })
          ).statusCode,
          409,
        )
        for (const turn of [4, 5]) {
          await advance(f, id, turn)
        }
        await choosePending(f, id)
        const domestic = (await f.call('GET', path(id) + '/race-entries'))
          .json()
          .races.find(
            (r: { definition: { countryCode: string }; eligible: boolean }) =>
              r.definition.countryCode === 'KOR' && r.eligible,
          )
        assert.ok(domestic)
        const enteredHome = await f.call('POST', path(id) + '/race-entries', {
          ...entry('KOR'),
          raceDefinitionId: domestic.definition.id,
          expectedTurn: 6,
        })
        assert.equal(enteredHome.statusCode, 200, enteredHome.body)
        const workspace = (await f.call('GET', '/v1/careers/workspace')).json()
        assert.ok(validateCareerWorkspace(workspace))
        assert.ok(workspace.stable && workspace.career)
        assert.deepEqual(workspace.stable.travel, workspace.career.travel)
      } finally {
        await f.db.query('UPDATE race_definitions SET payload=$2,country_code=$3 WHERE id=$1', [
          raceId(country),
          JSON.stringify(original),
          country,
        ])
        await f.close()
      }
    })
  }

  test(`${label}: concurrent departure/return converge; stale return cannot close a later expedition`, async () => {
    const f = await setup()
    try {
      const { id } = await f.create()
      const body = { commandId: randomUUID(), targetCountry: 'JPN', expectedTravelRevision: 0 }
      const same = await Promise.all(
        Array.from({ length: 8 }, () => f.call('POST', path(id) + '/expeditions', body)),
      )
      for (const r of same) {
        assert.equal(r.statusCode, 200, r.body)
        assert.deepEqual(r.json(), same[0].json())
      }
      const distinct = await Promise.all(
        Array.from({ length: 8 }, () =>
          f.call('POST', path(id) + '/expeditions', { ...body, commandId: randomUUID() }),
        ),
      )
      assert.ok(distinct.every((r) => r.statusCode === 200))
      assert.ok(distinct.every((r) => r.json().career.travel.revision === 1))
      assert.equal(
        (await f.call('POST', path(id) + '/expeditions', { ...body, targetCountry: 'USA' }))
          .statusCode,
        409,
      )
      const trip = await travel(f, id)
      const url = path(id) + `/expeditions/${trip.activeExpedition.id}/return`
      const back = { commandId: randomUUID(), expectedTravelRevision: 1 }
      for (const sameId of [true, false]) {
        const replies = await Promise.all(
          Array.from({ length: 8 }, () =>
            f.call('POST', url, { ...back, commandId: sameId ? back.commandId : randomUUID() }),
          ),
        )
        assert.ok(replies.every((r) => r.statusCode === 200))
        assert.ok(replies.every((r) => r.json().career.travel.revision === 2))
      }
      // Two fresh destinations contend for one unique active slot.
      const competing = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          f.call('POST', path(id) + '/expeditions', {
            ...body,
            commandId: randomUUID(),
            targetCountry: i % 2 ? 'JPN' : 'USA',
            expectedTravelRevision: 2,
          }),
        ),
      )
      assert.equal(competing.filter((r) => r.statusCode === 200).length, 4)
      assert.equal(competing.filter((r) => r.statusCode === 409).length, 4)
      const newer = await travel(f, id)
      assert.equal(newer.revision, 3)
      const before = await snapshot(f, id)
      assert.equal(
        (await f.call('POST', url, { commandId: randomUUID(), expectedTravelRevision: 1 }))
          .statusCode,
        200,
      )
      assert.deepEqual(await snapshot(f, id), before)
      assert.equal(
        (
          await f.db.query(
            "SELECT * FROM stable_expeditions WHERE stable_id=$1 AND status='active'",
            [before.career.stableId],
          )
        ).rows.length,
        1,
      )
    } finally {
      await f.close()
    }
  })

  test(`${label}: racing versus return is atomic and monthly actions cannot create another overseas run`, async () => {
    const f = await setup()
    try {
      const { id } = await ready(f)
      const started = await f.call('POST', path(id) + '/expeditions', {
        commandId: randomUUID(),
        targetCountry: 'JPN',
        expectedTravelRevision: 0,
      })
      const trip = started.json().career.travel.activeExpedition
      const body = entry('JPN')
      const back = { commandId: randomUUID(), expectedTravelRevision: 1 }
      const backPath = path(id) + `/expeditions/${trip.id}/return`
      const beforeEntry = await snapshot(f, id)
      const remove = await receiptFault(f, body.raceRunId)
      try {
        assert.equal((await f.call('POST', path(id) + '/race-entries', body)).statusCode, 500)
      } finally {
        await remove()
      }
      assert.deepEqual(await snapshot(f, id), beforeEntry)

      const [entered, returned] = await Promise.all([
        f.call('POST', path(id) + '/race-entries', body),
        f.call('POST', backPath, back),
      ])
      assert.ok(
        (entered.statusCode === 200 && returned.statusCode === 409) ||
          (entered.statusCode === 422 && returned.statusCode === 200),
        entered.body + '\n' + returned.body,
      )
      if (entered.statusCode === 200) {
        const completed = await f.call('POST', path(id) + `/race-runs/${body.raceRunId}/complete`, {
          commandId: randomUUID(),
        })
        assert.equal(completed.statusCode, 200, completed.body)
        assert.equal((await f.call('POST', backPath, back)).statusCode, 200)
      } else {
        assert.equal(
          (await f.db.query('SELECT * FROM race_runs WHERE career_id=$1', [id])).rows.length,
          0,
        )
        assert.equal((await snapshot(f, id)).ledger.length, 0)
        const action = await f.call('POST', path(id) + '/actions', {
          actionId: randomUUID(),
          choice: 'rest',
          expectedTurn: 3,
        })
        assert.equal(action.statusCode, 200, action.body)
        assert.equal((await f.call('POST', path(id) + '/race-entries', body)).statusCode, 409)
      }
      assert.equal((await travel(f, id)).locationCountry, 'KOR')
    } finally {
      await f.close()
    }
  })

  test(`${label}: receipt failures roll back travel, retirement closes it and a new horse inherits home country`, async () => {
    const f = await setup()
    try {
      const id = randomUUID()
      const created = await f.call('POST', '/v1/careers', {
        careerId: id,
        horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
        starterJockeyId: 'HAN_DOYUN' as const,
        homeCountry: 'JPN',
      })
      assert.equal(created.statusCode, 201, created.body)
      const start = { commandId: randomUUID(), targetCountry: 'USA', expectedTravelRevision: 0 }
      const before = await snapshot(f, id)
      let remove = await receiptFault(f, start.commandId)
      try {
        assert.equal((await f.call('POST', path(id) + '/expeditions', start)).statusCode, 500)
      } finally {
        await remove()
      }
      assert.deepEqual(await snapshot(f, id), before)
      const started = await f.call('POST', path(id) + '/expeditions', start)
      assert.equal(started.statusCode, 200, started.body)
      const back = { commandId: randomUUID(), expectedTravelRevision: 1 }
      const backPath =
        path(id) + `/expeditions/${started.json().career.travel.activeExpedition.id}/return`
      const active = await snapshot(f, id)
      remove = await receiptFault(f, back.commandId)
      try {
        assert.equal((await f.call('POST', backPath, back)).statusCode, 500)
      } finally {
        await remove()
      }
      assert.deepEqual(await snapshot(f, id), active)
      const retirement = { commandId: randomUUID(), expectedRevision: active.career.revision }
      remove = await receiptFault(f, retirement.commandId)
      try {
        assert.equal((await f.call('POST', path(id) + '/retirement', retirement)).statusCode, 500)
      } finally {
        await remove()
      }
      assert.deepEqual(await snapshot(f, id), active)
      const retired = await f.call('POST', path(id) + '/retirement', retirement)
      assert.equal(retired.statusCode, 200, retired.body)
      assert.equal(retired.json().retirement.snapshot.travel.homeCountry, 'JPN')
      assert.equal(retired.json().retirement.snapshot.travel.locationCountry, 'JPN')
      assert.equal(retired.json().retirement.snapshot.travel.activeExpedition, null)
      const next = await f.create()
      assert.equal(next.response.career.travel.homeCountry, 'JPN')
      assert.equal(next.response.career.travel.revision, 2)
      assert.equal(next.response.career.funds, 20000000)
      assert.notEqual(next.response.career.ownedHorseId, active.career.ownedHorseId)
      const history = (await snapshot(f, id)).expeditions
      assert.equal(history.length, 1)
      assert.equal(history[0].end_reason, 'retirement')
      await assert.rejects(
        f.db.query('DELETE FROM stable_expeditions WHERE id=$1', [history[0].id]),
        /Immutable expedition history/,
      )
      await assert.rejects(
        f.db.query("UPDATE stable_expeditions SET target_country='KOR' WHERE id=$1", [
          history[0].id,
        ]),
        /Immutable expedition history/,
      )
    } finally {
      await f.close()
    }
  })

  test(`${label}: owner scoping, supported home countries and unverified race countries fail closed`, async () => {
    const f = await setup()
    try {
      const id = randomUUID()
      const created = await f.call('POST', '/v1/careers', {
        careerId: id,
        horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
        starterJockeyId: 'HAN_DOYUN' as const,
        homeCountry: 'USA',
      })
      assert.equal(created.statusCode, 201, created.body)
      assert.equal(created.json().career.travel.homeCountry, 'USA')
      const unsupported = await f.call(
        'POST',
        '/v1/careers',
        {
          careerId: randomUUID(),
          horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
          starterJockeyId: 'HAN_DOYUN' as const,
          homeCountry: 'GBR',
        },
        f.other.token,
      )
      assert.equal(unsupported.statusCode, 422, unsupported.body)
      assert.equal(
        (await f.db.query('SELECT * FROM stables WHERE owner_id=$1', [f.other.principalId])).rows
          .length,
        0,
      )

      for (const turn of [1, 2]) {
        await advance(f, id, turn)
      }
      const options = (await f.call('GET', path(id) + '/race-entries')).json()
      assert.ok(
        options.races.find((r: { definition: { id: string } }) => r.definition.id === raceId('USA'))
          .eligible,
      )
      const start = { commandId: randomUUID(), targetCountry: 'JPN', expectedTravelRevision: 0 }
      assert.equal(
        (await f.call('GET', path(id) + '/expedition', undefined, f.other.token)).statusCode,
        404,
      )
      assert.equal(
        (await f.call('POST', path(id) + '/expeditions', start, f.other.token)).statusCode,
        404,
      )
      assert.equal((await f.app.inject({ url: path(id) + '/expedition' })).statusCode, 401)
      assert.equal(
        (await f.call('POST', path(id) + '/expeditions', { ...start, targetCountry: 'USA' }))
          .statusCode,
        422,
      )
      assert.equal(
        (
          await f.call('POST', path(id) + '/expeditions', {
            ...start,
            raceDefinitionId: 'RACE_USA_2026_BC_TURF',
          })
        ).statusCode,
        422,
      )
      assert.equal(
        (await f.call('POST', path(id) + '/expeditions', { ...start, targetCountry: 'GBR' }))
          .statusCode,
        400,
      )
      const departed = await f.call('POST', path(id) + '/expeditions', start)
      const tripId = departed.json().career.travel.activeExpedition.id
      assert.equal(
        (
          await f.call(
            'POST',
            path(id) + `/expeditions/${tripId}/return`,
            { commandId: randomUUID(), expectedTravelRevision: 1 },
            f.other.token,
          )
        ).statusCode,
        404,
      )
      const back = await f.call('POST', path(id) + `/expeditions/${tripId}/return`, {
        commandId: randomUUID(),
        expectedTravelRevision: 1,
      })
      assert.equal(back.statusCode, 200, back.body)
      const stableId = created.json().career.stableId
      await f.db.query("UPDATE stables SET home_country='GBR' WHERE id=$1", [stableId])
      assert.equal((await travel(f, id)).homeCountry, 'GBR')
      assert.equal(
        (
          await f.call('POST', path(id) + '/expeditions', {
            ...start,
            commandId: randomUUID(),
            expectedTravelRevision: 2,
          })
        ).statusCode,
        422,
      )
      assert.equal((await f.call('POST', path(id) + '/race-entries', entry('USA'))).statusCode, 422)
      await f.db.query("UPDATE stables SET home_country='USA' WHERE id=$1", [stableId])
      await f.db.query('UPDATE race_definitions SET country_code=NULL WHERE id=$1', [raceId('USA')])
      try {
        assert.equal(
          (await f.call('POST', path(id) + '/race-entries', entry('USA'))).statusCode,
          422,
        )
      } finally {
        await f.db.query("UPDATE race_definitions SET country_code='USA' WHERE id=$1", [
          raceId('USA'),
        ])
      }
      assert.equal(
        (
          await f.call('POST', '/v1/careers', {
            careerId: randomUUID(),
            horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
            starterJockeyId: 'HAN_DOYUN' as const,
            homeCountry: 'KOR',
          })
        ).statusCode,
        409,
      )
    } finally {
      await f.close()
    }
  })
}
