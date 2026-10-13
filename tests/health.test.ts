import test from 'node:test'
import assert from 'node:assert/strict'
import { canTrain, healthSeverity, normalizeHealth } from '../lib/career/health'
import { assertCareer, commitAction, resolveAction, startCareer } from '../lib/career/model'

test('unknown health names cannot resolve to inherited object properties or silently heal', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'unknown']) {
    assert.equal(healthSeverity(name), 1)
    assert.equal(canTrain(name), false)
    assert.deepEqual(normalizeHealth(name, undefined), { health: '경상', recovery: 40 })
  }
  assert.equal(healthSeverity('HEALTHY'), 0)
  assert.equal(healthSeverity('MODERATE'), 2)
  assert.equal(healthSeverity('SEVERE'), 3)
})

test('saved action and status keys must belong to the game schema rather than object prototypes', () => {
  const state = resolveAction(commitAction(startCareer('DEV_HORSE_SERENE_STEP'), 'speed'))
  assertCareer(state)
  assert.throws(() =>
    assertCareer({
      ...state,
      action: { ...state.action, result: [{ key: 'toString', before: 1, after: 2 }] },
    }),
  )
  assert.throws(() =>
    assertCareer({
      ...state,
      action: {
        ...state.action,
        statusChanges: [{ key: '__proto__', before: '정상', after: '경상' }],
      },
    }),
  )
})
