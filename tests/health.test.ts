import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  healthGuidance,
  recoveryGuidance,
  RACE_ELIGIBILITY_NOTICE,
} from '../lib/career/health-presentation'
import { readiness } from '../lib/career/outlook'
import { HealthGuidance, RecoveryPreview } from '../components/career/health-guidance'
import { HorseFocus } from '../components/career/horse-focus'
import { BALANCE } from '../lib/career/balance'
import assert from 'node:assert/strict'
import {
  canTrain,
  canRace,
  careerHealth,
  recoverBy,
  healthSeverity,
  normalizeHealth,
} from '../lib/career/health'
import { assertCareer, commitAction, resolveAction } from '../lib/career/model'

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

test('health presentation preserves canonical limits and honest recovery estimates for legacy and current saves', () => {
  assert.equal(BALANCE.health.recovery.rest, 10)
  assert.equal(BALANCE.health.recovery.treatment, 30)
  for (const health of [
    '정상',
    '경상',
    '중등도 부상',
    '중상',
    'HEALTHY',
    'MINOR',
    'MODERATE',
    'SEVERE',
    '경미',
    '중등도',
    '중증',
    'unknown',
    'constructor',
  ]) {
    for (const healthRecovery of [undefined, 1, 10, 30, 40, 80, 140]) {
      const career = { ...startCareer('DEV_HORSE_SERENE_STEP'), health, healthRecovery }
      const before = JSON.stringify(career)
      const current = careerHealth(career)
      const guidance = healthGuidance(career)
      assert.equal(guidance.health, current.health)
      assert.equal(guidance.recovery, current.recovery)
      assert.equal(guidance.trainingAllowed, canTrain(health))
      assert.equal(guidance.racingAllowed, canRace(health))
      const expectedLevel = !canRace(health) ? 'blocked' : !canTrain(health) ? 'caution' : 'ready'
      assert.equal(readiness(career).level, expectedLevel)
      const status = renderToStaticMarkup(createElement(HealthGuidance, { career })).replace(
        /<[^>]+>/g,
        '',
      )
      assert.ok(status.includes(`현재 회복 필요량 ${current.recovery}`))
      assert.ok(status.includes(RACE_ELIGIBILITY_NOTICE))
      if (!canTrain(health) && canRace(health)) {
        assert.match(status, /경기력이 떨어지고 부상이 악화/)
        assert.match(status, /건강 조건상 출전 가능/)
        assert.doesNotMatch(readiness(career).label, /준비 양호/)
      }
      const focus = renderToStaticMarkup(createElement(HorseFocus, { career }))
      assert.ok(focus.includes(current.health))
      for (const action of ['rest', 'treatment'] as const) {
        const preview = recoveryGuidance(career, action)
        const expected = recoverBy(current, BALANCE.health.recovery[action])
        assert.deepEqual(preview.after, expected)
        const text = renderToStaticMarkup(
          createElement(RecoveryPreview, { career, action }),
        ).replace(/<[^>]+>/g, '')
        assert.ok(
          text.includes(`현재 회복 필요량 ${current.recovery} → 실행 후 예상 ${expected.recovery}`),
        )
        assert.ok(text.includes(`현재 건강 ${current.health} → 실행 후 예상 ${expected.health}`))
        assert.match(text, /이번 달 행동 1회를 사용/)
        assert.match(text, /같은 달에 훈련·경주를 추가로 할 수 없습니다/)
        assert.match(text, /실행·저장 후 확인/)
        if (expected.recovery === 0 && !canTrain(health)) {
          assert.match(text, /정상 복귀 예상/)
          assert.match(text, /다음 달부터/)
        } else if (expected.recovery > 0) {
          assert.equal(
            expected.health,
            current.health,
            'partial care never steps down injury severity',
          )
          assert.match(text, canRace(health) ? /훈련 제한은 계속/ : /훈련·출전 제한이 계속/)
        }
      }
      assert.equal(JSON.stringify(career), before)
    }
  }
})

test('readiness combines injury and fatigue/load caution and never promises actual race registration', () => {
  for (const health of ['정상', '경상', '중등도 부상', '중상']) {
    const base = startCareer('DEV_HORSE_SERENE_STEP')
    const career = { ...base, health, values: { ...base.values, fatigue: 90, bodyLoad: 90 } }
    const result = readiness(career)
    assert.equal(result.level, canRace(health) ? 'caution' : 'blocked')
    assert.match(result.detail, /피로·신체 부하/)
    assert.ok(result.detail.includes(RACE_ELIGIBILITY_NOTICE))
    if (!canTrain(health) && canRace(health)) {
      assert.match(result.detail, /경기력이 떨어지고 부상이 악화/)
    }
  }
})
