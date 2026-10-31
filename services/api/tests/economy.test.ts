import { legacyCareer as startCareer } from '../../../tests/helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { raceEligibility, raceDefinitions } from '../../../packages/shared/src/domain'
import { registerEconomyTests } from './economy-cases'

test('shared eligibility keeps the Local Save fee gate and checks authoritative Server Save funds', () => {
  const career = { ...startCareer('DEV_HORSE_SERENE_STEP'), month: 3, careerTurnIndex: 3 }
  const race = { ...raceDefinitions[1], entryFee: 500000 }
  assert.match(raceEligibility(career, race)!, /후속 Economy/)
  assert.equal(raceEligibility(career, race, 500000), null)
  assert.match(raceEligibility(career, race, 499999)!, /자금이 부족/)
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.match(
      raceEligibility(career, { ...race, entryFee: value }, 20000000)!,
      /확인할 수 없습니다/,
    )
    assert.match(raceEligibility(career, race, value)!, /확인할 수 없습니다/)
  }
  assert.equal(raceEligibility(career, { ...race, entryFee: 0 }, 0), null)
  assert.match(raceEligibility(career, { ...race, minWins: 1 }, 20000000)!, /1승 이상/)
  const twoYearOldRace = { ...race, month: 9, minAge: 2, maxAge: 2 }
  assert.equal(
    raceEligibility({ ...career, month: 9, careerTurnIndex: 9 }, twoYearOldRace, 500000),
    null,
  )
  for (const turn of [21, 33, 45, 57, 69]) {
    assert.match(
      raceEligibility(
        { ...career, month: turn, careerTurnIndex: turn },
        { ...twoYearOldRace, month: turn },
        500000,
      )!,
      /연령/,
    )
  }
  assert.match(raceEligibility(career, { ...race, minAge: 3, maxAge: 2 }, 500000)!, /연령 조건/)
})

registerEconomyTests('PostgreSQL economy')
