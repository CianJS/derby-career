import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { buildExpansion, importExpansion, activateExpansion } from '../src/modules/events/expansion'
import { importEvents } from '../src/modules/events/import'
import { resolveEventChoice } from '../src/modules/events/risk'
import { conditionsMatch, drawEvent } from '../src/modules/events/director'
import { eventSchema } from '../src/modules/events/schema'
import { digest } from '../src/services/identity'
import { EventRepository } from '../src/repositories/events'
import { fixture } from './helpers'
import { resolveServerAction } from '../../../packages/shared/src/server-domain'
import { applyImmediateEffects } from '../src/modules/events/resolver'
import { startCareer } from '../../../packages/shared/src/domain'
import {
  eventCategories,
  riskOutcomes,
  CATEGORY_WEIGHTS,
  RISK_WEIGHTS,
  type EventDefinition,
  type EventChoice,
} from '../../../packages/shared/src/events'
const source = async () => JSON.parse(await readFile('seeds/events.expansion.source.json', 'utf8'))
const career = () => startCareer('DEV_HORSE_SERENE_STEP')
const revision = (event: EventDefinition) => {
  const { revision: _revision, ...definition } = event
  return { ...event, revision: digest(definition) }
}
const reviewed = (category: EventDefinition['category']): EventDefinition =>
  revision({
    id: `test-${category}`,
    name: 'Test',
    category,
    subtype: 'Test',
    introduction: 'hold',
    timing: 'month_start',
    status: 'ready',
    enabled: true,
    weight: 1,
    revision: '0'.repeat(64),
    balanceVersion: 'test',
    description: null,
    conditions: [{ type: 'healthy' }, { type: 'value_range', key: 'fatigue', max: 999 }],
    choices: [{ id: 'safe', label: 'safe', conditions: [], effects: [] }],
    automatic: false,
    source: { url: null, conditionText: 'test', effectText: 'test' },
    mappingNotes: [],
    review: {
      sourceDigest: '0'.repeat(64),
      converted: true,
      executable: true,
      contentReviewed: true,
      balanceReviewed: true,
      groupId: null,
      representativeId: null,
    },
  })
test('latest snapshot preserves all 1000 IDs and generates 650 inactive definitions reproducibly', async () => {
  const raw = await source()
  const result = buildExpansion(raw)
  assert.deepEqual(
    result,
    JSON.parse(await readFile('seeds/events.expansion.catalog.json', 'utf8')),
  )
  const old = JSON.parse(await readFile('seeds/events.catalog.json', 'utf8'))
  assert.deepEqual(
    [...old.events, ...result.events].map((e) => e.id).sort(),
    raw.rows.map((r: Record<string, string>) => r['이벤트 ID']).sort(),
  )
  assert.equal(result.events.length, 650)
  assert.equal(result.events.filter((e) => e.review?.converted).length, 280)
  assert.equal(
    result.events.filter((e) => e.enabled || e.review?.contentReviewed || e.review?.balanceReviewed)
      .length,
    0,
  )
  assert.deepEqual(buildExpansion({ rows: [...raw.rows].reverse() }), result)
  const bad = structuredClone(raw)
  bad.rows[0]['이벤트 ID'] = bad.rows[1]['이벤트 ID']
  assert.throws(() => buildExpansion(bad), /duplicate/)
  const missing = structuredClone(raw)
  missing.rows[0]['선택·효과'] = ''
  assert.throws(() => buildExpansion(missing), /Missing/)
})
test('v2 category distribution is 45:35:12:6:2 irrespective of pool size; ineligible categories renormalize', () => {
  const pool = eventCategories.map(reviewed),
    c = career()
  for (let i = 0; i < 30; i++) {
    pool.push({ ...reviewed('normal'), id: `normal-${i}`, weight: 20 })
  }
  const counts = Object.fromEntries(eventCategories.map((c) => [c, 0]))
  for (let i = 0; i < 20000; i++) {
    const event = drawEvent(pool, 'month_start', { career: c }, `seed-${i}`, 'event-director-v2')!
    counts[event.category]++
    assert.deepEqual(
      event,
      drawEvent(
        [...pool].reverse(),
        'month_start',
        { career: c },
        `seed-${i}`,
        'event-director-v2',
      ),
    )
  }
  for (const category of eventCategories) {
    assert.ok(
      Math.abs(counts[category] / 200 - CATEGORY_WEIGHTS[category]) < 1,
      JSON.stringify(counts),
    )
  }
  const filtered = [
    reviewed('normal'),
    {
      ...reviewed('hidden'),
      conditions: [
        { type: 'value_range' as const, key: 'speed' as const, min: 999 },
        { type: 'healthy' as const },
      ],
    },
  ]
  for (let i = 0; i < 100; i++) {
    assert.equal(
      drawEvent(filtered, 'month_start', { career: c }, `${i}`, 'event-director-v2')?.category,
      'normal',
    )
  }
  assert.equal(
    drawEvent(
      [{ ...reviewed('hidden'), conditions: [{ type: 'always' }] }],
      'month_start',
      { career: c },
      'x',
      'event-director-v2',
    ),
    undefined,
  )
  assert.equal(
    drawEvent(
      [
        {
          ...reviewed('normal'),
          review: { ...reviewed('normal').review!, contentReviewed: false },
        },
      ],
      'month_start',
      { career: c },
      'x',
      'event-director-v2',
    ),
    undefined,
  )
})
test('structured conditions check aptitude, growth, health, record and aggregate', () => {
  const c = career()
  assert.equal(
    conditionsMatch(
      [
        { type: 'aptitude_any', names: ['마일'], grades: ['A', 'B'] },
        { type: 'growth_is', growth: '표준' },
        { type: 'record_range', metric: 'starts', max: 0 },
      ],
      { career: c },
    ),
    true,
  )
  assert.equal(conditionsMatch([{ type: 'health_is', health: ['중상'] }], { career: c }), false)
  assert.equal(
    conditionsMatch([{ type: 'record_range', metric: 'wins', min: 1 }], { career: c }),
    false,
  )
  assert.equal(
    conditionsMatch([{ type: 'stat_summary', metric: 'count', threshold: 999, min: 1 }], {
      career: c,
    }),
    false,
  )
})
test('safe choices never roll; explicit risk choices deterministically follow 15:55:25:5', () => {
  const effects = [{ type: 'value_delta' as const, key: 'fatigue' as const, amount: 1 }]
  const safe: EventChoice = { id: 'safe', label: 'Safe', conditions: [], effects }
  assert.deepEqual(resolveEventChoice(safe, 'a', 'rev'), { effects })
  const risk: EventChoice = {
    ...safe,
    id: 'risk',
    effects: [],
    risk: {
      version: 'event-risk-v1',
      outcomes: { great_success: effects, success: [], failure: effects, disaster: effects },
    },
  }
  const counts = Object.fromEntries(riskOutcomes.map((o) => [o, 0]))
  for (let i = 0; i < 20000; i++) {
    const result = resolveEventChoice(risk, `${i}`, 'rev')
    counts[result.risk!.outcome]++
    assert.deepEqual(result, resolveEventChoice(risk, `${i}`, 'rev'))
  }
  for (const outcome of riskOutcomes) {
    assert.ok(Math.abs(counts[outcome] / 200 - RISK_WEIGHTS[outcome]) < 1, JSON.stringify(counts))
  }
  assert.equal(
    eventSchema.safeParse(revision({ ...reviewed('normal'), automatic: true, choices: [risk] }))
      .success,
    false,
  )
})
test('SQL import is idempotent, preserves old snapshots and rejects unreviewed or stale activation', async () => {
  const f = await fixture({ probability: 1 })
  try {
    const c = await f.create(),
      raw = await source()
    const before = (
      await f.db.query('SELECT id,current_revision,enabled FROM event_definitions ORDER BY id')
    ).rows
    const snapshot = (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [c.id])).rows
    const history = (
      await f.db.query('SELECT * FROM career_event_history WHERE career_id=$1', [c.id])
    ).rows
    await importExpansion(f.db, raw)
    await importExpansion(f.db, raw)
    assert.equal(
      Number((await f.db.query('SELECT count(*) AS count FROM event_definitions')).rows[0].count),
      1000,
    )
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT id,current_revision,enabled FROM event_definitions WHERE category='common' ORDER BY id",
        )
      ).rows,
      before,
    )
    assert.deepEqual(
      (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [c.id])).rows,
      snapshot,
    )
    assert.deepEqual(
      (await f.db.query('SELECT * FROM career_event_history WHERE career_id=$1', [c.id])).rows,
      history,
    )
    assert.equal((await EventRepository.pool(f.db)).length, 315)
    const event = buildExpansion(raw).events.find((e) => e.review?.executable)!
    await assert.rejects(
      f.db.query('UPDATE event_definitions SET enabled=true WHERE id=$1', [event.id]),
      /Unreviewed/,
    )
    const detail = await f.call('GET', `/v1/events/${event.id}`)
    assert.equal(detail.statusCode, 200, detail.body)
    assert.equal(detail.json().review.contentReviewed, false)
    const approval = {
      events: [
        {
          id: event.id,
          revision: event.revision,
          contentReviewed: true,
          balanceReviewed: true,
          groupReviewed: true,
          representativeId: null,
        },
      ],
    }
    await activateExpansion(f.db, approval)
    assert.equal((await EventRepository.pool(f.db)).length, 316)
    await importExpansion(f.db, raw)
    assert.equal((await EventRepository.pool(f.db)).length, 316)
    await assert.rejects(activateExpansion(f.db, approval), /stale/i)
    const unsupported = buildExpansion(raw).events.find((e) => !e.review?.executable)!
    await assert.rejects(
      activateExpansion(f.db, {
        events: [{ ...approval.events[0], id: unsupported.id, revision: unsupported.revision }],
      }),
      /Unmapped/,
    )
  } finally {
    await f.close()
  }
})
test('risk outcome persists across repeated choices and core actions without duplicate effects', async () => {
  const f = await fixture({ probability: 1, directorVersion: 'event-director-v2' })
  try {
    await f.db.query('UPDATE event_definitions SET enabled=false')
    const event = reviewed('normal')
    event.id = 'GEN-risk-test'
    event.choices = [
      {
        id: 'risk',
        label: 'Risk',
        conditions: [],
        effects: [],
        risk: {
          version: 'event-risk-v1',
          outcomes: Object.fromEntries(
            riskOutcomes.map((o) => [o, [{ type: 'value_delta', key: 'speed', amount: 5 }]]),
          ) as NonNullable<EventChoice['risk']>['outcomes'],
        },
      },
    ]
    await importEvents(f.db, { schemaVersion: 1, events: [revision(event)] })
    const { id, response } = await f.create()
    const pending = response.career?.event ?? response.event
    const path = `/v1/careers/${id}/events/${pending.id}/choice`
    const payload = { commandId: randomUUID(), choiceId: 'risk', expectedTurn: 1 }
    const chosen = await f.call('POST', path, payload)
    assert.equal(chosen.statusCode, 200, chosen.body)
    const after = chosen.json().career ?? chosen.json()
    const retried = await f.call('POST', path, payload)
    assert.deepEqual(retried.json(), chosen.json())
    const second = await f.call('POST', path, { ...payload, commandId: randomUUID() })
    assert.equal(second.statusCode, 200, second.body)
    const reloaded = (await f.call('GET', `/v1/careers/${id}`)).json()
    assert.equal((reloaded.career ?? reloaded).state.values.speed, after.state.values.speed)
    assert.ok(after.event.result.risk.outcome)
    const actionId = randomUUID()
    const action = await f.call('POST', `/v1/careers/${id}/actions`, {
      actionId,
      choice: 'rest',
      expectedTurn: 1,
    })
    assert.equal(action.statusCode, 200, action.body)
    const duplicate = await f.call('POST', `/v1/careers/${id}/actions`, {
      actionId: randomUUID(),
      choice: 'rest',
      expectedTurn: 1,
    })
    assert.equal(duplicate.statusCode, 409)
    assert.equal(
      Number(
        (
          await f.db.query(
            'SELECT count(*) AS count FROM career_event_history WHERE career_id=$1 AND turn=1',
            [id],
          )
        ).rows[0].count,
      ),
      1,
    )
  } finally {
    await f.close()
  }
})

test('actual converted automatic result event uses shared action calculation once and never consumes a second core action', async () => {
  const f = await fixture({ probability: 1, share: 0, directorVersion: 'event-director-v2' })
  try {
    const raw = await source()
    await importExpansion(f.db, raw)
    const event = buildExpansion(raw).events.find(
      (e) =>
        e.review?.executable &&
        e.automatic &&
        e.timing === 'training_result' &&
        conditionsMatch(e.conditions, { career: career(), choice: 'speed' }) &&
        conditionsMatch(e.choices[0].conditions, { career: career(), choice: 'speed' }),
    )!
    assert.ok(event)
    await f.db.query('UPDATE event_definitions SET enabled=false')
    await activateExpansion(f.db, {
      events: [
        {
          id: event.id,
          revision: event.revision,
          contentReviewed: true,
          balanceReviewed: true,
          groupReviewed: true,
          representativeId: null,
        },
      ],
    })
    const { id, response } = await f.create()
    const initial = response.career ?? response
    assert.equal(initial.event, null)
    const draw = (await f.db.query('SELECT * FROM event_draws WHERE career_id=$1', [id])).rows[0]
    assert.equal(draw.system_version, 'event-director-v2')
    const expected = applyImmediateEffects(
      resolveServerAction(initial.state, 'speed'),
      event.choices[0].effects,
    ).career
    const actionId = randomUUID(),
      payload = { actionId, choice: 'speed', expectedTurn: 1 }
    const action = await f.call('POST', `/v1/careers/${id}/actions`, payload)
    assert.equal(action.statusCode, 200, action.body)
    assert.deepEqual(action.json().career.state.values, expected.values)
    assert.equal(action.json().career.event.eventId, event.id)
    assert.equal(action.json().career.event.state, 'applied')
    assert.deepEqual(
      (await f.call('POST', `/v1/careers/${id}/actions`, payload)).json(),
      action.json(),
    )
    assert.equal(
      (await f.call('POST', `/v1/careers/${id}/actions`, { ...payload, actionId: randomUUID() }))
        .statusCode,
      409,
    )
    assert.equal(
      Number(
        (
          await f.db.query(
            'SELECT count(*) AS count FROM career_event_history WHERE career_id=$1 AND turn=1',
            [id],
          )
        ).rows[0].count,
      ),
      1,
    )
    const advance = await f.call('POST', `/v1/careers/${id}/months/advance`, {
      commandId: randomUUID(),
      actionId,
      expectedTurn: 1,
    })
    assert.equal(advance.statusCode, 200, advance.body)
    assert.equal(advance.json().career.state.careerTurnIndex, 2)
  } finally {
    await f.close()
  }
})
