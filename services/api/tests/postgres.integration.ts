import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { postgresDatabase } from '../src/db'
import { fixture } from './helpers'

test('real PostgreSQL row locks serialize concurrent monthly actions and race payouts', async () => {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database')
  }
  const f = await fixture({ db: postgresDatabase(url) })
  try {
    const { id } = await f.create()
    const first = { actionId: randomUUID(), choice: 'speed', expectedTurn: 1 }
    const same = await Promise.all(
      Array.from({ length: 8 }, () => f.call('POST', `/v1/careers/${id}/actions`, first)),
    )
    assert.ok(
      same.every((r) => r.statusCode === 200),
      same.map((r) => r.body).join('\n'),
    )
    for (const r of same) {
      assert.deepEqual(r.json(), same[0].json())
    }
    assert.equal(
      Number(
        (await f.db.query('SELECT count(*) AS n FROM monthly_actions WHERE career_id=$1', [id]))
          .rows[0].n,
      ),
      1,
    )
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/months/advance`, {
          commandId: randomUUID(),
          actionId: first.actionId,
          expectedTurn: 1,
        })
      ).statusCode,
      200,
    )
    const distinct = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.call('POST', `/v1/careers/${id}/actions`, {
          actionId: randomUUID(),
          choice: 'rest',
          expectedTurn: 2,
        }),
      ),
    )
    assert.equal(distinct.filter((r) => r.statusCode === 200).length, 1)
    assert.equal(distinct.filter((r) => r.statusCode === 409).length, 7)
    const actionId = distinct.find((r) => r.statusCode === 200)!.json().actionId
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/months/advance`, {
          commandId: randomUUID(),
          actionId,
          expectedTurn: 2,
        })
      ).statusCode,
      200,
    )
    const entry = {
      raceRunId: randomUUID(),
      raceDefinitionId: 'DEV_M3_MILE_1600',
      jockeyId: 'SEO_JIAN',
      tactic: '선입',
      expectedTurn: 3,
    }
    const entered = await Promise.all(
      Array.from({ length: 4 }, () => f.call('POST', `/v1/careers/${id}/race-entries`, entry)),
    )
    assert.ok(
      entered.every((r) => r.statusCode === 200),
      entered.map((r) => r.body).join('\n'),
    )
    for (const r of entered) {
      assert.deepEqual(r.json(), entered[0].json())
    }
    const run = await f.call('GET', `/v1/careers/${id}/race-runs/${entry.raceRunId}`)
    const completed = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.call('POST', `/v1/careers/${id}/race-runs/${entry.raceRunId}/complete`, {
          commandId: randomUUID(),
        }),
      ),
    )
    assert.ok(
      completed.every((r) => r.statusCode === 200),
      completed.map((r) => r.body).join('\n'),
    )
    assert.ok(
      completed.every(
        (r) => r.json().career.funds === 20000000 + run.json().raceRun.simulation.result.prizeMoney,
      ),
    )
    assert.ok(completed.every((r) => r.json().career.state.careerTurnIndex === 4))
    assert.equal(
      Number(
        (
          await f.db.query('SELECT count(*) AS n FROM race_results WHERE race_run_id=$1', [
            entry.raceRunId,
          ])
        ).rows[0].n,
      ),
      1,
    )
    assert.equal(
      Number(
        (
          await f.db.query('SELECT count(*) AS n FROM stable_ledger WHERE race_run_id=$1', [
            entry.raceRunId,
          ])
        ).rows[0].n,
      ),
      1,
    )
  } finally {
    await f.close()
  }
})
