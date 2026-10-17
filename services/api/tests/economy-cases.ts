import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Database } from '../src/db'
import { fixture } from './helpers'
import { settleRaceMoney } from '../src/repositories/race-economy'
import { raceLogDigest, simulateRace, raceTrustChange } from '../../../packages/shared/src/domain'

type Fixture = Awaited<ReturnType<typeof fixture>>
const raceId = 'DEV_M3_MILE_1600'
const entry = () => ({
  raceRunId: randomUUID(),
  raceDefinitionId: raceId,
  jockeyId: 'SEO_JIAN',
  tactic: '선입' as const,
  expectedTurn: 3,
})
async function ready(f: Fixture, fee = 500000) {
  const created = await f.create()
  for (let turn = 1; turn < 3; turn++) {
    const actionId = randomUUID()
    const action = await f.call('POST', `/v1/careers/${created.id}/actions`, {
      actionId,
      choice: 'rest',
      expectedTurn: turn,
    })
    assert.equal(action.statusCode, 200, action.body)
    const next = await f.call('POST', `/v1/careers/${created.id}/months/advance`, {
      commandId: randomUUID(),
      actionId,
      expectedTurn: turn,
    })
    assert.equal(next.statusCode, 200, next.body)
  }
  // Test-only DB catalog, not a client-supplied fee. Two runners guarantee a positive saved prize.
  await f.db.query('UPDATE race_definitions SET payload=payload || $2::jsonb WHERE id=$1', [
    raceId,
    JSON.stringify({ entryFee: fee, runners: 2 }),
  ])
  return created
}
async function snapshot(f: Fixture, id: string) {
  const career = (await f.call('GET', `/v1/careers/${id}`)).json().career
  const tables = ['monthly_actions', 'race_runs', 'race_results', 'commands']
  const counts = await Promise.all(
    tables.map(
      async (table) =>
        (await f.db.query(`SELECT count(*)::int AS n FROM ${table} WHERE career_id=$1`, [id]))
          .rows[0].n,
    ),
  )
  return {
    career,
    counts,
    ledger: (
      await f.db.query('SELECT * FROM stable_ledger WHERE stable_id=$1 ORDER BY id', [
        career.stableId,
      ])
    ).rows,
    relations: (await f.call('GET', `/v1/careers/${id}/jockey-relations`)).json(),
    logs: (
      await f.db.query(
        'SELECT l.* FROM race_simulation_logs l JOIN race_runs r ON r.id=l.race_run_id WHERE r.career_id=$1 ORDER BY r.id',
        [id],
      )
    ).rows,
  }
}
async function fault(f: Fixture, table: string, column: string, id: string) {
  const name = 'economy_fail_' + randomUUID().replaceAll('-', '')
  await f.db.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.${column}='${id}'::uuid THEN RAISE EXCEPTION 'injected economy failure'; END IF; RETURN NEW; END $$`,
  )
  await f.db.query(
    `CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  )
  return async () => {
    await f.db.query(`DROP TRIGGER ${name} ON ${table}`)
    await f.db.query(`DROP FUNCTION ${name}()`)
  }
}

/** The same HTTP/SQL assertions run on embedded PostgreSQL and a native multi-connection pool. */
export function registerEconomyTests(label: string, database?: () => Database) {
  const setup = () => fixture(database ? { db: database() } : {})
  test(`${label}: initial funds, paid/free entries, retirement and next horse preserve the ledger`, async () => {
    const f = await setup()
    const original = (
      await f.db.query('SELECT payload FROM race_definitions WHERE id=$1', [raceId])
    ).rows[0].payload
    try {
      const { id, response } = await ready(f)
      assert.equal(response.career.funds, 20000000)
      const command = entry()
      const path = `/v1/careers/${id}/race-entries`
      assert.equal((await f.call('POST', path, { ...command, entryFee: 0 })).statusCode, 400)
      assert.equal((await f.call('POST', path, command, f.other.token)).statusCode, 404)
      const entered = await f.call('POST', path, command)
      assert.equal(entered.statusCode, 200, entered.body)
      assert.equal(entered.json().career.funds, 19500000)
      assert.deepEqual((await f.call('POST', path, command)).json(), entered.json())
      const logPath = `/v1/careers/${id}/race-runs/${command.raceRunId}/log`
      const log = (await f.call('GET', logPath)).json().log
      const completePath = `/v1/careers/${id}/race-runs/${command.raceRunId}/complete`
      const complete = { commandId: randomUUID() }
      const finished = await f.call('POST', completePath, complete)
      assert.equal(finished.statusCode, 200, finished.body)
      const funds = 19500000 + log.result.prizeMoney
      assert.equal(finished.json().career.funds, funds)
      assert.deepEqual((await f.call('POST', completePath, complete)).json(), finished.json())
      assert.deepEqual(
        (await f.call('POST', completePath, { commandId: randomUUID() })).json(),
        finished.json(),
      )
      assert.deepEqual(
        (
          await f.db.query(
            'SELECT kind,amount::text FROM stable_ledger WHERE race_run_id=$1 ORDER BY kind',
            [command.raceRunId],
          )
        ).rows,
        [
          { kind: 'entry_fee', amount: '-500000' },
          { kind: 'prize', amount: String(log.result.prizeMoney) },
        ],
      )
      const retirement = await f.call('POST', `/v1/careers/${id}/retirement`, {
        commandId: randomUUID(),
        expectedRevision: finished.json().career.revision,
      })
      assert.equal(retirement.statusCode, 200, retirement.body)
      const next = await f.create()
      assert.equal(next.response.career.stableId, response.career.stableId)
      assert.notEqual(next.response.career.ownedHorseId, response.career.ownedHorseId)
      assert.equal(next.response.career.funds, funds)
      assert.equal(next.response.career.state.raceRecords.length, 0)
      assert.ok(next.response.career.state.jockeyTrust.SEO_JIAN.trust === 0)
      assert.equal(
        (await f.call('GET', `/v1/careers/${id}/retirement`)).json().retirement.snapshot.funds,
        funds,
      )
      assert.equal(
        (
          await f.db.query('SELECT * FROM stable_ledger WHERE stable_id=$1', [
            response.career.stableId,
          ])
        ).rows.length,
        2,
      )
      assert.deepEqual((await f.call('GET', logPath)).json().log, log)
      // A new horse at month three can enter a free race even with no cash.
      await f.db.query(
        "UPDATE careers SET turn=3,state=jsonb_set(state,'{careerTurnIndex}','3') WHERE id=$1",
        [next.id],
      )
      await f.db.query('UPDATE stables SET funds=0 WHERE id=$1', [response.career.stableId])
      await f.db.query(
        "UPDATE race_definitions SET payload=jsonb_set(payload,'{entryFee}','0') WHERE id=$1",
        [raceId],
      )
      const free = entry()
      const freeReply = await f.call('POST', `/v1/careers/${next.id}/race-entries`, free)
      assert.equal(freeReply.statusCode, 200, freeReply.body)
      assert.equal(freeReply.json().career.funds, 0)
      assert.equal(
        Number(
          (
            await f.db.query('SELECT amount FROM stable_ledger WHERE race_run_id=$1', [
              free.raceRunId,
            ])
          ).rows[0].amount,
        ),
        0,
      )
    } finally {
      await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
        raceId,
        JSON.stringify(original),
      ])
      await f.close()
    }
  })

  test(`${label}: invalid catalog money and insufficient funds leave every write rolled back`, async () => {
    const f = await setup()
    const original = (
      await f.db.query('SELECT payload FROM race_definitions WHERE id=$1', [raceId])
    ).rows[0].payload
    try {
      const { id, response } = await ready(f)
      const path = `/v1/careers/${id}/race-entries`
      const command = entry()
      for (const key of ['entryFee', 'prize']) {
        for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '500000', null]) {
          await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
            raceId,
            JSON.stringify({ ...original, entryFee: 500000, [key]: invalid }),
          ])
          const before = await snapshot(f, id)
          const denied = await f.call('POST', path, command)
          assert.equal(denied.statusCode, 500, denied.body)
          assert.equal(denied.json().error.code, 'INVALID_SETTLEMENT_AMOUNT')
          assert.deepEqual(await snapshot(f, id), before)
        }
      }
      await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
        raceId,
        JSON.stringify({ ...original, entryFee: 500000 }),
      ])
      const optionsBefore = (await f.call('GET', path)).json()
      assert.equal(
        optionsBefore.races.find((r: { definition: { id: string } }) => r.definition.id === raceId)
          .eligible,
        true,
      )
      // A stale successful eligibility response does not authorize spending.
      await f.db.query('UPDATE stables SET funds=499999 WHERE id=$1', [response.career.stableId])
      const options = (await f.call('GET', path)).json()
      assert.equal(
        options.races.find((r: { definition: { id: string } }) => r.definition.id === raceId)
          .eligible,
        false,
      )
      const before = await snapshot(f, id)
      assert.equal((await f.call('POST', path, command)).statusCode, 422)
      assert.deepEqual(await snapshot(f, id), before)
      await f.db.query('UPDATE stables SET funds=500000 WHERE id=$1', [response.career.stableId])
      const exact = await f.call('POST', path, command)
      assert.equal(exact.statusCode, 200, exact.body)
      assert.equal(exact.json().career.funds, 0)
    } finally {
      await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
        raceId,
        JSON.stringify(original),
      ])
      await f.close()
    }
  })

  test(`${label}: parallel same/different entry IDs debit exactly once`, async () => {
    const f = await setup()
    const original = (
      await f.db.query('SELECT payload FROM race_definitions WHERE id=$1', [raceId])
    ).rows[0].payload
    try {
      const { id } = await ready(f)
      const path = `/v1/careers/${id}/race-entries`
      const command = entry()
      const same = await Promise.all(Array.from({ length: 8 }, () => f.call('POST', path, command)))
      for (const r of same) {
        assert.equal(r.statusCode, 200, r.body)
        assert.deepEqual(r.json(), same[0].json())
      }
      const distinct = await Promise.all(
        Array.from({ length: 8 }, () => f.call('POST', path, entry())),
      )
      assert.ok(distinct.every((r) => r.statusCode === 409))
      assert.equal((await f.call('POST', path, { ...command, tactic: '추입' })).statusCode, 409)
      assert.equal(same[0].json().career.funds, 19500000)
      const state = await snapshot(f, id)
      assert.equal(state.ledger.length, 1)
      assert.equal(state.counts[1], 1)
      assert.equal(state.logs.length, 1)
      // Racing and another core action must also contend for the same monthly slot.
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
    } finally {
      await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
        raceId,
        JSON.stringify(original),
      ])
      await f.close()
    }
  })

  test(`${label}: simultaneous fresh entry IDs compete for one paid monthly action`, async () => {
    const f = await setup()
    const original = (
      await f.db.query('SELECT payload FROM race_definitions WHERE id=$1', [raceId])
    ).rows[0].payload
    try {
      const { id } = await ready(f)
      const replies = await Promise.all(
        Array.from({ length: 8 }, () => f.call('POST', `/v1/careers/${id}/race-entries`, entry())),
      )
      assert.equal(replies.filter((r) => r.statusCode === 200).length, 1)
      assert.equal(replies.filter((r) => r.statusCode === 409).length, 7)
      const state = await snapshot(f, id)
      assert.equal(state.career.funds, 19500000)
      assert.equal(state.ledger.length, 1)
      assert.equal(state.counts[1], 1)
      assert.equal(state.logs.length, 1)
      const runId = state.career.state.raceRun.raceRunId
      // The DB unique key is a second barrier: even a repeated settlement rolls the update back.
      await assert.rejects(
        f.db.transaction((tx) =>
          settleRaceMoney(tx, state.career.stableId, runId, 'entry_fee', 500000),
        ),
        /unique|duplicate/i,
      )
      assert.deepEqual(await snapshot(f, id), state)
      await assert.rejects(
        f.db.query('UPDATE stable_ledger SET amount=0 WHERE race_run_id=$1', [runId]),
        /Immutable history/,
      )
      await assert.rejects(
        f.db.query('DELETE FROM stable_ledger WHERE race_run_id=$1', [runId]),
        /Immutable history/,
      )
    } finally {
      await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
        raceId,
        JSON.stringify(original),
      ])
      await f.close()
    }
  })

  test(`${label}: v1-v4 saved prizes, parallel completion and trust apply once`, async () => {
    for (const engineVersion of [
      'race-sim-v1',
      'race-sim-v2',
      'race-sim-v3',
      'race-sim-v4',
    ] as const) {
      const f = await setup()
      const original = (
        await f.db.query('SELECT payload FROM race_definitions WHERE id=$1', [raceId])
      ).rows[0].payload
      try {
        const { id } = await ready(f)
        const command = { ...entry(), engineVersion }
        const entered = await f.call('POST', `/v1/careers/${id}/race-entries`, command)
        assert.equal(entered.statusCode, 200, entered.body)
        const run = entered.json().career.state.raceRun
        const logPath = `/v1/careers/${id}/race-runs/${command.raceRunId}/log`
        const log = (await f.call('GET', logPath)).json().log
        assert.equal(raceLogDigest(log), raceLogDigest(simulateRace(run, engineVersion)))
        assert.ok(log.result.prizeMoney > 0)
        // Mutating today's DB definition cannot change the locked fee or stored result.
        await f.db.query(
          'UPDATE race_definitions SET payload=payload || \'{"prize":1,"entryFee":1}\'::jsonb WHERE id=$1',
          [raceId],
        )
        const path = `/v1/careers/${id}/race-runs/${command.raceRunId}/complete`
        const body = { commandId: randomUUID() }
        const same = await Promise.all(Array.from({ length: 8 }, () => f.call('POST', path, body)))
        const different = await Promise.all(
          Array.from({ length: 8 }, () => f.call('POST', path, { commandId: randomUUID() })),
        )
        for (const r of [...same, ...different]) {
          assert.equal(r.statusCode, 200, r.body)
          assert.deepEqual(r.json(), same[0].json())
          assert.equal(r.json().career.funds, 19500000 + log.result.prizeMoney)
          assert.equal(r.json().career.state.careerTurnIndex, 4)
          assert.equal(r.json().career.state.raceRecords.length, 1)
          assert.equal(r.json().career.state.raceRecords[0].prizeMoney, log.result.prizeMoney)
          assert.equal(r.json().career.state.jockeyTrust.SEO_JIAN.starts, 1)
          assert.equal(
            r.json().career.state.jockeyTrust.SEO_JIAN.trust,
            raceTrustChange(run, log.result.placing).after,
          )
        }
        assert.deepEqual((await f.call('GET', logPath)).json().log, log)
        const state = await snapshot(f, id)
        assert.equal(state.ledger.length, 2)
        assert.equal(state.counts[2], 1)
        assert.equal(
          state.career.funds,
          20000000 + state.ledger.reduce((sum, row) => sum + Number(row.amount), 0),
        )
      } finally {
        await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
          raceId,
          JSON.stringify(original),
        ])
        await f.close()
      }
    }
  })

  test(`${label}: late SQL failures undo entry debits and completion prizes, logs, records and trust`, async () => {
    const f = await setup()
    const original = (
      await f.db.query('SELECT payload FROM race_definitions WHERE id=$1', [raceId])
    ).rows[0].payload
    try {
      const { id } = await ready(f)
      const command = entry()
      const entryPath = `/v1/careers/${id}/race-entries`
      const before = await snapshot(f, id)
      for (const [table, column, target] of [
        ['stable_ledger', 'race_run_id', command.raceRunId],
        ['race_simulation_logs', 'race_run_id', command.raceRunId],
        ['careers', 'id', id],
        ['commands', 'request_id', command.raceRunId],
      ]) {
        const remove = await fault(f, table, column, target)
        try {
          assert.equal((await f.call('POST', entryPath, command)).statusCode, 500)
        } finally {
          await remove()
        }
        assert.deepEqual(await snapshot(f, id), before)
      }
      const entered = await f.call('POST', entryPath, command)
      assert.equal(entered.statusCode, 200, entered.body)
      const locked = await snapshot(f, id)
      const body = { commandId: randomUUID() }
      const path = `/v1/careers/${id}/race-runs/${command.raceRunId}/complete`
      for (const [table, column, target] of [
        ['race_results', 'race_run_id', command.raceRunId],
        ['stable_ledger', 'race_run_id', command.raceRunId],
        ['jockey_chemistry', 'horse_id', locked.career.ownedHorseId],
        ['careers', 'id', id],
        ['commands', 'request_id', body.commandId],
      ]) {
        const remove = await fault(f, table, column, target)
        try {
          assert.equal((await f.call('POST', path, body)).statusCode, 500)
        } finally {
          await remove()
        }
        assert.deepEqual(await snapshot(f, id), locked)
      }
      const completed = await f.call('POST', path, body)
      assert.equal(completed.statusCode, 200, completed.body)
      assert.equal((await snapshot(f, id)).ledger.length, 2)
    } finally {
      await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
        raceId,
        JSON.stringify(original),
      ])
      await f.close()
    }
  })

  test(`${label}: stable and cumulative horse prize overflow cannot partially settle`, async () => {
    const f = await setup()
    const original = (
      await f.db.query('SELECT payload FROM race_definitions WHERE id=$1', [raceId])
    ).rows[0].payload
    try {
      const { id, response } = await ready(f)
      const command = entry()
      const entered = await f.call('POST', `/v1/careers/${id}/race-entries`, command)
      assert.equal(entered.statusCode, 200, entered.body)
      await f.db.query('UPDATE stables SET funds=$2 WHERE id=$1', [
        response.career.stableId,
        Number.MAX_SAFE_INTEGER,
      ])
      const path = `/v1/careers/${id}/race-runs/${command.raceRunId}/complete`
      const body = { commandId: randomUUID() }
      const before = await snapshot(f, id)
      const denied = await f.call('POST', path, body)
      assert.equal(denied.statusCode, 422, denied.body)
      assert.equal(denied.json().error.code, 'ECONOMY_LIMIT')
      assert.deepEqual(await snapshot(f, id), before)
      await f.db.query('UPDATE stables SET funds=19500000 WHERE id=$1', [response.career.stableId])
      const state = entered.json().career.state
      await f.db.query('UPDATE careers SET state=$2 WHERE id=$1', [
        id,
        JSON.stringify({
          ...state,
          raceRecords: [
            { race: 'legacy', result: '1착', date: '2028-01', prizeMoney: Number.MAX_SAFE_INTEGER },
          ],
        }),
      ])
      const horseLimit = await snapshot(f, id)
      assert.equal((await f.call('POST', path, body)).statusCode, 422)
      assert.deepEqual(await snapshot(f, id), horseLimit)
      await f.db.query('UPDATE careers SET state=$2 WHERE id=$1', [id, JSON.stringify(state)])
      assert.equal((await f.call('POST', path, body)).statusCode, 200)
      await assert.rejects(
        f.db.query('UPDATE stables SET funds=-1 WHERE id=$1', [response.career.stableId]),
      )
      await assert.rejects(
        f.db.query('UPDATE stables SET funds=9007199254740992 WHERE id=$1', [
          response.career.stableId,
        ]),
      )
    } finally {
      await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
        raceId,
        JSON.stringify(original),
      ])
      await f.close()
    }
  })
}
