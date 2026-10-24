import {
  serverEventAvailable,
  serverEventChoiceAvailability,
  injuryBlockedPendingEvent,
} from '../../../packages/shared/src/event-availability'
import {
  riskOutcomes,
  type EventDefinition,
  type EventEffect,
  type EventChoice,
} from '../../../packages/shared/src/events'
import { canTrain, eventActionAvailable } from '../../../packages/shared/src/domain'
import { CareerEventRepository } from '../src/repositories/career-events'
import { readCareerRow } from '../src/repositories/career-rows'
import { legacyCareer as startCareer } from '../../../tests/helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DEFAULT_DIRECTOR_CONFIG } from '../../../packages/shared/src/events'
import { commitAction, resolveAction } from '../../../packages/shared/src/domain'
import { drawEvent, planDraw } from '../src/modules/events/director'
import { applyImmediateEffects } from '../src/modules/events/resolver'
import { convertNotionRows, importEvents } from '../src/modules/events/import'
import { digest } from '../src/services/identity'
import { fixture, catalogSource } from './helpers'
import {
  resolveServerAction,
  API_RACE_ENGINE_VERSION,
} from '../../../packages/shared/src/server-domain'

test('server authority keeps browser fixture events separate and uses the shared v4 race engine', () => {
  const base = startCareer('DEV_HORSE_SERENE_STEP')
  const local = {
    ...base,
    event: { eventId: 'COM-0001', month: 1, seed: 1, status: 'offered' as const },
    eventLog: [],
    eventMisses: 3,
  }
  const server = resolveServerAction(local, 'speed')
  const expected = resolveAction(commitAction(base, 'speed'))
  assert.deepEqual(server.values, expected.values)
  assert.equal(server.event, undefined)
  assert.equal(server.action?.event, undefined)
  assert.equal(API_RACE_ENGINE_VERSION, 'race-sim-v4')
})

test('director is deterministic under pool reorder, versioned seed and weighted filtering; unknown source grammar is disabled', async () => {
  const source = await catalogSource()
  const catalog = convertNotionRows(source.rows)
  const career = startCareer('DEV_HORSE_SERENE_STEP')
  const context = { career }
  const chosen = drawEvent(
    catalog.events,
    'month_start',
    context,
    'fixed-month-seed',
    'event-director-v1',
  )
  assert.ok(chosen)
  assert.deepEqual(
    drawEvent(
      [...catalog.events].reverse(),
      'month_start',
      context,
      'fixed-month-seed',
      'event-director-v1',
    ),
    chosen,
  )
  assert.equal(
    drawEvent(catalog.events, 'before_race', context, 'fixed-month-seed', 'event-director-v1'),
    undefined,
  )
  assert.equal(
    planDraw('x', 3, catalog.events, { ...DEFAULT_DIRECTOR_CONFIG, monthlyProbability: 0 })
      .gatePassed,
    true,
  )
  assert.equal(
    planDraw('x', 2, catalog.events, { ...DEFAULT_DIRECTOR_CONFIG, monthlyProbability: 0 })
      .gatePassed,
    false,
  )
  const sourceRow = source.rows.find((x) => x['이벤트 ID'] === 'COM-0001')
  assert.ok(sourceRow)
  const unknown = structuredClone(sourceRow)
  unknown['선택·효과'] += ' 알 수 없는 추가 능력 +999'
  const staged = convertNotionRows([unknown]).events[0]
  assert.equal(staged.enabled, false)
  assert.equal(staged.status, 'needs_mapping')
  unknown['선택·효과'] = source.rows[0]['선택·효과']
  unknown['등장조건'] = '모든 육성마, G1 3승 이상'
  assert.equal(convertNotionRows([unknown]).events[0].enabled, false)
  const nearCap = { ...career, values: { ...career.values, speed: 999, fatigue: 1 } }
  assert.deepEqual(
    applyImmediateEffects(nearCap, [
      { type: 'value_delta', key: 'speed', amount: 10 },
      { type: 'value_delta', key: 'fatigue', amount: -5 },
    ]).career.values,
    { ...nearCap.values, speed: 1000, fatigue: 0 },
  )
})
test('saved monthly event/choice/pool cannot reroll or reapply; conditional modifier is applied once', async () => {
  const f = await fixture({ probability: 1 })
  try {
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0034'")
    const { id, response } = await f.create()
    const event = response.career.event
    assert.equal(event.eventId, 'COM-0034')
    assert.equal(event.state, 'pending')
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/actions`, {
          actionId: randomUUID(),
          choice: 'speed',
          expectedTurn: 1,
        })
      ).statusCode,
      409,
    )
    assert.deepEqual((await f.call('GET', `/v1/careers/${id}`)).json(), response)
    const selection = { commandId: randomUUID(), choiceId: 'B', expectedTurn: 1 }
    const selected = await f.call('POST', `/v1/careers/${id}/events/${event.id}/choice`, selection)
    assert.equal(selected.statusCode, 200, selected.body)
    assert.equal(selected.json().career.event.state, 'selected')
    assert.deepEqual(
      (await f.call('POST', `/v1/careers/${id}/events/${event.id}/choice`, selection)).json(),
      selected.json(),
    )
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/events/${event.id}/choice`, {
          ...selection,
          commandId: randomUUID(),
          choiceId: 'A',
        })
      ).statusCode,
      409,
    )
    const action = { actionId: randomUUID(), choice: 'speed', expectedTurn: 1 }
    const done = await f.call('POST', `/v1/careers/${id}/actions`, action)
    assert.equal(done.statusCode, 200, done.body)
    const base = resolveAction(commitAction(response.career.state, 'speed'))
    assert.equal(done.json().career.state.values.fatigue, base.values.fatigue - 3)
    assert.equal(done.json().career.event.state, 'applied')
    assert.deepEqual(
      (await f.call('POST', `/v1/careers/${id}/actions`, action)).json(),
      done.json(),
    )
    assert.equal((await f.call('GET', `/v1/careers/${id}/events`)).json().data.length, 1)
    await assert.rejects(
      f.db.query("UPDATE career_event_history SET choice_id='A' WHERE id=$1", [event.id]),
      /Immutable event selection/,
    )
    await assert.rejects(
      f.db.query("UPDATE event_draws SET seed='reroll' WHERE career_id=$1", [id]),
      /Immutable monthly draw/,
    )
  } finally {
    await f.close()
  }
})
test('catalog revision updates do not replace an already offered event or its effects', async () => {
  const f = await fixture({ probability: 1 })
  try {
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0034'")
    const { id, response } = await f.create()
    const history = response.career.event
    const event = convertNotionRows((await catalogSource()).rows).events.find(
      (e) => e.id === 'COM-0034',
    )!
    const { revision, ...next } = event
    next.choices[0].effects = [{ type: 'value_delta', key: 'fatigue', amount: -1 }]
    await importEvents(f.db, { schemaVersion: 1, events: [{ ...next, revision: digest(next) }] })
    assert.notEqual((await f.call('GET', '/v1/events/COM-0034')).json().revision, history.revision)
    const applied = await f.call('POST', `/v1/careers/${id}/events/${history.id}/choice`, {
      commandId: randomUUID(),
      choiceId: 'A',
      expectedTurn: 1,
    })
    assert.equal(applied.statusCode, 200, applied.body)
    assert.equal(applied.json().career.state.values.fatigue, 2)
    assert.equal(applied.json().career.event.revision, history.revision)
    const again = await f.call('POST', `/v1/careers/${id}/events/${history.id}/choice`, {
      commandId: randomUUID(),
      choiceId: 'A',
      expectedTurn: 1,
    })
    assert.equal(again.json().career.state.values.fatigue, 2)
  } finally {
    await f.close()
  }
})
test('result events automatically use locked growth; focused training bonus expires on another action', async () => {
  for (const eventId of ['COM-0016', 'COM-0001']) {
    const f = await fixture({ probability: 1, share: 0 })
    try {
      await f.db.query('UPDATE event_definitions SET enabled=false WHERE id<>$1', [eventId])
      const { id, response } = await f.create()
      const choice = eventId === 'COM-0016' ? 'speed' : 'rest'
      const action = await f.call('POST', `/v1/careers/${id}/actions`, {
        actionId: randomUUID(),
        choice,
        expectedTurn: 1,
      })
      assert.equal(action.statusCode, 200, action.body)
      const base = resolveAction(commitAction(response.career.state, choice))
      if (eventId === 'COM-0016') {
        assert.equal(response.career.event, null)
        const growth = base.values.speed - response.career.state.values.speed
        assert.equal(
          action.json().career.state.values.speed,
          base.values.speed + Math.round(growth * 0.45),
        )
        assert.equal(action.json().career.event.state, 'applied')
      } else {
        assert.equal(response.career.event.state, 'selected')
        assert.deepEqual(action.json().career.state.values, base.values)
        assert.equal(action.json().career.event.state, 'expired')
      }
      assert.equal((await f.call('GET', `/v1/careers/${id}/events`)).json().data.length, 1)
    } finally {
      await f.close()
    }
  }
})
test('three completed months without an event guarantee the next eligible month start event', async () => {
  const f = await fixture({ probability: 0 })
  try {
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0034'")
    const { id } = await f.create()
    for (let turn = 1; turn <= 3; turn++) {
      assert.equal((await f.call('GET', `/v1/careers/${id}`)).json().career.event, null)
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
      const next = await f.call('POST', `/v1/careers/${id}/months/advance`, {
        commandId: randomUUID(),
        actionId,
        expectedTurn: turn,
      })
      assert.equal(next.statusCode, 200, next.body)
    }
    const fourth = await f.call('GET', `/v1/careers/${id}`)
    assert.equal(fourth.json().career.state.careerTurnIndex, 4)
    assert.equal(fourth.json().career.event.eventId, 'COM-0034')
    assert.equal(
      Number(
        (
          await f.db.query('SELECT count(*) AS n FROM career_event_history WHERE career_id=$1', [
            id,
          ])
        ).rows[0].n,
      ),
      1,
    )
  } finally {
    await f.close()
  }
})

test('shared Server eligibility matches Local actions for injury aliases, effect scopes and every risk outcome', async () => {
  const catalog = convertNotionRows((await catalogSource()).rows).events
  const sample = catalog.find((event) => event.id === 'COM-0034')!
  const training: EventEffect = {
    type: 'action_modifier',
    action: 'training',
    field: 'fatigue',
    operation: 'add',
    value: -3,
  }
  const immediate: EventEffect = { type: 'value_delta', key: 'fatigue', amount: -3 }
  for (const health of [
    '정상',
    'HEALTHY',
    '경상',
    '중등도 부상',
    '중상',
    'MINOR',
    'MODERATE',
    'SEVERE',
  ]) {
    const career = { ...startCareer('DEV_HORSE_SERENE_STEP'), health }
    const healthy = canTrain(health)
    for (const action of ['speed', 'stamina', 'rest', 'treatment'] as const) {
      const allowed = action === 'rest' || (action === 'treatment' ? !healthy : healthy)
      assert.equal(
        eventActionAvailable(
          career,
          action === 'speed' || action === 'stamina' ? 'training' : action,
        ),
        allowed,
      )
      if (allowed) {
        assert.doesNotThrow(() => commitAction(career, action))
      } else {
        assert.throws(() => commitAction(career, action))
      }
    }
    const trainingBranches: EventEffect[][] = [[training], [{ ...training, training: 'speed' }]]
    for (const effects of trainingBranches) {
      const event: EventDefinition = {
        ...sample,
        choices: [{ ...sample.choices[0], effects, conditions: [] }],
      }
      assert.equal(serverEventAvailable(event, { career }), healthy)
      assert.equal(injuryBlockedPendingEvent(event, career), !healthy)
      assert.equal(
        !!drawEvent([event], 'month_start', { career }, 'fixed', 'event-director-v1'),
        healthy,
      )
    }
    const mixed: EventDefinition = {
      ...sample,
      choices: [{ ...sample.choices[0], effects: [immediate, training] }],
    }
    assert.equal(serverEventAvailable(mixed, { career }), true)
    assert.equal(serverEventAvailable(sample, { career }), true)
    assert.equal(
      serverEventChoiceAvailability(sample, sample.choices[1], { career }).available,
      healthy,
    )
    for (const action of ['rest', 'treatment'] as const) {
      const event: EventDefinition = {
        ...sample,
        choices: [{ ...sample.choices[0], effects: [{ ...training, action }] }],
      }
      assert.equal(serverEventAvailable(event, { career }), action === 'rest' || !healthy)
    }
    for (const outcome of riskOutcomes) {
      const choice: EventChoice = {
        ...sample.choices[0],
        effects: [],
        risk: {
          version: 'event-risk-v1' as const,
          outcomes: { great_success: [immediate], success: [immediate], failure: [], disaster: [] },
        },
      }
      choice.risk!.outcomes[outcome] = [training]
      const event: EventDefinition = { ...sample, choices: [choice] }
      assert.equal(serverEventAvailable(event, { career }), healthy, `${health}:${outcome}`)
    }
    const bonus: EventEffect = { type: 'resolved_growth_bonus', stat: 'speed', ratio: 0.5 }
    const resultEvent = {
      ...sample,
      timing: 'training_result' as const,
      choices: [{ ...sample.choices[0], effects: [bonus] }],
    }
    assert.equal(serverEventAvailable(resultEvent, { career }), false)
    const resolved = resolveServerAction({ ...career, health: '정상' }, 'speed')
    assert.equal(serverEventAvailable(resultEvent, { career: resolved, choice: 'speed' }), true)
    assert.equal(
      serverEventAvailable(resultEvent, {
        career: resolveServerAction(career, 'rest'),
        choice: 'rest',
      }),
      false,
    )
  }
})

test('persisted monthly pools exclude injury-only training rewards before planning and keep eligible mixed choices', async () => {
  const f = await fixture({ probability: 1 })
  try {
    await f.db.query('UPDATE event_definitions SET enabled=false')
    const { id } = await f.create()
    const catalog = convertNotionRows((await catalogSource()).rows).events
    const sample = catalog.find((event) => event.id === 'COM-0034')!
    const onlyTraining = { ...sample, id: 'COM-0031', choices: [sample.choices[1]] }
    const { revision: _revision, ...body } = onlyTraining
    await importEvents(f.db, {
      schemaVersion: 1,
      events: [{ ...body, revision: digest(body) }, sample],
    })
    const repository = new CareerEventRepository({
      ...DEFAULT_DIRECTOR_CONFIG,
      monthlyProbability: 1,
    })
    let turn = 1
    for (const health of [
      '정상',
      'HEALTHY',
      '경상',
      '중등도 부상',
      '중상',
      'MINOR',
      'MODERATE',
      'SEVERE',
    ]) {
      turn++
      await f.db.transaction(async (tx) => {
        const row = await readCareerRow(tx, f.user.principalId, id, true)
        row.turn = turn
        row.state = { ...row.state, health, month: turn, careerTurnIndex: turn }
        await repository.createMonth(tx, row)
      })
      const draw = (
        await f.db.query('SELECT * FROM event_draws WHERE career_id=$1 AND turn=$2', [id, turn])
      ).rows[0]
      assert.deepEqual(
        draw.pool.map((event: EventDefinition) => event.id),
        canTrain(health) ? ['COM-0031', 'COM-0034'] : ['COM-0034'],
      )
      assert.equal(draw.deferred_to_result, false)
      const histories = (
        await f.db.query('SELECT * FROM career_event_history WHERE career_id=$1 AND turn=$2', [
          id,
          turn,
        ])
      ).rows
      assert.equal(histories.length, 1)
      assert.ok(draw.pool.some((event: EventDefinition) => event.id === histories[0].event_id))
    }
  } finally {
    await f.close()
  }
})

test('injured choice rejection preserves pending snapshot; usable recovery choice applies only once', async () => {
  const f = await fixture({ probability: 1 })
  try {
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0034'")
    const { id, response } = await f.create()
    const state = { ...response.career.state, health: 'MINOR', healthRecovery: 1 }
    await f.db.query('UPDATE careers SET state=$2 WHERE id=$1', [id, JSON.stringify(state)])
    const before = (await f.call('GET', `/v1/careers/${id}`)).json()
    const draws = (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [id])).rows
    const path = `/v1/careers/${id}/events/${before.career.event.id}/choice`
    const invalid = { commandId: randomUUID(), choiceId: 'B', expectedTurn: 1 }
    for (let retry = 0; retry < 2; retry++) {
      const rejected = await f.call('POST', path, invalid)
      assert.equal(rejected.statusCode, 422, rejected.body)
      assert.equal(rejected.json().error.code, 'INVALID_CHOICE')
      assert.deepEqual((await f.call('GET', `/v1/careers/${id}`)).json(), before)
    }
    const selection = { commandId: randomUUID(), choiceId: 'A', expectedTurn: 1 }
    const selected = await f.call('POST', path, selection)
    assert.equal(selected.statusCode, 200, selected.body)
    assert.equal(selected.json().career.event.state, 'applied')
    assert.deepEqual((await f.call('POST', path, selection)).json(), selected.json())
    assert.deepEqual(
      (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [id])).rows,
      draws,
    )
  } finally {
    await f.close()
  }
})

test('old injury-blocked pending snapshot expires atomically with recovery without reroll, duplicate effects or turn loss', async () => {
  for (const action of ['rest', 'treatment'] as const) {
    const f = await fixture({ probability: 1 })
    try {
      await f.db.query('UPDATE event_definitions SET enabled=false')
      const event = convertNotionRows((await catalogSource()).rows).events.find(
        (event) => event.id === 'COM-0034',
      )!
      const { revision: _revision, ...body } = { ...event, choices: [event.choices[1]] }
      await importEvents(f.db, { schemaVersion: 1, events: [{ ...body, revision: digest(body) }] })
      const { id, response } = await f.create()
      const before = { ...response.career.state, health: 'MODERATE', healthRecovery: 1 }
      await f.db.query('UPDATE careers SET state=$2 WHERE id=$1', [id, JSON.stringify(before)])
      const original = (
        await f.db.query('SELECT * FROM career_event_history WHERE career_id=$1', [id])
      ).rows[0]
      const draws = (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [id])).rows
      const saved = (await f.call('GET', `/v1/careers/${id}`)).json()
      assert.equal(saved.career.event.state, 'pending')
      await assert.rejects(
        f.db.transaction(async (tx) => {
          const row = await readCareerRow(tx, f.user.principalId, id, true)
          await new CareerEventRepository(DEFAULT_DIRECTOR_CONFIG).prepareAction(tx, row, action)
          throw new Error('lost transaction')
        }),
        /lost transaction/,
      )
      assert.deepEqual(
        (await f.db.query('SELECT * FROM career_event_history WHERE career_id=$1', [id])).rows[0],
        original,
      )
      const payload = { actionId: randomUUID(), choice: action, expectedTurn: 1 }
      const done = await f.call('POST', `/v1/careers/${id}/actions`, payload)
      assert.equal(done.statusCode, 200, done.body)
      assert.equal(done.json().career.event.state, 'expired')
      assert.equal(done.json().career.event.choiceId, null)
      assert.deepEqual(done.json().career.state.values, resolveServerAction(before, action).values)
      assert.deepEqual(
        (await f.call('POST', `/v1/careers/${id}/actions`, payload)).json(),
        done.json(),
        'lost response retry returns the same receipt',
      )
      assert.equal(
        (await f.call('POST', `/v1/careers/${id}/actions`, { ...payload, actionId: randomUUID() }))
          .statusCode,
        409,
      )
      const expired = (
        await f.db.query('SELECT * FROM career_event_history WHERE career_id=$1', [id])
      ).rows[0]
      for (const key of [
        'id',
        'definition_snapshot',
        'event_revision',
        'modifiers',
        'result',
        'choice_id',
      ]) {
        assert.deepEqual(expired[key], original[key])
      }
      assert.deepEqual(
        (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [id])).rows,
        draws,
      )
      const advance = { commandId: randomUUID(), actionId: payload.actionId, expectedTurn: 1 }
      const next = await f.call('POST', `/v1/careers/${id}/months/advance`, advance)
      assert.equal(next.statusCode, 200, next.body)
      assert.deepEqual(
        (await f.call('POST', `/v1/careers/${id}/months/advance`, advance)).json(),
        next.json(),
      )
      assert.equal(next.json().career.state.careerTurnIndex, 2)
      assert.equal(
        (await f.call('GET', `/v1/careers/${id}/events`))
          .json()
          .data.filter((history: { turn: number }) => history.turn === 1).length,
        1,
      )
    } finally {
      await f.close()
    }
  }
})
