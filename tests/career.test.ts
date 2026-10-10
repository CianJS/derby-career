import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceMonth, commitAction, horses, resolveAction, startCareer, statKeys, trainings } from '../lib/career/model'
import { clearCareer, readCareer, writeCareer } from '../lib/career/repository'
import { applyCareer } from '../lib/career/lifecycle'
import { readLifecycleSave, writeLifecycleSave } from '../lib/career/lifecycle-repository'

test('monthly state extends the existing lifecycle without replacing management data', () => {
  const original = { activeHorse: null, month: 4, stableName: '보존할 마방', funds: '₩42,800,000', archive: [{ id: 'retired' }], country: '대한민국', year: 2028 }
  const career = resolveAction(commitAction(startCareer(horses[1].id), 'stamina'))
  const merged = applyCareer(original, career)
  assert.equal(merged.stableName, original.stableName)
  assert.equal(merged.archive, original.archive)
  assert.equal(merged.funds, original.funds)
  assert.equal(merged.month, 1)
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
    for (const stat of statKeys) assert.equal(state.values[stat], horse.stats[stat])
  }
})
test('all five trainings are deterministic and lock once per month', () => {
  for (const horse of horses) for (const stat of statKeys) {
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
  assert.deepEqual(state.recent.map(action => action.month), [5, 4, 3])
})
test('cookie repository round-trips commitments, locked results, next month and failed writes', () => {
  const cookies = new Map<string, string>()
  let rejectWrites = false
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'https:' } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
    set cookie(serialized: string) {
      if (rejectWrites) return
      const pair = serialized.split(';')[0]
      const split = pair.indexOf('=')
      const name = pair.slice(0, split)
      if (serialized.includes('max-age=0')) cookies.delete(name)
      else { assert.ok(serialized.length < 4096); cookies.set(name, pair.slice(split + 1)) }
    },
  } })
  assert.equal(readCareer(), null)
  let state = startCareer(horses[0].id)
  writeCareer(state)
  assert.deepEqual(readCareer(), state)
  state = commitAction(state, 'speed')
  writeCareer(state)
  assert.deepEqual(readCareer(), state)
  state = resolveAction(readCareer()!)
  writeCareer(state)
  assert.deepEqual(readCareer(), state)
  assert.equal(resolveAction(state), state)
  const next = advanceMonth(state, state.action!.actionId)
  rejectWrites = true
  assert.throws(() => writeCareer(next), /저장/)
  assert.deepEqual(readCareer(), state)
  rejectWrites = false
  writeCareer(next)
  assert.deepEqual(readCareer(), next)
  assert.ok(cookies.size <= 5)
  cookies.clear()
  cookies.set('derby-career-lifecycle', encodeURIComponent(JSON.stringify({ month: 4, activeHorse: { id: 'legacy', name: '기존 말', age: '3세', growth: '표준', stats: [['속도', 601], ['지구력', 502], ['파워', 503], ['근성', 504], ['지능', 505]], aptitude: [['마장', '잔디', 'A']], fatigue: 21, bodyLoad: 30 } })))
  const migrated = readCareer()!
  assert.equal(migrated.horse.id, 'legacy')
  assert.equal(migrated.values.speed, 601)
  assert.equal(migrated.values.fatigue, 21)
  assert.equal(migrated.month, 4)
  assert.deepEqual(readCareer(), migrated)
  assert.ok(cookies.has('derby-career-lifecycle'))
  const original = cookies.get('derby-career-lifecycle')
  clearCareer()
  assert.equal(cookies.get('derby-career-lifecycle'), original)
  assert.equal(cookies.has('derby-career-lifecycle-checkpoint-1'), false)
  const largeLifecycle = { activeHorse: migrated.horse, archive: Array.from({ length: 8 }, (_, id) => ({ id, name: '보존할 은퇴마 기록'.repeat(15) })), funds: '₩42,800,000' }
  writeLifecycleSave(largeLifecycle)
  assert.deepEqual(readLifecycleSave(), largeLifecycle)
  assert.equal(cookies.get('derby-career-lifecycle'), original)
  rejectWrites = true
  assert.throws(() => writeLifecycleSave({ ...largeLifecycle, funds: '₩0' }), /저장/)
  assert.deepEqual(readLifecycleSave(), largeLifecycle)
  rejectWrites = false
})
