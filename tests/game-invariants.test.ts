import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  horses,
  statKeys,
  assertCareer,
  commitAction,
  resolveAction,
  advanceMonth,
  chooseEvent,
  completeRace,
} from '../lib/career/model'
import { withMonthEvent } from '../lib/career/events/director'
import { defaultEventCatalog } from '../lib/career/events/repository'
import { isHealthy } from '../lib/career/status'
import { buildFixture, fixtureIds } from '../lib/career/fixtures'
import { validateRaceLog, raceLogDigest } from '../lib/career/race-simulation'
import { careerProgress } from '../lib/career/career-time'
import { careerOutlook } from '../lib/career/outlook'
import { racesForTurn, isRaceTurn } from '../lib/career/race-entry'

test('84 months per horse preserve bounded stats, calendar order, replay idempotency and injury recovery', () => {
  for (const horse of horses) {
    let career = startCareer(horse.id)
    for (let turn = 1; turn <= 84; turn++) {
      const progress = careerProgress(turn)
      assert.equal(progress.baseTurns, 60)
      assert.equal(progress.extended, turn > 60)
      assert.equal(career.age, progress.age)
      assert.equal(progress.seasonIndex, Math.floor((turn - 1) / 12) + 1)
      assert.equal(progress.seasonTurn, ((turn - 1) % 12) + 1)
      assert.equal(isRaceTurn(turn), [3, 6, 9, 12].includes(progress.seasonTurn))
      assert.deepEqual(
        racesForTurn(turn),
        racesForTurn(progress.seasonTurn).map((race) => ({ ...race, month: turn })),
      )
      const outlook = careerOutlook(career)
      assert.deepEqual(outlook.progress, progress)
      assert.equal(outlook.nextRace?.month, Math.ceil(turn / 3) * 3)
      assert.equal(
        outlook.nextRace?.openRaces,
        outlook.readiness.level === 'blocked'
          ? 0
          : [3, 2, 2, 1][Math.ceil(progress.seasonTurn / 3) - 1],
      )
      career = withMonthEvent(career)
      if (
        career.event?.status === 'offered' &&
        defaultEventCatalog.find(career.event.eventId)?.choices
      ) {
        career = chooseEvent(career, career.event.eventId, turn % 2 ? 'A' : 'B')
      }
      const choice = !isHealthy(career.health)
        ? 'treatment'
        : turn % 4 === 0
          ? 'rest'
          : statKeys[turn % statKeys.length]
      const before = structuredClone(career)
      const committed = commitAction(career, choice)
      assert.equal(commitAction(committed, 'rest'), committed)
      const result = resolveAction(committed)
      assert.deepEqual(resolveAction(structuredClone(committed)), result)
      assert.equal(resolveAction(result), result)
      assertCareer(result)
      for (const key of statKeys) {
        assert.ok(result.values[key] >= 0 && result.values[key] <= 1000)
      }
      assert.ok(Number.isFinite(result.values.fatigue) && result.values.fatigue >= 0)
      assert.ok(Number.isFinite(result.values.bodyLoad) && result.values.bodyLoad >= 0)
      assert.deepEqual(career, before)
      const next = advanceMonth(result, result.action!.actionId)
      assert.equal(next.careerTurnIndex, turn + 1)
      assert.equal(next.month, turn + 1)
      assert.equal(next.age, careerProgress(turn + 1).age)
      assert.equal(
        next.calendarDate.year * 12 + next.calendarDate.month,
        career.calendarDate.year * 12 + career.calendarDate.month + 1,
      )
      assert.equal(advanceMonth(next, result.action!.actionId), next)
      assert.ok(next.recent.length <= 3)
      assertCareer(next)
      career = next
    }
  }
})

test('all development scenarios remain valid; race completion pays and advances only once', () => {
  for (const id of fixtureIds) {
    const fixture = buildFixture(id)
    if (!fixture.career) {
      continue
    }
    const career = fixture.career
    assertCareer(career)
    if (!fixture.log || !career.raceRun) {
      continue
    }
    validateRaceLog(fixture.log, career.raceRun)
    const digest = raceLogDigest(fixture.log)
    const runId = career.raceRun.raceRunId
    const result = fixture.log.result
    const completed = completeRace(career, runId, result.placing, result.prizeMoney)
    assert.equal(completed.raceRecords.length, career.raceRecords.length + 1)
    assert.equal(completed.careerTurnIndex, career.careerTurnIndex + 1)
    assert.equal(completeRace(completed, runId, 1, 999999999), completed)
    assert.equal(raceLogDigest(fixture.log), digest)
    assertCareer(completed)
  }
})
