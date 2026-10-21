import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TrainingPreview } from '../components/career/training-preview'
import { AppliedEventNote } from '../components/career/month-event'
import { createEventCatalog } from '../lib/career/events/repository'
import type { EventDefinition } from '../lib/career/events/types'
import {
  advanceMonth,
  chooseEvent,
  commitAction,
  horses,
  resolveAction,
  statKeys,
  trainings,
  trainingPreview,
  type Career,
} from '../lib/career/model'
import { clearCareer, readCareer, writeCareer } from '../lib/career/repository'
import { applyCareer } from '../lib/career/lifecycle'
import { readLifecycleSave, writeLifecycleSave } from '../lib/career/lifecycle-repository'
import { browserStorage } from './helpers/browser-storage'
import { fixtureLifecycle } from '../lib/career/fixtures'

test('monthly state extends the existing lifecycle without replacing management data', () => {
  const original = {
    activeHorse: null,
    month: 9,
    stableName: '보존할 마방',
    funds: '₩42,800,000',
    archive: [{ id: 'retired' }],
    country: '대한민국',
    year: 2030,
  }
  const career = resolveAction(commitAction(startCareer(horses[1].id), 'stamina'))
  const merged = applyCareer(original, career)
  assert.equal(merged.stableName, original.stableName)
  assert.equal(merged.archive, original.archive)
  assert.equal(merged.funds, original.funds)
  assert.equal(merged.month, career.calendarDate.month)
  assert.equal(merged.year, career.calendarDate.year)
  assert.notEqual(merged.month, career.month)
  assert.equal((merged.activeHorse as unknown as { name: string }).name, '세레네 스텝')
  assert.equal(original.activeHorse, null)
})

test('all candidates have exact starting values and nine aptitudes', () => {
  assert.equal(horses.length, 3)
  for (const horse of horses) {
    const state = startCareer(horse.id)
    assert.equal(state.month, 1)
    assert.equal(state.age, 2)
    assert.equal(state.values.fatigue, 5)
    assert.equal(state.values.bodyLoad, 5)
    assert.equal(state.condition, '보통')
    assert.equal(state.health, '정상')
    assert.equal(horse.aptitude.length, 9)
    for (const stat of statKeys) {
      assert.equal(state.values[stat], horse.stats[stat])
    }
  }
})
test('all five trainings are deterministic and lock once per month', () => {
  for (const horse of horses) {
    for (const stat of statKeys) {
      const start = startCareer(horse.id)
      const committed = commitAction(start, stat)
      assert.equal(committed.action!.result, null)
      assert.deepEqual(committed.values, start.values)
      assert.equal(commitAction(committed, 'rest'), committed)
      const result = resolveAction(committed)
      assert.deepEqual(resolveAction(JSON.parse(JSON.stringify(committed))), result)
      assert.equal(resolveAction(result), result)
      assert.equal(commitAction(result, 'rest'), result)
      assert.ok(result.values[stat] - start.values[stat] >= 14)
      assert.ok(result.values[stat] - start.values[stat] <= 18)
      assert.equal(result.values.fatigue, 5 + trainings[stat].fatigue)
      assert.equal(result.values.bodyLoad, 5 + trainings[stat].bodyLoad)
      assert.equal(result.action!.result!.length, stat === 'intelligence' ? 3 : 4)
      const next = advanceMonth(result, result.action!.actionId)
      assert.equal(next.month, 2)
      assert.deepEqual(next.values, result.values)
      assert.equal(next.action, null)
      assert.deepEqual(next.recent, [result.action])
      assert.equal(advanceMonth(next, result.action!.actionId), next)
    }
  }
})
test('training previews follow the current choice and match saved event costs for all five trainings', () => {
  const offered: Career = {
    ...startCareer(horses[0].id),
    event: { eventId: 'COM-0033', month: 1, seed: 42, status: 'offered' },
  }
  const unchanged = structuredClone(offered)
  const a = chooseEvent(offered, 'COM-0033', 'A')
  const b = chooseEvent(offered, 'COM-0033', 'B')
  for (const type of statKeys) {
    assert.deepEqual(trainingPreview(offered, type).effects, [])
    for (const state of [a, b]) {
      const before = structuredClone(state)
      const preview = trainingPreview(state, type)
      const resolved = resolveAction(commitAction(state, type))
      for (const cost of preview.costs) {
        assert.equal(cost.after, resolved.values[cost.key])
        assert.equal(cost.final, cost.base + cost.event)
        assert.equal(cost.event, resolved.action!.event?.[cost.key] ?? 0)
      }
      assert.deepEqual(state, before, 'preview does not commit, draw, consume, or mutate the event')
    }
    assert.equal(trainingPreview(b, type).costs[1].event, -2)
  }
  const cost = trainingPreview(b, 'speed').costs[1]
  assert.deepEqual(cost, { key: 'bodyLoad', base: 13, event: -2, final: 11, before: 5, after: 16 })
  assert.deepEqual(offered, unchanged)
  assert.equal(
    trainingPreview(a, 'speed').effects.length,
    0,
    'power-only option does not affect speed',
  )
  assert.equal(trainingPreview(a, 'power').effects.length, 1)
  for (const event of [
    undefined,
    null,
    { ...b.event!, eventId: 'unknown' },
    { ...b.event!, status: 'expired' as const },
    { ...b.event!, status: 'applied' as const },
  ]) {
    assert.deepEqual(trainingPreview({ ...offered, event }, 'speed').effects, [])
  }
  const immediate = chooseEvent(
    { ...offered, event: { ...offered.event!, eventId: 'COM-0034' } },
    'COM-0034',
    'A',
  )
  assert.equal(immediate.values.fatigue, 2)
  assert.equal(trainingPreview(immediate, 'speed').costs[0].before, 2)
  assert.equal(
    trainingPreview(immediate, 'speed').costs[0].event,
    0,
    'immediate effects are not applied twice',
  )
})
test('training previews reuse effect accumulation, rounding and zero bounds without capping status at 100', () => {
  const definition: EventDefinition = {
    id: 'preview-effects',
    name: 'test',
    description: '',
    kind: 'focus',
    timing: 'month-start',
    condition: {},
    weight: 1,
    limitedToMonth: true,
    effects: [
      { scope: 'training', growth: { multiplier: 1.25 }, fatigue: -100, bodyLoad: -1 },
      { scope: 'speed', growth: { ratio: 0.15, flat: -1 }, fatigue: 2, bodyLoad: -1 },
      { scope: 'immediate', fatigue: 99 },
      { scope: 'rest', bodyLoad: 99 },
    ],
  }
  const catalog = createEventCatalog([definition])
  for (const type of statKeys) {
    for (const bodyLoad of [0, 99, 150]) {
      const state: Career = {
        ...startCareer(horses[0].id),
        event: { eventId: definition.id, month: 1, seed: 1, status: 'offered' },
      }
      state.values = { ...state.values, fatigue: 0, bodyLoad }
      const preview = trainingPreview(state, type, catalog)
      const committed = commitAction(state, type)
      const resolved = resolveAction(committed, catalog)
      assert.equal(preview.costs[0].final, 0)
      for (const cost of preview.costs) {
        assert.equal(resolved.values[cost.key], cost.after)
        assert.equal(resolved.action!.event![cost.key], cost.event)
      }
      const primary = 14 + (committed.action!.seed % 5)
      assert.equal(
        resolved.values[type] - state.values[type],
        primary + Math.round(primary * 0.25 + (type === 'speed' ? primary * 0.15 - 1 : 0)),
      )
    }
  }
})
test('training cost UI and applied note agree while server previews never assert Local modifiers', () => {
  const career = chooseEvent(
    {
      ...startCareer(horses[0].id),
      event: { eventId: 'COM-0033', month: 1, seed: 42, status: 'offered' },
    },
    'COM-0033',
    'B',
  )
  const render = (state: Career, serverMode: boolean) =>
    renderToStaticMarkup(
      createElement(TrainingPreview, { career: state, type: 'speed', serverMode }),
    )
  const local = render(career, false)
  assert.match(local, /5 → 16 \(\+11\)/)
  assert.match(local, /기본 \+13 · 이벤트 -2/)
  assert.match(local, /최종 \+11/)
  const applied = resolveAction(commitAction(career, 'speed'))
  assert.match(
    renderToStaticMarkup(createElement(AppliedEventNote, { action: applied.action! })),
    /신체 부하 -2/,
  )
  const server = render(career, true)
  assert.match(server, /이벤트 미확인/)
  assert.match(server, /최종 미확인/)
  assert.match(server, /서버 확정 시 변동 가능/)
  assert.doesNotMatch(server, /이벤트 -2|최종 \+11|이벤트 반영 최종 예상/)
  assert.notEqual(
    render({ ...career, event: { ...career.event!, status: 'expired' } }, false),
    local,
  )
})
test('rest clamps at zero, omits unchanged values, and recent history stays compact', () => {
  let state = startCareer(horses[0].id)
  assert.equal(advanceMonth(state, 'missing'), state)
  const pending = commitAction(state, 'rest')
  assert.equal(advanceMonth(pending, pending.action!.actionId), pending)
  state = resolveAction(pending)
  assert.equal(state.values.fatigue, 0)
  assert.equal(state.values.bodyLoad, 0)
  assert.equal(state.action!.result!.length, 2)
  for (let i = 0; i < 5; i++) {
    state = advanceMonth(state, state.action!.actionId)
    state = resolveAction(commitAction(state, 'rest'))
    assert.deepEqual(state.action!.result, [])
  }
  assert.equal(state.recent.length, 3)
  assert.deepEqual(
    state.recent.map((action) => action.month),
    [5, 4, 3],
  )
})
test('browser repository round-trips action states and preserves saves on failed writes', () => {
  const storage = browserStorage()
  assert.equal(readCareer(), null)
  let state = startCareer(horses[0].id)
  for (const next of [
    state,
    commitAction(state, 'speed'),
    resolveAction(commitAction(state, 'speed')),
  ]) {
    writeCareer(next)
    assert.deepEqual(readCareer(), next)
    state = next
  }
  const next = advanceMonth(state, state.action!.actionId)
  storage.rejectWrites(true)
  assert.throws(() => writeCareer(next), /저장 공간/)
  assert.deepEqual(readCareer(), state)
  storage.rejectWrites(false)
  writeCareer(next)
  assert.deepEqual(readCareer(), next)
  const lifecycle = {
    ...fixtureLifecycle(true),
    activeHorse: applyCareer({ activeHorse: null, month: 4 }, next).activeHorse,
  }
  writeLifecycleSave(lifecycle)
  const persisted = readLifecycleSave()
  storage.rejectWrites(true)
  assert.throws(() => writeLifecycleSave({ ...lifecycle, funds: '₩0' }), /저장 공간/)
  assert.deepEqual(readLifecycleSave(), persisted)
  storage.rejectWrites(false)
  clearCareer()
  assert.equal(readCareer(), null)
})
