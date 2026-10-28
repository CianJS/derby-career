import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { buildExpansion, importExpansion, activateExpansion } from '../src/modules/events/expansion'
import { importEvents } from '../src/modules/events/import'
import { eventSchema } from '../src/modules/events/schema'
import { inspectEventCatalog } from '../src/modules/events/preflight'
import { digest } from '../src/services/identity'
import { EventRepository } from '../src/repositories/events'
import { fixture } from './helpers'
import {
  riskOutcomes,
  type EventChoice,
  type EventDefinition,
} from '../../../packages/shared/src/events'

const source = async (): Promise<{ rows: Record<string, string>[] }> =>
  JSON.parse(await readFile('seeds/events.expansion.source.json', 'utf8'))
const revision = (event: EventDefinition) => {
  const { revision: _revision, ...definition } = event
  return { ...event, revision: digest(definition) }
}
const approved = (event: EventDefinition): EventDefinition =>
  revision({
    ...event,
    enabled: true,
    status: 'ready',
    review: {
      ...event.review!,
      converted: true,
      executable: true,
      contentReviewed: true,
      balanceReviewed: true,
    },
  })
const approval = (event: EventDefinition) => ({
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
const riskChoice = (): EventChoice => ({
  id: 'risk',
  label: 'Risk',
  conditions: [],
  effects: [],
  risk: {
    version: 'event-risk-v1',
    outcomes: { great_success: [], success: [], failure: [], disaster: [] },
  },
})

test('group-only source changes revise drafts, reject stale approvals and never silently reuse approved groups', async () => {
  const raw = await source()
  const original = buildExpansion(raw).events.find(
    (e) => e.category === 'normal' && e.review?.executable,
  )!
  const changed = structuredClone(raw)
  changed.rows.find((r) => r['이벤트 ID'] === original.id)!['사건그룹 ID'] =
    'REVIEWED-GROUP-CORRECTION'
  const updated = buildExpansion(changed).events.find((e) => e.id === original.id)!
  assert.notEqual(updated.review!.sourceDigest, original.review!.sourceDigest)
  assert.notEqual(updated.revision, original.revision)
  const f = await fixture()
  try {
    await importExpansion(f.db, raw)
    await importExpansion(f.db, changed)
    await assert.rejects(activateExpansion(f.db, approval(original)), /Unmapped|Stale/i)
    await activateExpansion(f.db, approval(updated))
    await importExpansion(f.db, changed)
    const before = (await f.db.query('SELECT * FROM event_definitions ORDER BY id')).rows
    await assert.rejects(importExpansion(f.db, raw), /Source changed after review/)
    assert.deepEqual((await f.db.query('SELECT * FROM event_definitions ORDER BY id')).rows, before)
    assert.equal(
      (await EventRepository.pool(f.db)).find((e) => e.id === original.id)!.review!.groupId,
      'REVIEWED-GROUP-CORRECTION',
    )
  } finally {
    await f.close()
  }
})

test('injured training-result rows stay registered with their exact source but cannot be activated', async () => {
  const raw = await source(),
    catalog = buildExpansion(raw)
  const f = await fixture()
  try {
    await importExpansion(f.db, raw)
    for (const id of ['GEN-0274', 'GEN-0284']) {
      const event = catalog.events.find((e) => e.id === id)!
      assert.equal(event.review!.converted, false)
      assert.equal(event.review!.executable, false)
      assert.equal(event.enabled, false)
      assert.ok(event.mappingNotes.some((note) => note.startsWith('UNREACHABLE_TRAINING_RESULT:')))
      assert.equal(
        event.source.conditionText,
        raw.rows.find((r) => r['이벤트 ID'] === id)!['등장조건'],
      )
      assert.equal(eventSchema.safeParse(approved(event)).success, false)
      await assert.rejects(activateExpansion(f.db, approval(event)), /Unmapped/)
    }
    const mixed = structuredClone(catalog.events.find((e) => e.id === 'GEN-0274')!)
    mixed.conditions = [{ type: 'health_is', health: ['정상', '경상'] }]
    assert.equal(eventSchema.safeParse(approved(mixed)).success, true)
    mixed.conditions = []
    mixed.choices.forEach((choice) => {
      choice.conditions = [{ type: 'health_is', health: ['경상'] }]
    })
    assert.equal(eventSchema.safeParse(approved(mixed)).success, false)
  } finally {
    await f.close()
  }
})

test('all four risk outcomes use direct-effect timing, secondary-growth and growth-context validation', async () => {
  const base = approved(buildExpansion(await source()).events.find((e) => e.review?.executable)!)
  for (const timing of [
    'training_result',
    'rest_result',
    'treatment_result',
    'before_race',
    'after_race',
  ] as const) {
    for (const outcome of riskOutcomes) {
      const choice = riskChoice()
      choice.risk!.outcomes[outcome] = [
        {
          type: 'action_modifier',
          action: 'training',
          field: 'primaryGain',
          operation: 'add',
          value: 2,
        },
      ]
      const event = revision({ ...base, timing, automatic: false, choices: [choice] })
      const parsed = eventSchema.safeParse(event)
      assert.equal(parsed.success, false, `${timing}/${outcome}`)
      assert.ok(
        inspectEventCatalog({ schemaVersion: 1, events: [event] }).issues.some(
          (i) => i.code === 'LATE_ACTION_MODIFIER' && i.path.includes(outcome),
        ),
      )
    }
  }
  const choice = riskChoice()
  choice.risk!.outcomes.failure = [{ type: 'resolved_growth_bonus', stat: 'speed', ratio: 0.1 }]
  assert.equal(
    eventSchema.safeParse(
      revision({ ...base, timing: 'month_start', automatic: false, choices: [choice] }),
    ).success,
    false,
  )
  choice.risk!.outcomes.failure = [
    {
      type: 'action_modifier',
      action: 'training',
      training: 'intelligence',
      field: 'secondaryGain',
      operation: 'add',
      value: 1,
    },
  ]
  assert.equal(
    eventSchema.safeParse(
      revision({ ...base, timing: 'month_start', automatic: false, choices: [choice] }),
    ).success,
    false,
  )
})

test('invalid risk result catalog is rejected before any SQL write while valid month-start risk modifiers can advance', async () => {
  const f = await fixture({ probability: 1 })
  try {
    const base = approved(buildExpansion(await source()).events.find((e) => e.review?.executable)!)
    const choice = riskChoice()
    for (const outcome of riskOutcomes) {
      choice.risk!.outcomes[outcome] = [
        {
          type: 'action_modifier',
          action: 'training',
          training: 'speed',
          field: 'primaryGain',
          operation: 'add',
          value: 1,
        },
      ]
    }
    const good = revision({
      ...base,
      id: 'GEN-risk-review',
      timing: 'month_start',
      conditions: [{ type: 'healthy' }],
      automatic: false,
      choices: [choice],
    })
    const before = (await f.db.query('SELECT * FROM event_definitions ORDER BY id')).rows
    await assert.rejects(
      importEvents(f.db, {
        schemaVersion: 1,
        events: [good, revision({ ...good, id: 'GEN-late-risk', timing: 'training_result' })],
      }),
      /LATE_ACTION_MODIFIER/,
    )
    assert.deepEqual((await f.db.query('SELECT * FROM event_definitions ORDER BY id')).rows, before)
    await f.db.query('UPDATE event_definitions SET enabled=false')
    await importEvents(f.db, { schemaVersion: 1, events: [good] })
    const c = await f.create()
    const selected = await f.call(
      'POST',
      `/v1/careers/${c.id}/events/${(c.response.career ?? c.response).event.id}/choice`,
      { commandId: randomUUID(), choiceId: 'risk', expectedTurn: 1 },
    )
    assert.equal(selected.statusCode, 200, selected.body)
    const actionId = randomUUID()
    const action = await f.call('POST', `/v1/careers/${c.id}/actions`, {
      actionId,
      choice: 'speed',
      expectedTurn: 1,
    })
    assert.equal(action.statusCode, 200, action.body)
    const advance = await f.call('POST', `/v1/careers/${c.id}/months/advance`, {
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

test('anonymous catalog filters and direct IDs cannot reveal unreviewed drafts or even approved hidden definitions', async () => {
  const f = await fixture()
  try {
    const catalog = buildExpansion(await source())
    await importExpansion(f.db, await source())
    const hidden = approved({
      ...catalog.events.find((e) => e.category === 'hidden')!,
      id: 'HID-private-review',
      conditions: [{ type: 'healthy' }, { type: 'value_range', key: 'speed', min: 1 }],
      timing: 'month_start',
      automatic: false,
      choices: [{ id: 'safe', label: 'safe', conditions: [], effects: [] }],
      source: {
        url: null,
        conditionText: 'SECRET_HIDDEN_TRIGGER',
        effectText: 'SECRET_HIDDEN_EFFECT',
      },
    })
    await importEvents(f.db, { schemaVersion: 1, events: [hidden] })
    assert.ok((await EventRepository.pool(f.db)).some((e) => e.id === hidden.id))
    const all = await f.app.inject({ url: '/v1/events?pageSize=100' })
    assert.equal(all.json().pagination.total, 315)
    assert.equal(all.json().data.length, 100)
    for (const query of [
      'category=hidden',
      'category=hidden&enabled=true&status=ready',
      'enabled=false',
      'status=needs_mapping',
      'status=deferred',
    ]) {
      const response = await f.app.inject({ url: `/v1/events?${query}` })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(response.json().pagination.total, 0)
      assert.deepEqual(response.json().data, [])
    }
    for (const id of [hidden.id, 'GEN-0001', 'ACC-0001', 'COM-0350']) {
      assert.equal((await f.app.inject({ url: `/v1/events/${id}` })).statusCode, 404, id)
    }
    const common = (await f.app.inject({ url: '/v1/events/COM-0001' })).json()
    assert.deepEqual(common.source, { url: null, conditionText: '', effectText: '' })
    const stored = (
      await f.db.query('SELECT definition FROM event_revisions WHERE event_id=$1 AND revision=$2', [
        hidden.id,
        hidden.revision,
      ])
    ).rows[0].definition
    assert.equal(stored.source.conditionText, 'SECRET_HIDDEN_TRIGGER')
  } finally {
    await f.close()
  }
})

test('current import properties match the checked Notion revision while archived CSV/P1 evidence stays explicit and inactive', async () => {
  const raw = await source(),
    catalog = buildExpansion(raw)
  const archived = JSON.parse(
    await readFile('seeds/archives/events.expansion.csv-snapshot-2026-10-14.json', 'utf8'),
  )
  const report = JSON.parse(await readFile('reports/event-expansion.json', 'utf8'))
  assert.equal(report.sourceComparison.compared, 1000)
  assert.equal(report.sourceComparison.changed, 20)
  assert.equal(report.sourceComparison.archivedDigest, digest(archived))
  assert.equal(
    raw.rows.find((r) => r['이벤트 ID'] === 'ACC-0001')!['이벤트명'],
    '급한 코너 진입, 순간의 선택',
  )
  assert.equal(
    archived.rows.find((r: Record<string, string>) => r['이벤트 ID'] === 'ACC-0001')['이벤트명'],
    '급한 코너 진입: 초기 대응',
  )
  for (const change of report.sourceComparison.changes) {
    assert.ok(!change.id.startsWith('COM-'))
    const event = catalog.events.find((e) => e.id === change.id)!
    assert.equal(event.enabled, false)
    assert.equal(event.review!.contentReviewed, false)
    assert.equal(event.review!.executable, false)
  }
})

test('quality audit covers all versions, preserves active definitions and emits tamper-evident non-importable review rows', async () => {
  const { auditEventQuality, reviewPacketSchema, distributionAudit } =
    await import('../src/modules/events/quality-audit')
  const common = JSON.parse(await readFile('seeds/events.catalog.json', 'utf8'))
  const expansion = JSON.parse(await readFile('seeds/events.expansion.catalog.json', 'utf8'))
  const input = {
    common: common.events,
    expansion: expansion.events,
    source: await source(),
    legacySource: JSON.parse(await readFile('seeds/events.import.json', 'utf8')),
  }
  const before = digest(input)
  const result = auditEventQuality(input)
  assert.equal(digest(input), before)
  assert.equal(result.report.summary.total, 1000)
  assert.equal(result.report.summary.common, 350)
  assert.equal(result.report.summary.expansion, 650)
  assert.equal(result.report.summary.activeCommon, 315)
  assert.equal(result.report.summary.activeExpansion, 0)
  assert.equal(result.report.summary.localFixtures, 30)
  assert.equal(result.report.summary.promotableNow, 0)
  assert.equal(new Set(result.report.records.map((r) => r.id)).size, 1000)
  assert.ok(
    result.packet.rows.every(
      (r) => !r.enabled && !r.executable && r.manualStoryReview === 'pending',
    ),
  )
  for (const record of result.report.records) {
    if (record.server.category === 'hidden' || record.server.review?.executable === false) {
      assert.equal(record.proposal.state, 'hold')
      assert.deepEqual(record.proposal.after, record.proposal.before)
      assert.equal(record.observations.skipped, 'hold_or_unmapped_no_fallback')
    }
    assert.equal(record.proposal.before.weight, record.proposal.after.weight)
    assert.deepEqual(record.proposal.before.conditions, record.proposal.after.conditions)
  }
  assert.ok(!('events' in result.packet))
  const { catalogSchema } = await import('../src/modules/events/schema')
  assert.equal(catalogSchema.safeParse(result.packet).success, false)
  const { draftCatalogSchema } = await import('../src/modules/events/drafts')
  assert.equal(draftCatalogSchema.safeParse(result.packet).success, false)
  const tampered = structuredClone(result.packet)
  tampered.rows[0].after.name = 'tampered'
  assert.equal(reviewPacketSchema.safeParse(tampered).success, false)
  assert.deepEqual(
    result.distribution,
    JSON.parse(await readFile('review/event-v2/distribution.json', 'utf8')),
  )
  assert.deepEqual(distributionAudit(input.common, 120), distributionAudit(input.common, 120))
  assert.ok(result.distribution.server.draws <= 6000 && result.distribution.local.draws <= 6000)
  const reportManifest = JSON.parse(await readFile('review/event-v2/report.json', 'utf8'))
  const packetManifest = JSON.parse(await readFile('review/event-v2/packet.json', 'utf8'))
  const loadParts = async (files: { path: string; digest: string; ids: string[] }[]) => {
    const rows: unknown[] = []
    for (const file of files) {
      const part = JSON.parse(await readFile('review/event-v2/' + file.path, 'utf8'))
      assert.equal(digest(part), file.digest)
      assert.deepEqual(
        part.map((r: { id: string }) => r.id),
        file.ids,
      )
      rows.push(...part)
    }
    return rows
  }
  const rows = await loadParts(packetManifest.files)
  const records = await loadParts(reportManifest.files)
  assert.deepEqual(rows, result.packet.rows)
  assert.deepEqual(records, result.report.records)
  assert.equal(packetManifest.revision, result.packet.revision)
  assert.equal(reviewPacketSchema.safeParse({ ...result.packet, rows }).success, true)
  assert.throws(() =>
    auditEventQuality({ ...input, expansion: [...input.expansion, input.expansion[0]] }),
  )
  const existing = common.events.find(
    (e: EventDefinition) => e.id === 'COM-0031',
  ) as EventDefinition
  const changed = structuredClone(input)
  const index = changed.common.findIndex((e: EventDefinition) => e.id === existing.id)
  const revised = {
    ...existing,
    choices: [
      {
        ...existing.choices[0],
        effects: [{ type: 'value_delta' as const, key: 'speed' as const, amount: 900 }],
      },
    ],
  }
  changed.common[index] = revision(revised)
  const candidate = auditEventQuality(changed).packet.rows.find((r) => r.id === existing.id)!
  assert.ok(candidate.findings.some((f) => f.code === 'EXTREME_EFFECT'))
  assert.equal(candidate.numericChanges[0].before, 900)
  assert.equal(candidate.numericChanges[0].after, 20)
  assert.equal(
    existing.choices[0].effects.some((e) => e.type === 'value_delta' && e.amount === 900),
    false,
  )
})
