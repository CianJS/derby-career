import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { postgresDatabase } from '../src/db'
import { fixture } from './helpers'
import { createApp } from '../src/app'
import { oidcConfig, testIssuer } from './oidc-helpers'

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

test('real PostgreSQL maps simultaneous refreshed production JWTs to one owner and one command receipt', async () => {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database')
  }
  const f = await fixture({ db: postgresDatabase(url) })
  const issuer = await testIssuer()
  const app = await createApp({ ...f.db, close: async () => {} }, oidcConfig(), {
    jwksFetch: issuer.fetcher,
  })
  try {
    const subject = 'postgres-owner-' + randomUUID()
    const tokens = await Promise.all(
      Array.from({ length: 8 }, () => issuer.sign(subject, { jti: randomUUID() })),
    )
    const careerId = randomUUID()
    const created = await Promise.all(
      tokens.map((token) =>
        app.inject({
          method: 'POST',
          url: '/v1/careers',
          headers: { authorization: `Bearer ${token}` },
          payload: { careerId, horseDefinitionId: 'DEV_HORSE_SERENE_STEP' },
        }),
      ),
    )
    for (const result of created) {
      assert.equal(result.statusCode, 201, result.body)
      assert.deepEqual(result.json(), created[0].json())
    }
    assert.equal(issuer.requests.length, 1)
    const actionId = randomUUID()
    const actions = await Promise.all(
      tokens.map((token) =>
        app.inject({
          method: 'POST',
          url: `/v1/careers/${careerId}/actions`,
          headers: { authorization: `Bearer ${token}` },
          payload: { actionId, choice: 'rest', expectedTurn: 1 },
        }),
      ),
    )
    for (const result of actions) {
      assert.equal(result.statusCode, 200, result.body)
      assert.deepEqual(result.json(), actions[0].json())
    }
    assert.equal(
      (await f.db.query('SELECT * FROM monthly_actions WHERE career_id=$1', [careerId])).rows
        .length,
      1,
    )
    assert.equal(
      (await f.db.query('SELECT * FROM commands WHERE career_id=$1', [careerId])).rows.length,
      2,
    )
    const owner = (await f.db.query('SELECT owner_id FROM careers WHERE id=$1', [careerId])).rows[0]
      .owner_id
    assert.equal(
      (await f.db.query('SELECT provider FROM principals WHERE id=$1', [owner])).rows[0].provider,
      'external',
    )
  } finally {
    await app.close()
    await f.close()
  }
})

test('real PostgreSQL retirement serializes retries, different commands and concurrent growth', async () => {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database')
  }
  const f = await fixture({ db: postgresDatabase(url) })
  try {
    const { id, response } = await f.create()
    const body = { commandId: randomUUID(), expectedRevision: response.career.revision }
    const same = await Promise.all(
      Array.from({ length: 8 }, () => f.call('POST', `/v1/careers/${id}/retirement`, body)),
    )
    for (const result of same) {
      assert.equal(result.statusCode, 200, result.body)
      assert.deepEqual(result.json(), same[0].json())
    }
    assert.equal(
      (await f.db.query('SELECT * FROM career_records WHERE career_id=$1', [id])).rows.length,
      1,
    )
    assert.equal(
      (await f.db.query('SELECT * FROM commands WHERE request_id=$1', [body.commandId])).rows
        .length,
      1,
    )
    assert.equal((await f.call('GET', `/v1/careers/${id}`)).json().career.revision, 2)

    const next = await f.create()
    const distinct = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.call('POST', `/v1/careers/${next.id}/retirement`, {
          commandId: randomUUID(),
          expectedRevision: next.response.career.revision,
        }),
      ),
    )
    assert.equal(distinct.filter((result) => result.statusCode === 200).length, 1)
    assert.equal(distinct.filter((result) => result.statusCode === 409).length, 7)
    assert.equal(
      (await f.db.query('SELECT * FROM career_records WHERE career_id=$1', [next.id])).rows.length,
      1,
    )

    const racing = await f.create()
    const [action, retirement] = await Promise.all([
      f.call('POST', `/v1/careers/${racing.id}/actions`, {
        actionId: randomUUID(),
        choice: 'rest',
        expectedTurn: 1,
      }),
      f.call('POST', `/v1/careers/${racing.id}/retirement`, {
        commandId: randomUUID(),
        expectedRevision: racing.response.career.revision,
      }),
    ])
    assert.deepEqual([action.statusCode, retirement.statusCode].sort(), [200, 409])
    const current = (await f.call('GET', `/v1/careers/${racing.id}`)).json().career
    if (retirement.statusCode === 200) {
      assert.equal(current.status, 'retired')
      assert.deepEqual(current.state, racing.response.career.state)
      assert.equal(
        (await f.db.query('SELECT * FROM monthly_actions WHERE career_id=$1', [racing.id])).rows
          .length,
        0,
      )
    } else {
      assert.equal(current.status, 'active')
      assert.deepEqual(current.state, action.json().career.state)
      assert.equal(
        (await f.db.query('SELECT * FROM career_records WHERE career_id=$1', [racing.id])).rows
          .length,
        0,
      )
    }
  } finally {
    await f.close()
  }
})
