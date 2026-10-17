import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { components } from '../../../packages/shared/src/generated/api'
import { fixture } from './helpers'

type Models = components['schemas']

test('retirement preserves resolved growth and world time, replays once and releases the stable for a new career', async () => {
  const f = await fixture()
  try {
    const { id } = await f.create()
    const actionBody = { actionId: randomUUID(), choice: 'speed', expectedTurn: 1 }
    const action = await f.call('POST', `/v1/careers/${id}/actions`, actionBody)
    assert.equal(action.statusCode, 200, action.body)
    const before = action.json<Models['ActionResponse']>().career
    const body = { commandId: randomUUID(), expectedRevision: before.revision }
    const result = await f.call('POST', `/v1/careers/${id}/retirement`, body)
    assert.equal(result.statusCode, 200, result.body)
    assert.equal(result.headers['cache-control'], 'no-store')
    const retired = result.json<Models['RetireCareerResponse']>()
    assert.deepEqual(retired.career, {
      ...before,
      status: 'retired',
      revision: before.revision + 1,
    })
    assert.deepEqual(retired.retirement.snapshot, retired.career)
    assert.deepEqual(retired.retirement.retiredOn, before.state.calendarDate)
    assert.equal(retired.retirement.careerId, id)
    assert.equal(retired.retirement.reason, 'manual')
    assert.ok(Number.isFinite(Date.parse(retired.retirement.retiredAt)))
    assert.deepEqual((await f.call('POST', `/v1/careers/${id}/retirement`, body)).json(), retired)
    assert.equal(
      (await f.call('POST', `/v1/careers/${id}/retirement`, { ...body, expectedRevision: 999 }))
        .statusCode,
      409,
    )
    assert.equal(
      (await f.call('POST', `/v1/careers/${id}/retirement`, { ...body, commandId: randomUUID() }))
        .statusCode,
      409,
    )
    for (const [path, payload] of [
      ['actions', { actionId: randomUUID(), choice: 'rest', expectedTurn: 1 }],
      [
        'months/advance',
        { commandId: randomUUID(), actionId: actionBody.actionId, expectedTurn: 1 },
      ],
      [
        'race-entries',
        {
          raceRunId: randomUUID(),
          raceDefinitionId: 'DEV_M3_MILE_1600',
          jockeyId: 'SEO_JIAN',
          tactic: '선입',
          expectedTurn: 1,
        },
      ],
      [`race-runs/${randomUUID()}/complete`, { commandId: randomUUID() }],
    ] as const) {
      assert.equal(
        (await f.call('POST', `/v1/careers/${id}/${path}`, payload)).statusCode,
        409,
        path,
      )
    }
    // Old receipts remain replayable, but cannot reactivate or mutate an archived career.
    assert.deepEqual(
      (await f.call('POST', `/v1/careers/${id}/actions`, actionBody)).json(),
      action.json(),
    )
    assert.equal((await f.call('GET', `/v1/careers/${id}`)).json().career.status, 'retired')
    assert.equal((await f.call('GET', `/v1/careers/${id}/actions`)).json().data.length, 1)
    assert.equal((await f.call('GET', '/v1/careers')).json().data[0].status, 'retired')
    assert.equal(
      (await f.db.query('SELECT * FROM career_records WHERE career_id=$1', [id])).rows.length,
      1,
    )
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM commands WHERE career_id=$1 AND operation='career.retire'",
          [id],
        )
      ).rows.length,
      1,
    )
    await assert.rejects(
      f.db.query("UPDATE career_records SET retirement_reason='changed' WHERE career_id=$1", [id]),
      /Immutable history/,
    )
    await assert.rejects(
      f.db.query('DELETE FROM career_records WHERE career_id=$1', [id]),
      /Immutable history/,
    )

    const next = await f.create()
    assert.equal(next.response.career.stableId, before.stableId)
    assert.notEqual(next.response.career.ownedHorseId, before.ownedHorseId)
    assert.deepEqual(next.response.career.state.calendarDate, before.state.calendarDate)
    await f.db.query(
      'UPDATE stables SET funds=funds+100,calendar_year=calendar_year+1 WHERE id=$1',
      [before.stableId],
    )
    const archive = await f.call('GET', `/v1/careers/${id}/retirement`)
    assert.equal(archive.statusCode, 200, archive.body)
    assert.equal(archive.headers['cache-control'], 'no-store')
    assert.deepEqual(archive.json(), { retirement: retired.retirement })
    assert.deepEqual((await f.call('POST', `/v1/careers/${id}/retirement`, body)).json(), retired)
  } finally {
    await f.close()
  }
})

test('retirement rejects stale revisions, untrusted snapshots and unauthorized reads/writes without partial history', async () => {
  const f = await fixture()
  try {
    const { id, response } = await f.create()
    const url = `/v1/careers/${id}/retirement`
    const body = { commandId: randomUUID(), expectedRevision: response.career.revision }
    assert.equal((await f.call('GET', url)).statusCode, 404)
    for (const payload of [
      { commandId: body.commandId },
      { ...body, commandId: 'invalid' },
      { ...body, expectedRevision: 0 },
      { ...body, expectedRevision: 1.5 },
      { ...body, snapshot: response.career },
      { ...body, reason: 'manual' },
      { ...body, ownerId: f.user.principalId },
    ]) {
      assert.equal((await f.call('POST', url, payload)).statusCode, 400)
    }
    assert.equal((await f.app.inject({ url })).statusCode, 401)
    assert.equal((await f.app.inject({ method: 'POST', url, payload: body })).statusCode, 401)
    assert.equal((await f.call('GET', url, undefined, f.other.token)).statusCode, 404)
    assert.equal((await f.call('POST', url, body, f.other.token)).statusCode, 404)
    assert.equal(
      (await f.call('POST', `/v1/careers/${randomUUID()}/retirement`, body)).statusCode,
      404,
    )
    const action = await f.call('POST', `/v1/careers/${id}/actions`, {
      actionId: randomUUID(),
      choice: 'rest',
      expectedTurn: 1,
    })
    assert.equal(action.statusCode, 200, action.body)
    assert.equal((await f.call('POST', url, body)).statusCode, 409)
    assert.deepEqual((await f.call('GET', `/v1/careers/${id}`)).json(), {
      career: action.json().career,
    })
    assert.equal(
      (await f.db.query('SELECT * FROM career_records WHERE career_id=$1', [id])).rows.length,
      0,
    )
    assert.equal(
      (await f.db.query('SELECT * FROM commands WHERE request_id=$1', [body.commandId])).rows
        .length,
      0,
    )
    // A rejected command ID remains usable with the newly observed revision.
    const retry = await f.call('POST', url, {
      ...body,
      expectedRevision: action.json().career.revision,
    })
    assert.equal(retry.statusCode, 200, retry.body)
    assert.equal((await f.call('GET', url, undefined, f.other.token)).statusCode, 404)
    assert.equal((await f.call('POST', url, body, f.other.token)).statusCode, 404)
  } finally {
    await f.close()
  }
})

test('retirement preserves pending event history without selecting a choice or leaking source notes', async () => {
  const f = await fixture({ probability: 1 })
  try {
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0034'")
    const { id, response } = await f.create()
    const event = response.career.event
    assert.equal(event.state, 'pending')
    const history = (
      await f.db.query('SELECT * FROM career_event_history WHERE career_id=$1', [id])
    ).rows
    const draw = (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [id])).rows
    const result = await f.call('POST', `/v1/careers/${id}/retirement`, {
      commandId: randomUUID(),
      expectedRevision: response.career.revision,
    })
    assert.equal(result.statusCode, 200, result.body)
    const snapshot = result.json<Models['RetireCareerResponse']>().retirement.snapshot
    assert.deepEqual(snapshot.state, response.career.state)
    assert.deepEqual(snapshot.event, event)
    assert.equal(snapshot.event?.definition.source.url, null)
    assert.equal('body' in snapshot.event!.definition.source, false)
    assert.deepEqual(
      (await f.db.query('SELECT * FROM career_event_history WHERE career_id=$1', [id])).rows,
      history,
    )
    assert.deepEqual(
      (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [id])).rows,
      draw,
    )
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/events/${event.id}/choice`, {
          commandId: randomUUID(),
          choiceId: 'B',
          expectedTurn: 1,
        })
      ).statusCode,
      409,
    )
  } finally {
    await f.close()
  }
})

test('retirement waits for a locked race to complete and preserves its result and payout', async () => {
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
    const raceRunId = randomUUID()
    const entry = await f.call('POST', `/v1/careers/${id}/race-entries`, {
      raceRunId,
      raceDefinitionId: 'DEV_M3_MILE_1600',
      jockeyId: 'SEO_JIAN',
      tactic: '선입',
      expectedTurn: 3,
    })
    assert.equal(entry.statusCode, 200, entry.body)
    const commandId = randomUUID()
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/retirement`, {
          commandId,
          expectedRevision: entry.json().career.revision,
        })
      ).statusCode,
      409,
    )
    assert.deepEqual((await f.call('GET', `/v1/careers/${id}`)).json(), {
      career: entry.json().career,
    })
    assert.equal(
      (await f.db.query('SELECT * FROM career_records WHERE career_id=$1', [id])).rows.length,
      0,
    )
    const completed = await f.call('POST', `/v1/careers/${id}/race-runs/${raceRunId}/complete`, {
      commandId: randomUUID(),
    })
    assert.equal(completed.statusCode, 200, completed.body)
    const before = completed.json<Models['RaceCompleteResponse']>().career
    const retired = await f.call('POST', `/v1/careers/${id}/retirement`, {
      commandId,
      expectedRevision: before.revision,
    })
    assert.equal(retired.statusCode, 200, retired.body)
    assert.deepEqual(retired.json().retirement.snapshot.state, before.state)
    assert.equal(retired.json().retirement.snapshot.funds, before.funds)
    assert.equal((await f.call('GET', `/v1/careers/${id}/records`)).json().data.length, 1)
    assert.equal(
      (await f.call('GET', `/v1/careers/${id}/race-runs/${raceRunId}/log`)).statusCode,
      200,
    )
    assert.equal(
      (await f.db.query('SELECT * FROM stable_ledger WHERE race_run_id=$1', [raceRunId])).rows
        .length,
      2,
    )
  } finally {
    await f.close()
  }
})

test('a retirement receipt failure rolls back status, revision and snapshot; the same command can then succeed', async () => {
  const f = await fixture()
  try {
    const { id, response } = await f.create()
    await f.db.query(`
      CREATE FUNCTION fail_retirement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.operation='career.retire' THEN RAISE EXCEPTION 'forced retirement receipt failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_retirement_receipt BEFORE INSERT ON commands
        FOR EACH ROW EXECUTE FUNCTION fail_retirement_receipt();
    `)
    const body = { commandId: randomUUID(), expectedRevision: response.career.revision }
    assert.equal((await f.call('POST', `/v1/careers/${id}/retirement`, body)).statusCode, 500)
    assert.deepEqual((await f.call('GET', `/v1/careers/${id}`)).json(), response)
    assert.equal(
      (await f.db.query('SELECT * FROM career_records WHERE career_id=$1', [id])).rows.length,
      0,
    )
    assert.equal(
      (await f.db.query('SELECT * FROM commands WHERE request_id=$1', [body.commandId])).rows
        .length,
      0,
    )
    await f.db.query(
      'DROP TRIGGER test_retirement_receipt ON commands; DROP FUNCTION fail_retirement_receipt();',
    )
    assert.equal((await f.call('POST', `/v1/careers/${id}/retirement`, body)).statusCode, 200)
  } finally {
    await f.close()
  }
})
