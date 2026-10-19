import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceMonth,
  commitAction,
  horses,
  resolveAction,
  startCareer,
  statKeys,
  trainings,
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
