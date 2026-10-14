import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RaceEntryForm } from '../components/career/race-entry-workspace'
import { commitAction, horses, startCareer, type Career } from '../lib/career/model'
import {
  contractedRoster,
  distanceAptitude,
  grade,
  lockRaceEntry,
  raceEligibility,
  racesForTurn,
  ridingFit,
  tactics,
} from '../lib/career/race-entry'
import { recommendRaceEntry, updateRaceEntryDraft } from '../lib/career/race-entry-recommendation'

function careerFor(horseId: string, turn: number, wins = 0): Career {
  return {
    ...startCareer(horseId),
    month: turn,
    careerTurnIndex: turn,
    raceRecords: Array.from({ length: wins }, (_, index) => ({
      raceRunId: `prior-${index}`,
      race: '신마전',
      result: '1착',
      placing: 1,
      date: '2028.06',
      prizeMoney: 8000000,
    })),
  }
}
const empty = { raceId: null, jockeyId: null, tactic: null }

test('the shown one-win career opens with the strongest eligible distance and riding-fit combination', () => {
  const career = careerFor('DEV_HORSE_SERENE_STEP', 6, 1)
  assert.deepEqual(recommendRaceEntry(career), {
    raceId: 'DEV_M6_ONE_WIN_1800',
    jockeyId: 'HAN_DOYUN',
    tactic: '선행',
  })
  assert.deepEqual(recommendRaceEntry(career), recommendRaceEntry(structuredClone(career)))
})

test('all horses and race turns recommend only eligible races, owned jockeys and the maximum existing fit score', () => {
  for (const horse of horses) {
    for (const turn of [3, 6, 9, 12]) {
      for (const wins of [0, 1]) {
        for (const ids of [
          ['HAN_DOYUN', 'SEO_JIAN', 'YOON_TAESUNG'],
          ['SEO_JIAN'],
          ['KANG_HAJUN', 'HAN_DOYUN'],
        ]) {
          const career = { ...careerFor(horse.id, turn, wins), contractedJockeyIds: ids }
          const before = structuredClone(career)
          const draft = recommendRaceEntry(career)
          const eligible = racesForTurn(turn).filter((race) => !raceEligibility(career, race))
          if (!eligible.length) {
            assert.deepEqual(draft, empty)
          } else {
            const race = eligible.find((candidate) => candidate.id === draft.raceId)!
            assert.ok(race)
            const rank = (distance: number) =>
              ['A', 'B', 'C', 'D'].indexOf(grade(career.horse.aptitude, distanceAptitude(distance)))
            assert.equal(
              rank(race.distance),
              Math.min(...eligible.map((candidate) => rank(candidate.distance))),
            )
            const roster = contractedRoster(career)
            const jockey = roster.find((candidate) => candidate.id === draft.jockeyId)!
            assert.ok(jockey)
            const scores = tactics.flatMap((tactic) =>
              roster.map((candidate) => ridingFit(career, race, candidate, tactic).score!),
            )
            assert.equal(ridingFit(career, race, jockey, draft.tactic).score, Math.max(...scores))
          }
          assert.deepEqual(career, before)
          assert.equal(career.raceRun, undefined)
          assert.equal(career.action, null)
        }
      }
    }
  }
})

test('recommendations never select uncontracted jockeys and leave confirmation incomplete with no known contracts', () => {
  const career = careerFor('DEV_HORSE_SERENE_STEP', 6, 1)
  assert.equal(
    recommendRaceEntry({ ...career, contractedJockeyIds: ['KANG_HAJUN'] }).jockeyId,
    'KANG_HAJUN',
  )
  const draft = recommendRaceEntry({ ...career, contractedJockeyIds: ['unknown'] })
  assert.equal(draft.raceId, 'DEV_M6_ONE_WIN_1800')
  assert.equal(draft.jockeyId, null)
  assert.ok(draft.tactic)
})

test('blocked turns, severe injuries, committed actions and unavailable race choices have no default entry', () => {
  const career = careerFor('DEV_HORSE_SERENE_STEP', 6, 1)
  for (const blocked of [
    careerFor(career.horse.id, 2),
    { ...career, health: '중상' },
    commitAction(career, 'rest'),
    careerFor(career.horse.id, 3, 1),
  ]) {
    assert.deepEqual(recommendRaceEntry(blocked), empty)
  }
  for (const id of [
    'DEV_M6_LISTED_2000',
    'DEV_M6_MAIDEN_MILE_1600',
    'DEV_M3_MILE_1600',
    'unknown',
  ]) {
    assert.deepEqual(recommendRaceEntry(career, id), empty)
  }
})

test('changing the race refreshes its recommended combination while explicit jockey/tactic choices remain editable', () => {
  const career = careerFor('DEV_HORSE_SERENE_STEP', 6, 1)
  const original = recommendRaceEntry(career)
  const manual = updateRaceEntryDraft(career, original, {
    jockeyId: 'YOON_TAESUNG',
    tactic: '추입',
  })
  assert.equal(manual.jockeyId, 'YOON_TAESUNG')
  assert.equal(manual.tactic, '추입')
  assert.deepEqual(updateRaceEntryDraft(career, manual, { raceId: manual.raceId }), manual)
  const changed = updateRaceEntryDraft(career, manual, { raceId: 'DEV_M6_ONE_WIN_LONG_2400' })
  assert.deepEqual(changed, {
    raceId: 'DEV_M6_ONE_WIN_LONG_2400',
    jockeyId: 'SEO_JIAN',
    tactic: '선입',
  })
  assert.equal(original.jockeyId, 'HAN_DOYUN')
  assert.equal(manual.tactic, '추입')
})

test('confirmed races retain the saved manual combination and exact seed/log across recommendations and updates', () => {
  const career = careerFor('DEV_HORSE_SERENE_STEP', 6, 1)
  const manual = {
    ...recommendRaceEntry(career),
    jockeyId: 'YOON_TAESUNG',
    tactic: '도주' as const,
  }
  const locked = lockRaceEntry(career, manual)
  const before = structuredClone(locked)
  assert.deepEqual(recommendRaceEntry(locked), manual)
  assert.deepEqual(
    updateRaceEntryDraft(locked, manual, { raceId: 'DEV_M6_ONE_WIN_LONG_2400', tactic: '선입' }),
    manual,
  )
  assert.deepEqual(locked, before)
})

function selected(html: string, name: string): string | null {
  const input = html
    .match(/<input\b[^>]*>/g)
    ?.find((tag) => tag.includes(`name="${name}"`) && tag.includes('checked=""'))
  return input?.match(/value="([^"]+)"/)?.[1] ?? null
}
test('the real entry form renders all three recommended radio choices checked and confirmation enabled without committing', () => {
  const career = careerFor('DEV_HORSE_SERENE_STEP', 6, 1)
  const before = structuredClone(career)
  const html = renderToStaticMarkup(
    createElement(RaceEntryForm, { career, busy: false, error: null }),
  )
  assert.equal(selected(html, 'entry-race'), 'DEV_M6_ONE_WIN_1800')
  assert.equal(selected(html, 'entry-jockey'), 'HAN_DOYUN')
  assert.equal(selected(html, 'entry-tactic'), '선행')
  assert.ok(/<button\b[^>]*>출전 확정<\/button>/.test(html))
  assert.ok(!/<button\b[^>]*\sdisabled(?:=|\s|>)[^>]*>출전 확정<\/button>/.test(html))
  assert.equal((html.match(/checked=""/g) ?? []).length, 3)
  assert.deepEqual(career, before)
})

test('the real confirmed form displays saved choices, disables edits and never starts a race automatically', () => {
  const career = careerFor('DEV_HORSE_SERENE_STEP', 6, 1)
  const locked = lockRaceEntry(career, {
    ...recommendRaceEntry(career),
    jockeyId: 'YOON_TAESUNG',
    tactic: '도주',
  })
  let started = false
  const html = renderToStaticMarkup(
    createElement(RaceEntryForm, {
      career: locked,
      busy: false,
      error: null,
      onStartRace: () => {
        started = true
      },
    }),
  )
  assert.equal(selected(html, 'entry-jockey'), 'YOON_TAESUNG')
  assert.equal(selected(html, 'entry-tactic'), '도주')
  assert.equal((html.match(/<fieldset disabled=""/g) ?? []).length, 3)
  assert.ok(html.includes('레이스 시작'))
  assert.equal(started, false)
})
