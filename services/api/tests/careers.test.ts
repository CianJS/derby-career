import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  commitAction,
  resolveAction,
  simulateRace,
  raceLogDigest,
} from '../../../packages/shared/src/domain'
import { fixture } from './helpers'

test('server monthly calculation uses the exact existing domain, retries replay and different commands cannot double grow/advance', async () => {
  const f = await fixture()
  try {
    const { id, response } = await f.create()
    const before = response.career.state
    const body = { actionId: randomUUID(), choice: 'speed', expectedTurn: 1 }
    const [one, two] = await Promise.all([
      f.call('POST', `/v1/careers/${id}/actions`, body),
      f.call('POST', `/v1/careers/${id}/actions`, body),
    ])
    assert.equal(one.statusCode, 200, one.body)
    assert.equal(two.statusCode, 200, two.body)
    assert.deepEqual(one.json(), two.json())
    const expected = resolveAction(commitAction(before, 'speed'))
    assert.deepEqual(one.json().career.state.values, expected.values)
    assert.deepEqual(one.json().career.state.action, expected.action)
    assert.equal(
      (await f.call('POST', `/v1/careers/${id}/actions`, { ...body, choice: 'power' })).statusCode,
      409,
    )
    assert.equal(
      (await f.call('POST', `/v1/careers/${id}/actions`, { ...body, actionId: randomUUID() }))
        .statusCode,
      409,
    )
    assert.equal(
      (await f.call('POST', `/v1/careers/${id}/actions`, { ...body, result: { speed: 999 } }))
        .statusCode,
      400,
    )
    const next = { commandId: randomUUID(), actionId: body.actionId, expectedTurn: 1 }
    const advanced = await f.call('POST', `/v1/careers/${id}/months/advance`, next)
    assert.equal(advanced.statusCode, 200, advanced.body)
    assert.equal(advanced.json().career.state.careerTurnIndex, 2)
    assert.deepEqual(
      (await f.call('POST', `/v1/careers/${id}/months/advance`, next)).json(),
      advanced.json(),
    )
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/months/advance`, {
          ...next,
          commandId: randomUUID(),
        })
      ).statusCode,
      409,
    )
    assert.deepEqual((await f.call('POST', `/v1/careers/${id}/actions`, body)).json(), one.json())
    const current = await f.call('GET', `/v1/careers/${id}`)
    assert.equal(current.json().career.state.careerTurnIndex, 2)
    const history = await f.call('GET', `/v1/careers/${id}/actions`)
    assert.equal(history.json().data.length, 1)
    assert.equal(
      (
        await f.call('POST', '/v1/careers', {
          careerId: randomUUID(),
          horseDefinitionId: 'DEV_HORSE_RED_COMET',
        })
      ).statusCode,
      409,
    )
    await assert.rejects(
      f.db.query("UPDATE monthly_actions SET result='{}' WHERE career_id=$1", [id]),
      /Immutable monthly action/,
    )
  } finally {
    await f.close()
  }
})
test('restricted actions and transaction failures leave no partial action/receipt or changed growth', async () => {
  const f = await fixture()
  try {
    const { id, response } = await f.create()
    const invalid = { actionId: randomUUID(), choice: 'treatment', expectedTurn: 1 }
    assert.equal((await f.call('POST', `/v1/careers/${id}/actions`, invalid)).statusCode, 422)
    assert.deepEqual((await f.call('GET', `/v1/careers/${id}`)).json(), response)
    assert.equal((await f.call('GET', `/v1/careers/${id}/actions`)).json().data.length, 0)
    assert.equal(
      (await f.db.query('SELECT * FROM commands WHERE request_id=$1', [invalid.actionId])).rows
        .length,
      0,
    )
    await f.db.query(
      "UPDATE careers SET state=jsonb_set(state,'{health}','\"경상\"') WHERE id=$1",
      [id],
    )
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/actions`, {
          actionId: randomUUID(),
          choice: 'speed',
          expectedTurn: 1,
        })
      ).statusCode,
      422,
    )
    const injured = (await f.call('GET', `/v1/careers/${id}`)).json().career.state
    const treated = await f.call('POST', `/v1/careers/${id}/actions`, {
      actionId: randomUUID(),
      choice: 'treatment',
      expectedTurn: 1,
    })
    const expected = resolveAction(commitAction(injured, 'treatment'))
    assert.equal(treated.statusCode, 200, treated.body)
    assert.equal(treated.json().career.state.health, expected.health)
    assert.equal(treated.json().career.state.healthRecovery, expected.healthRecovery)
  } finally {
    await f.close()
  }
})
test('locked v1/v2 logs determine results; race completion cannot duplicate payout, history or month progression', async () => {
  for (const engine of ['race-sim-v1', 'race-sim-v2'] as const) {
    const f = await fixture()
    try {
      const { id } = await f.create()
      for (let turn = 1; turn <= 2; turn++) {
        const actionId = randomUUID()
        assert.equal(
          (
            await f.call('POST', `/v1/careers/${id}/actions`, {
              actionId,
              choice: 'rest',
              expectedTurn: turn,
            })
          ).statusCode,
          200,
        )
        assert.equal(
          (
            await f.call('POST', `/v1/careers/${id}/months/advance`, {
              commandId: randomUUID(),
              actionId,
              expectedTurn: turn,
            })
          ).statusCode,
          200,
        )
      }
      const entry = {
        raceRunId: randomUUID(),
        raceDefinitionId: 'DEV_M3_MILE_1600',
        jockeyId: 'SEO_JIAN',
        tactic: '선입',
        expectedTurn: 3,
        engineVersion: engine,
      }
      await f.db.query(
        "UPDATE careers SET state=jsonb_set(state,'{health}','\"중상\"') WHERE id=$1",
        [id],
      )
      assert.equal((await f.call('POST', `/v1/careers/${id}/race-entries`, entry)).statusCode, 422)
      await f.db.query(
        "UPDATE careers SET state=jsonb_set(state,'{health}','\"중등도\"') WHERE id=$1",
        [id],
      )
      assert.equal(
        (
          await f.call('POST', `/v1/careers/${id}/race-entries`, {
            ...entry,
            jockeyId: 'PARK_SEOYUN',
          })
        ).statusCode,
        422,
      )
      const run = await f.call('POST', `/v1/careers/${id}/race-entries`, entry)
      assert.equal(run.statusCode, 200, run.body)
      assert.deepEqual(
        (await f.call('POST', `/v1/careers/${id}/race-entries`, entry)).json(),
        run.json(),
      )
      const details = await f.call('GET', `/v1/careers/${id}/race-runs/${entry.raceRunId}`)
      assert.equal(details.json().healthAtEntry, '중등도')
      assert.equal(details.json().metadata.engineVersion, engine)
      const log = await f.call('GET', `/v1/careers/${id}/race-runs/${entry.raceRunId}/log`)
      assert.equal(log.statusCode, 200, log.body)
      assert.equal(
        raceLogDigest(log.json().log),
        raceLogDigest(simulateRace(details.json().raceRun, engine)),
      )
      assert.equal(
        (
          await f.call(
            'GET',
            `/v1/careers/${id}/race-runs/${entry.raceRunId}/log`,
            undefined,
            f.other.token,
          )
        ).statusCode,
        404,
      )
      assert.equal(
        (
          await f.call('POST', `/v1/careers/${id}/race-runs/${entry.raceRunId}/complete`, {
            commandId: randomUUID(),
            prizeMoney: 999999999,
          })
        ).statusCode,
        400,
      )
      const command = { commandId: randomUUID() }
      const completed = await f.call(
        'POST',
        `/v1/careers/${id}/race-runs/${entry.raceRunId}/complete`,
        command,
      )
      assert.equal(completed.statusCode, 200, completed.body)
      assert.deepEqual(completed.json().result, log.json().log.result)
      assert.equal(completed.json().career.state.careerTurnIndex, 4)
      assert.equal(completed.json().career.funds, 20000000 + completed.json().result.prizeMoney)
      assert.deepEqual(
        (
          await f.call('POST', `/v1/careers/${id}/race-runs/${entry.raceRunId}/complete`, command)
        ).json(),
        completed.json(),
      )
      const again = await f.call(
        'POST',
        `/v1/careers/${id}/race-runs/${entry.raceRunId}/complete`,
        { commandId: randomUUID() },
      )
      assert.equal(again.statusCode, 200, again.body)
      assert.equal(again.json().career.funds, completed.json().career.funds)
      assert.equal(again.json().career.state.careerTurnIndex, 4)
      assert.equal((await f.call('GET', `/v1/careers/${id}/records`)).json().data.length, 1)
      assert.equal(
        (await f.db.query('SELECT * FROM stable_ledger WHERE race_run_id=$1', [entry.raceRunId]))
          .rows.length,
        1,
      )
      await assert.rejects(
        f.db.query('UPDATE race_results SET prize_money=0 WHERE race_run_id=$1', [entry.raceRunId]),
        /Immutable history/,
      )
      await assert.rejects(
        f.db.query('DELETE FROM race_simulation_logs WHERE race_run_id=$1', [entry.raceRunId]),
        /Immutable history/,
      )
    } finally {
      await f.close()
    }
  }
})
