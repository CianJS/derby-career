import test from 'node:test'
import assert from 'node:assert/strict'
import { commitAction, horses, resolveAction, startCareer, statKeys, type Career } from '../lib/career/model'
import { BALANCE } from '../lib/career/balance'
import { deriveCondition, injuryRiskPercent, isHealthy, isStrained, rollsInjury } from '../lib/career/status'

const base = () => startCareer(horses[0].id)
const withValues = (patch: Partial<Career['values']>, extra: Partial<Career> = {}): Career => ({ ...base(), ...extra, values: { ...base().values, ...patch } })

test('balance table drives training deltas within the declared ranges', () => {
  for (const type of statKeys) {
    const before = base()
    const after = resolveAction(commitAction(before, type))
    const gain = after.values[type] - before.values[type]
    const { base: min, spread } = BALANCE.training.primary
    assert.ok(gain >= min && gain < min + spread, `${type} gain ${gain}`)
    assert.equal(after.values.fatigue - before.values.fatigue, BALANCE.training.cost[type].fatigue)
    assert.equal(after.values.bodyLoad - before.values.bodyLoad, BALANCE.training.cost[type].bodyLoad)
  }
})

test('resolving is deterministic and idempotent', () => {
  const committed = commitAction(withValues({ fatigue: 90, bodyLoad: 85 }), 'speed')
  const once = resolveAction(committed)
  assert.deepEqual(resolveAction(committed), once)
  assert.equal(resolveAction(once), once)
})

test('stats are capped and fatigue never goes below zero', () => {
  const capped = resolveAction(commitAction(withValues({ speed: BALANCE.maxStat - 1 }), 'speed'))
  assert.equal(capped.values.speed, BALANCE.maxStat)
  const rested = resolveAction(commitAction(withValues({ fatigue: 10, bodyLoad: 5 }), 'rest'))
  assert.equal(rested.values.fatigue, 0)
  assert.equal(rested.values.bodyLoad, 0)
})

test('strain and injury risk tiers follow the balance table', () => {
  assert.equal(isStrained(69, 59), false)
  assert.equal(isStrained(70, 0), true)
  assert.equal(isStrained(0, 60), true)
  assert.equal(injuryRiskPercent({ fatigue: 10, bodyLoad: 10 }), 0)
  assert.equal(injuryRiskPercent({ fatigue: 70, bodyLoad: 10 }), 15)
  assert.equal(injuryRiskPercent({ fatigue: 90, bodyLoad: 85 }), 30)
  assert.equal(rollsInjury({ fatigue: 10, bodyLoad: 10 }, 0), false)
})

test('low-risk training never injures', () => {
  for (const type of statKeys) assert.equal(resolveAction(commitAction(base(), type)).health, '정상')
})

test('high-risk training can injure, deterministically from the seed', () => {
  const outcomes = horses.flatMap(h => statKeys.map(type => {
    const state = { ...startCareer(h.id) }
    return resolveAction(commitAction({ ...state, values: { ...state.values, fatigue: 90, bodyLoad: 85 } }, type))
  }))
  assert.ok(outcomes.some(o => o.health === '경상'), 'at least one seeded roll injures')
  assert.ok(outcomes.some(o => o.health === '정상'), 'at least one seeded roll is safe')
  for (const o of outcomes.filter(o => o.health === '경상')) {
    assert.equal(o.condition, '나쁨')
    assert.ok(o.action?.statusChanges?.some(c => c.key === 'health' && c.after === '경상'))
  }
})

test('injured horses cannot train but can rest or treat', () => {
  const injured = withValues({}, { health: '경상' })
  for (const type of statKeys) assert.throws(() => commitAction(injured, type), /부상/)
  assert.doesNotThrow(() => commitAction(injured, 'rest'))
  assert.doesNotThrow(() => commitAction(injured, 'treatment'))
})

test('treatment heals the injury and records the status change', () => {
  const injured = withValues({ fatigue: 20, bodyLoad: 30 }, { health: '경상', condition: '나쁨' })
  const treated = resolveAction(commitAction(injured, 'treatment'))
  assert.equal(treated.health, '정상')
  assert.equal(treated.values.bodyLoad, 30 + BALANCE.treatment.bodyLoad)
  assert.equal(treated.action?.actionType, 'treatment')
  assert.ok(treated.action?.statusChanges?.some(c => c.key === 'health' && c.before === '경상' && c.after === '정상'))
  assert.ok(isHealthy(treated.health))
})

test('treatment is rejected when the horse is healthy', () => {
  assert.throws(() => commitAction(base(), 'treatment'), /치료할 부상/)
})

test('condition derives from fatigue, load and health', () => {
  assert.equal(deriveCondition({ fatigue: 5, bodyLoad: 5 }, '정상'), '좋음')
  assert.equal(deriveCondition({ fatigue: 40, bodyLoad: 30 }, '정상'), '보통')
  assert.equal(deriveCondition({ fatigue: 75, bodyLoad: 10 }, '정상'), '나쁨')
  assert.equal(deriveCondition({ fatigue: 5, bodyLoad: 5 }, '경상'), '나쁨')
})
