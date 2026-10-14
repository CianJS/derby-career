import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { DEFAULT_DIRECTOR_CONFIG } from '../../../packages/shared/src/events'
import {
  preflightEventDrafts,
  readDraftSource,
  inspectEventCatalog,
} from '../src/modules/events/preflight'
import {
  draftCatalogSchema,
  draftSourceDigest,
  DRAFT_BALANCE_VERSION,
} from '../src/modules/events/drafts'
import { readEventSource, importEvents, importEventDrafts } from '../src/modules/events/import'
import { EventRepository } from '../src/repositories/events'
import { digest } from '../src/services/identity'
import { fixture } from './helpers'
import { eventRegressionDigest } from './event-regression'

const draftSource = async () =>
  readDraftSource(await readFile('seeds/events.drafts.import.json', 'utf8'), 'json') as {
    rows: Record<string, string>[]
  }
const baseline = async () => JSON.parse(await readFile('seeds/events.catalog.json', 'utf8'))
const sample = () => ({
  '이벤트 ID': 'GEN-9999',
  이벤트명: '검증용 기획 초안',
  대분류: '일반',
  도입: '보류',
  등장조건: '모든 육성마',
  발동시점: '월 시작',
  '선택·효과': 'A: 즉시 피로 -2 / B: 즉시 신체 부하 -2',
  세부유형: '돌발 발견',
  description: '고정된 검증 문구',
})
const stage = (rows = [sample()]) => preflightEventDrafts({ rows }).catalog!
const packet = (events: ReturnType<typeof stage>['events']) => ({
  schemaVersion: 1,
  importMode: 'drafts',
  sourceDigest: draftSourceDigest(events),
  events,
})
const revised = (event: ReturnType<typeof stage>['events'][number]) => {
  const { revision: _revision, ...definition } = event
  return { ...definition, revision: digest(definition) }
}

test('actual 650 source rows are independently diagnosed and emitted only as inert hold records', async () => {
  const source = await draftSource()
  const old = await baseline()
  const result = preflightEventDrafts(
    source,
    old.events.map((event: { id: string }) => event.id),
  )
  assert.ok(result.catalog)
  assert.equal(result.report.summary.rows, 650)
  assert.equal(result.report.summary.errors, 0)
  assert.equal(result.report.summary.staged, 650)
  assert.equal(result.report.summary.unmappedRows, 650)
  assert.equal(result.report.summary.engineGapRows, 488)
  assert.deepEqual(result.report.summary.categories, {
    accident: 100,
    normal: 350,
    hidden: 50,
    special: 150,
  })
  assert.equal(
    result.report.sourceDigest,
    'cef5bbd4c23c1cd19f3cacf3ab08c38d07314a125e313cba1b56ec38db25361d',
  )
  for (const code of ['CONDITION_GRAMMAR', 'EFFECT_GRAMMAR']) {
    assert.equal(
      new Set(result.report.issues.filter((issue) => issue.code === code).map((issue) => issue.id))
        .size,
      650,
    )
  }
  assert.equal(
    new Set(
      result.report.issues
        .filter((issue) => issue.code === 'EFFECT_FUTURE_MODIFIER')
        .map((issue) => issue.id),
    ).size,
    150,
  )
  for (const event of result.catalog.events) {
    assert.equal(event.introduction, 'hold')
    assert.equal(event.status, 'needs_mapping')
    assert.equal(event.enabled, false)
    assert.equal(event.automatic, false)
    assert.deepEqual(event.choices, [])
    assert.deepEqual(event.conditions, [])
    assert.equal(event.source.url, null)
    assert.equal(event.source.body, undefined)
    const raw = source.rows.find((row) => row['이벤트 ID'] === event.id)!
    assert.equal(event.source.conditionText, raw['등장조건'])
    assert.equal(event.source.effectText, raw['선택·효과'])
  }
  assert.deepEqual(
    preflightEventDrafts({ rows: [...source.rows].reverse() }).catalog,
    result.catalog,
  )
})

test('both unsupported fields are reported; recognized grammar and private metadata still cannot become executable', () => {
  const row = {
    ...sample(),
    등장조건: '거리 적성 A 및 최근 3경주 승리',
    '선택·효과': 'A: 다음 달 호흡도 +3 / B: 중상으로 변경',
  }
  const result = preflightEventDrafts({ rows: [row] })
  assert.ok(result.catalog)
  for (const code of [
    'CONDITION_GRAMMAR',
    'EFFECT_GRAMMAR',
    'CONDITION_APTITUDE',
    'CONDITION_HISTORY',
    'EFFECT_FUTURE_MODIFIER',
    'EFFECT_JOCKEY_RELATION',
    'EFFECT_INJURY_CHANGE',
  ]) {
    assert.ok(
      result.report.issues.some((issue) => issue.code === code),
      code,
    )
  }
  const mapped = preflightEventDrafts({
    rows: [{ ...sample(), url: 'https://private.example/secret', body: 'PRIVATE NOTES' }],
  })
  assert.equal(mapped.report.summary.errors, 0)
  assert.equal(mapped.report.summary.unmapped, 0)
  assert.equal(mapped.catalog!.events[0].status, 'deferred')
  assert.deepEqual(mapped.catalog!.events[0].choices, [])
  assert.equal(mapped.catalog!.events[0].enabled, false)
  assert.doesNotMatch(JSON.stringify(mapped), /private\.example|PRIVATE NOTES/)
  const supported = preflightEventDrafts({
    rows: [
      { ...sample(), 등장조건: '이번 달 속도 훈련 가능, 중상·경상 등 부상으로 훈련 차단되지 않음' },
    ],
  })
  assert.equal(supported.report.summary.engineGaps, 0)
  assert.equal(supported.catalog!.events[0].status, 'deferred')
  const late = preflightEventDrafts({
    rows: [
      {
        ...sample(),
        등장조건: '속도 훈련 확정',
        발동시점: '훈련 결과',
        '선택·효과': 'A: 속도 훈련 주성장 +2 / B: 즉시 피로 -2',
      },
    ],
  })
  assert.ok(late.report.issues.some((issue) => issue.code === 'LATE_ACTION_MODIFIER'))
  assert.equal(late.catalog!.events[0].enabled, false)
})

test('missing fields, duplicate/protected IDs, categories, choice layout and numeric bounds accumulate instead of partially staging', () => {
  const missing = {
    ...sample(),
    '이벤트 ID': 'GEN-9998',
    이벤트명: '',
    등장조건: null,
    '선택·효과': '',
  }
  const duplicate = sample()
  const badCategory = { ...sample(), '이벤트 ID': 'GEN-9997', 대분류: 'constructor' }
  const choice = {
    ...sample(),
    '이벤트 ID': 'GEN-9996',
    '선택·효과': 'A: 즉시 피로 -2 / C: 즉시 피로 -1',
  }
  const huge = {
    ...sample(),
    '이벤트 ID': 'GEN-9995',
    '선택·효과': 'A: 즉시 피로 -1001 / B: 즉시 피로 -1',
  }
  const result = preflightEventDrafts(
    { rows: [duplicate, duplicate, missing, badCategory, choice, huge, null] },
    ['GEN-9999'],
  )
  assert.equal(result.catalog, null)
  for (const code of [
    'DUPLICATE_ID',
    'REQUIRED_FIELD',
    'CATEGORY',
    'CHOICE_LAYOUT',
    'EFFECT_GRAMMAR',
    'SOURCE_ROW',
  ]) {
    assert.ok(
      result.report.issues.some((issue) => issue.code === code && issue.kind === 'error'),
      code,
    )
  }
  assert.equal(
    preflightEventDrafts({ rows: [{ ...sample(), 대분류: '공통', '이벤트 ID': 'COM-0001' }] })
      .catalog,
    null,
  )
  assert.equal(
    preflightEventDrafts({ rows: [{ ...sample(), 도입: '공통 1차 후보' }] }).catalog,
    null,
  )
  assert.equal(preflightEventDrafts(null).catalog, null)
  assert.equal(preflightEventDrafts({ rows: [] }).catalog, null)
})

test('CSV input preserves BOM, quoting, commas and multiline content without interpreting unknown clauses', () => {
  const columns = Object.keys(sample())
  const row = {
    ...sample(),
    이벤트명: '초안, 이름',
    '선택·효과': 'A: 다음 훈련 성장 +3\n(기획 검토) / B: 즉시 피로 -2',
  }
  const quote = (text: string) => '"' + text.replaceAll('"', '""') + '"'
  const csv =
    '\uFEFF' +
    columns.map(quote).join(',') +
    '\n' +
    columns.map((key) => quote(row[key as keyof typeof row])).join(',') +
    '\n'
  const result = preflightEventDrafts(readDraftSource(csv, 'csv'))
  assert.equal(result.report.summary.errors, 0)
  assert.equal(result.catalog!.events[0].source.effectText, row['선택·효과'])
  assert.throws(() => readDraftSource('"unterminated', 'csv'))
  assert.throws(() => readDraftSource('{', 'json'))
})

test('structured inspector identifies duplicate choices, unknown types, conflicting ranges, bad effect contexts and revisions', async () => {
  const original = (await baseline()).events[0]
  assert.equal(inspectEventCatalog(await baseline()).summary.errors, 0)
  const ranges = revised({
    ...original,
    conditions: [
      { type: 'value_range', key: 'speed', min: 800 },
      { type: 'value_range', key: 'speed', max: 400 },
      { type: 'turn_range' },
    ],
  })
  assert.ok(
    inspectEventCatalog({ schemaVersion: 1, events: [ranges] }).issues.some(
      (issue) => issue.code === 'CONTRADICTORY_RANGE',
    ),
  )
  assert.ok(
    inspectEventCatalog({ schemaVersion: 1, events: [ranges] }).issues.some(
      (issue) => issue.code === 'EMPTY_RANGE',
    ),
  )
  const unsupported = {
    ...original,
    conditions: [{ type: 'aptitude', grade: 'A' }],
    choices: [
      { id: 'A', label: 'bad', conditions: [], effects: [{ type: 'money_delta', amount: 100 }] },
      { id: 'A', label: 'duplicate', conditions: [], effects: [] },
    ],
  }
  const report = inspectEventCatalog({ schemaVersion: 1, events: [unsupported, unsupported] })
  for (const code of ['SCHEMA', 'DUPLICATE_ID', 'CONDITION_TYPE', 'EFFECT_TYPE']) {
    assert.ok(
      report.issues.some((issue) => issue.code === code),
      code,
    )
  }
  const late = revised({
    ...original,
    timing: 'rest_result',
    choices: [
      {
        id: 'auto',
        label: 'late',
        conditions: [],
        effects: [
          {
            type: 'action_modifier',
            action: 'training',
            training: 'intelligence',
            field: 'secondaryGain',
            operation: 'add',
            value: 3,
          },
        ],
      },
    ],
  })
  const lateReport = inspectEventCatalog({ schemaVersion: 1, events: [late] })
  assert.ok(lateReport.issues.some((issue) => issue.code === 'LATE_ACTION_MODIFIER'))
  assert.ok(lateReport.issues.some((issue) => issue.code === 'MISSING_SECONDARY_STAT'))
  assert.ok(
    inspectEventCatalog({
      schemaVersion: 1,
      events: [{ ...original, revision: '0'.repeat(64) }],
    }).issues.some((issue) => issue.code === 'REVISION'),
  )
})

test('350 original definitions, their byte hashes, director probability and frozen seeded effects remain unchanged', async () => {
  const golden = JSON.parse(await readFile('tests/fixtures/events-v1.json', 'utf8'))
  for (const [name, hash] of [
    ['events.import.json', golden.sourceSha256],
    ['events.catalog.json', golden.catalogSha256],
  ]) {
    assert.equal(
      createHash('sha256')
        .update(await readFile('seeds/' + name))
        .digest('hex'),
      hash,
    )
  }
  const original = await baseline()
  assert.deepEqual(
    readEventSource(await readFile('seeds/events.import.json', 'utf8'), 'json'),
    original,
  )
  assert.equal(original.events.length, golden.total)
  const pool = original.events.filter(
    (event: { enabled: boolean; status: string }) => event.enabled && event.status === 'ready',
  )
  assert.equal(pool.length, golden.enabled)
  assert.deepEqual(DEFAULT_DIRECTOR_CONFIG, golden.directorConfig)
  assert.equal(eventRegressionDigest(pool), golden.regressionDigest)
})

test('draft packet rejects activation, executable rules, edited provenance and misuse through ordinary import', async () => {
  const good = stage()
  for (const change of [
    { enabled: true, introduction: 'candidate' as const, status: 'ready' as const },
    { conditions: [{ type: 'always' as const }] },
    {
      choices: [
        {
          id: 'A',
          label: 'execute',
          conditions: [],
          effects: [{ type: 'value_delta' as const, key: 'speed' as const, amount: 5 }],
        },
      ],
    },
    { balanceVersion: 'approved' },
    { source: { ...good.events[0].source, body: 'PRIVATE' } },
  ]) {
    assert.throws(() =>
      draftCatalogSchema.parse(packet([revised({ ...good.events[0], ...change })])),
    )
  }
  assert.throws(() => draftCatalogSchema.parse({ ...good, sourceDigest: '0'.repeat(64) }))
  assert.throws(() => readEventSource(JSON.stringify(good), 'json'))
  assert.equal(good.events[0].balanceVersion, DRAFT_BALANCE_VERSION)
})

test('local PostgreSQL imports all 650 twice without adding executable rows or changing the 350-event pool/draws', async () => {
  const f = await fixture()
  try {
    const source = await draftSource()
    const result = preflightEventDrafts(source)
    const oldDefinitions = await f.db.query('SELECT * FROM event_definitions ORDER BY id')
    const oldChoices = await f.db.query(
      'SELECT * FROM event_choices ORDER BY event_id,revision,choice_id',
    )
    const oldEffects = await f.db.query(
      'SELECT * FROM event_effects ORDER BY event_id,revision,choice_id,ordinal',
    )
    const beforePool = await f.db.transaction((tx) => EventRepository.pool(tx))
    const beforeDigest = eventRegressionDigest(beforePool)
    for (let i = 0; i < 2; i++) {
      const imported = await importEventDrafts(f.db, result.catalog)
      assert.equal(imported.imported, 650)
      assert.equal(imported.enabled, 0)
    }
    assert.equal(
      Number((await f.db.query('SELECT count(*) AS n FROM event_definitions')).rows[0].n),
      1000,
    )
    assert.equal(
      Number((await f.db.query('SELECT count(*) AS n FROM event_revisions')).rows[0].n),
      1000,
    )
    assert.deepEqual(
      (await f.db.query("SELECT * FROM event_definitions WHERE category='common' ORDER BY id"))
        .rows,
      oldDefinitions.rows,
    )
    assert.deepEqual(
      (await f.db.query('SELECT * FROM event_choices ORDER BY event_id,revision,choice_id')).rows,
      oldChoices.rows,
    )
    assert.deepEqual(
      (await f.db.query('SELECT * FROM event_effects ORDER BY event_id,revision,choice_id,ordinal'))
        .rows,
      oldEffects.rows,
    )
    const afterPool = await f.db.transaction((tx) => EventRepository.pool(tx))
    assert.deepEqual(afterPool, beforePool)
    assert.equal(eventRegressionDigest(afterPool), beforeDigest)
    const publicDraft = (await f.call('GET', '/v1/events/GEN-0001')).json()
    assert.equal(publicDraft.enabled, false)
    assert.equal(publicDraft.introduction, 'hold')
    assert.deepEqual(publicDraft.choices, [])
    assert.equal(publicDraft.source.url, null)
    await assert.rejects(importEvents(f.db, result.catalog))
  } finally {
    await f.close()
  }
})

test('draft-only transaction protects existing reviewed events and rolls back all additions on conflict', async () => {
  const f = await fixture()
  try {
    const draft = stage()
    const reviewed = revised({
      ...draft.events[0],
      introduction: 'candidate',
      enabled: true,
      status: 'ready',
      balanceVersion: 'explicit-test-review',
      conditions: [{ type: 'always' }],
      choices: [{ id: 'A', label: 'reviewed', conditions: [], effects: [] }],
    })
    await importEvents(f.db, { schemaVersion: 1, events: [reviewed] })
    const original = await f.db.query("SELECT * FROM event_definitions WHERE id='GEN-9999'")
    const added = stage([{ ...sample(), '이벤트 ID': 'GEN-9998' }]).events[0]
    await assert.rejects(
      importEventDrafts(f.db, packet([added, draft.events[0]])),
      /cannot overwrite/,
    )
    assert.equal(
      (await f.db.query("SELECT id FROM event_definitions WHERE id='GEN-9998'")).rows.length,
      0,
    )
    assert.deepEqual(
      (await f.db.query("SELECT * FROM event_definitions WHERE id='GEN-9999'")).rows,
      original.rows,
    )
    await assert.rejects(
      importEventDrafts(f.db, packet([{ ...draft.events[0], revision: '0'.repeat(64) }])),
      /checksum mismatch/,
    )
    assert.equal(
      (await f.db.query("SELECT revision FROM event_revisions WHERE event_id='GEN-9999'")).rows
        .length,
      1,
    )
    const first = stage([{ ...sample(), '이벤트 ID': 'GEN-9995' }]).events[0]
    const second = stage([{ ...sample(), '이벤트 ID': 'GEN-9996' }]).events[0]
    await f.db.query(
      "ALTER TABLE event_definitions ADD CONSTRAINT test_reject_draft CHECK (id<>'GEN-9996')",
    )
    await assert.rejects(importEventDrafts(f.db, packet([first, second])), /test_reject_draft/)
    assert.equal(
      (await f.db.query("SELECT id FROM event_definitions WHERE id IN ('GEN-9995','GEN-9996')"))
        .rows.length,
      0,
    )
    assert.equal(
      (
        await f.db.query(
          "SELECT event_id FROM event_revisions WHERE event_id IN ('GEN-9995','GEN-9996')",
        )
      ).rows.length,
      0,
    )
    await f.db.query('ALTER TABLE event_definitions DROP CONSTRAINT test_reject_draft')
    await importEventDrafts(f.db, packet([first, second]))
    await f.db.query("UPDATE event_definitions SET enabled=true,status='ready' WHERE id='GEN-9995'")
    await assert.rejects(importEventDrafts(f.db, packet([first])), /cannot overwrite/)
    assert.equal(
      (await f.db.query("SELECT enabled FROM event_definitions WHERE id='GEN-9995'")).rows[0]
        .enabled,
      true,
    )
  } finally {
    await f.close()
  }
})

test('offline CLI writes diagnostics, never overwrites original seeds, and fails malformed input without a packet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'derby-event-preflight-'))
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/preflight-events.ts', ...args], {
      encoding: 'utf8',
    })
  try {
    const report = join(directory, 'report.json')
    const drafts = join(directory, 'drafts.json')
    const result = run('seeds/events.drafts.import.json', report, drafts)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(await readFile(report, 'utf8')).summary.staged, 650)
    assert.equal(
      draftCatalogSchema.parse(JSON.parse(await readFile(drafts, 'utf8'))).events.length,
      650,
    )
    assert.notEqual(run('seeds/events.drafts.import.json', 'seeds/events.catalog.json').status, 0)
    const invalid = run(
      'seeds/events.import.json',
      join(directory, 'bad-report.json'),
      join(directory, 'bad-drafts.json'),
    )
    assert.equal(invalid.status, 1)
    assert.ok(
      JSON.parse(await readFile(join(directory, 'bad-report.json'), 'utf8')).summary.errors > 0,
    )
    await assert.rejects(readFile(join(directory, 'bad-drafts.json')), /ENOENT/)
    const structured = run('seeds/events.catalog.json', join(directory, 'existing-report.json'))
    assert.equal(structured.status, 0, structured.stderr)
    assert.equal(
      JSON.parse(await readFile(join(directory, 'existing-report.json'), 'utf8')).summary.rows,
      350,
    )
    assert.equal(
      JSON.parse(await readFile(join(directory, 'existing-report.json'), 'utf8')).summary.enabled,
      315,
    )
    assert.ok(resolve(drafts).startsWith(directory))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
