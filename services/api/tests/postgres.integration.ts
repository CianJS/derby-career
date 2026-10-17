import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { raceTrustChange } from '../../../packages/shared/src/domain'
import { importEvents } from '../src/modules/events/import'
import { digest } from '../src/services/identity'
import type { EventDefinition } from '../../../packages/shared/src/events'
import { postgresDatabase } from '../src/db'
import { importRacingCatalog, readRacingSource } from '../src/modules/racing/import'
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
    assert.equal(run.json().metadata.engineVersion, 'race-sim-v4')
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
    for (const response of completed) {
      assert.deepEqual(response.json().career, completed[0].json().career)
    }
    const relation = (
      await f.db.query(
        'SELECT starts,chemistry FROM jockey_chemistry WHERE horse_id=$1 AND jockey_id=$2',
        [completed[0].json().career.ownedHorseId, entry.jockeyId],
      )
    ).rows[0]
    assert.equal(relation.starts, 1)
    const expectedTrust = raceTrustChange(
      run.json().raceRun,
      run.json().raceRun.simulation.result.placing,
    ).after
    assert.equal(relation.chemistry, expectedTrust)
    assert.ok(
      completed.every((r) => r.json().career.state.jockeyTrust.SEO_JIAN.trust === expectedTrust),
    )
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
    const owner = (await f.db.query('SELECT owner_id FROM careers WHERE id=$1', [careerId])).rows[0]
      .owner_id
    // Creation has no existing Career to lock, so its receipt has career_id=NULL.
    assert.equal(
      (
        await f.db.query('SELECT * FROM commands WHERE principal_id=$1 AND request_id IN ($2,$3)', [
          owner,
          careerId,
          actionId,
        ])
      ).rows.length,
      2,
    )
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

test('real PostgreSQL serializes reference catalog imports without touching playable races', async () => {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database')
  }
  const f = await fixture({ db: postgresDatabase(url) })
  try {
    const source = await readRacingSource(['seeds/racing.notion.source.json'])
    const before = (await f.call('GET', '/v1/catalog/races')).json()
    const results = await Promise.all(
      Array.from({ length: 3 }, () => importRacingCatalog(f.db, source)),
    )
    assert.ok(
      results.every((r) => r.committed),
      JSON.stringify(results),
    )
    assert.ok(results.every((r) => r.created + r.updated + r.unchanged === 1042))
    assert.ok(results.filter((r) => r.created > 0).length <= 1)
    assert.equal((await importRacingCatalog(f.db, source)).unchanged, 1042)
    for (const [table, count] of [
      ['racecourses', 90],
      ['racecourse_courses', 101],
      ['race_schedules', 851],
    ] as const) {
      assert.equal(
        Number((await f.db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),
        count,
      )
      await assert.rejects(
        f.db.query(`UPDATE ${table} SET payload=jsonb_set(payload,'{gameEnabled}','true')`),
      )
    }
    assert.deepEqual((await f.call('GET', '/v1/catalog/races')).json(), before)
    assert.equal((await f.call('GET', '/health/ready')).statusCode, 200)
    const schedule = (await f.call('GET', '/v1/race-schedule?country=USA&pageSize=100')).json()
    assert.equal(schedule.pagination.total, 621)
    assert.equal(
      Number(
        (await f.db.query('SELECT count(*) AS n FROM race_schedules WHERE race_date IS NULL'))
          .rows[0].n,
      ),
      41,
    )
  } finally {
    await f.close()
  }
})

test('real PostgreSQL serializes explicit trust event choices and new command retries exactly once', async () => {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Dedicated test database required')
  }
  const f = await fixture({ db: postgresDatabase(url), probability: 1 })
  const enabledBefore = (
    await f.db.query<{ id: string; enabled: boolean }>(
      'SELECT id,enabled FROM event_definitions ORDER BY id',
    )
  ).rows
  try {
    const source = (await f.call('GET', '/v1/events/COM-0001')).json<EventDefinition>()
    const { revision: _revision, ...base } = source
    const definition = {
      ...base,
      id: 'COM-TRUST-PG-TEST',
      timing: 'month_start' as const,
      automatic: false,
      enabled: true,
      status: 'ready' as const,
      conditions: [{ type: 'always' as const }],
      choices: [
        {
          id: 'A',
          label: 'test only',
          conditions: [],
          effects: [{ type: 'jockey_trust' as const, jockeyId: 'SEO_JIAN', amount: 8 as const }],
        },
      ],
    }
    await importEvents(f.db, {
      schemaVersion: 1,
      events: [{ ...definition, revision: digest(definition) }],
    })
    await f.db.query("UPDATE event_definitions SET enabled=(id='COM-TRUST-PG-TEST')")
    const { id, response } = await f.create()
    const path = `/v1/careers/${id}/events/${response.career.event.id}/choice`
    const command = { commandId: randomUUID(), choiceId: 'A', expectedTurn: 1 }
    for (const sameId of [true, false]) {
      const replies = await Promise.all(
        Array.from({ length: 8 }, () =>
          f.call('POST', path, {
            ...command,
            commandId: sameId ? command.commandId : randomUUID(),
          }),
        ),
      )
      assert.ok(
        replies.every((reply) => reply.statusCode === 200),
        replies.map((reply) => reply.body).join('\n'),
      )
      assert.ok(
        replies.every((reply) => reply.json().career.state.jockeyTrust.SEO_JIAN.trust === 8),
      )
    }
    const relations = (await f.call('GET', `/v1/careers/${id}/jockey-relations`)).json()
    assert.deepEqual(
      relations.data.find((r: { jockeyId: string }) => r.jockeyId === 'SEO_JIAN'),
      { jockeyId: 'SEO_JIAN', starts: 0, trust: 8 },
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
  } finally {
    try {
      // The native suite shares its catalog with the compiled HTTP smoke. Restore its exact activation flags.
      await f.db.transaction(async (tx) => {
        await tx.query("UPDATE event_definitions SET enabled=false WHERE id='COM-TRUST-PG-TEST'")
        await tx.query(
          'UPDATE event_definitions d SET enabled=b.enabled FROM jsonb_to_recordset($1::jsonb) AS b(id text,enabled boolean) WHERE d.id=b.id',
          [JSON.stringify(enabledBefore)],
        )
      })
    } finally {
      await f.close()
    }
  }
})
