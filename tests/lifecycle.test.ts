import test from 'node:test'
import assert from 'node:assert/strict'
import { assertCareerStory } from '../lib/career/career-story'
import { archiveActiveHorse } from '../lib/career/lifecycle'

test('retirement preserves each career with a unique archive ID and the current world month', () => {
  const horse = { id: 'DEV_HORSE_SERENE_STEP', name: '세레네 스텝', record: '3전 1승' }
  const initial = { activeHorse: horse, archive: [] as (typeof horse)[], year: 2029, month: 9 }
  const first = archiveActiveHorse(initial, horse.id, 'archive-first')
  assert.equal(first.activeHorse, null)
  assert.deepEqual(first.archive[0], { ...horse, id: 'archive-first', retiredAt: '2029.09' })
  const again = { ...first, activeHorse: { ...horse, record: '6전 2승' }, year: 2030, month: 1 }
  const second = archiveActiveHorse(again, horse.id, 'archive-second')
  assert.equal(second.archive.length, 2)
  assert.deepEqual(second.archive[0], {
    ...horse,
    record: '6전 2승',
    id: 'archive-second',
    retiredAt: '2030.01',
  })
  assert.equal(second.archive[1].id, 'archive-first')
  assert.equal(initial.activeHorse, horse)
})

test('retirement cannot duplicate an archive entry or remove a different active horse', () => {
  const state = {
    activeHorse: { id: 'active' },
    archive: [{ id: 'already-saved' }],
    year: 2029,
    month: 5,
  }
  assert.equal(archiveActiveHorse(state, 'different-horse', 'new'), state)
  assert.equal(archiveActiveHorse(state, 'active', 'already-saved'), state)
  const retired = archiveActiveHorse(state, 'active', 'new')
  assert.equal(archiveActiveHorse(retired, 'active', 'new'), retired)
})

test('story chronology uses saved dates for legacy races, stable type/ID ties and does not mutate entries', async () => {
  const { sortStory } = await import('../lib/career/career-story')
  const { buildFixture } = await import('../lib/career/fixtures')
  const { newStory, captureCareer } = await import('../lib/career/career-story')
  const career = buildFixture('result-win').career!
  const story = captureCareer(newStory(career, 'historical-career'), career)
  assertCareerStory(story)
  assert.equal(story.coverage, 'partial')
  assert.equal(story.initialStats, undefined)
  assert.equal(
    story.entries.some((entry) => entry.kind === 'start'),
    false,
  )
  const race = story.entries.find((entry) => entry.kind === 'race')
  // A locked run alone is not a confirmed race result.
  assert.equal(race, undefined)
  const { completeRace } = await import('../lib/career/model')
  const log = buildFixture('result-win').log!
  const completed = completeRace(
    career,
    career.raceRun!.raceRunId,
    log.result.placing,
    log.result.prizeMoney,
  )
  const result = captureCareer(story, completed)
  const recorded = result.entries.find((entry) => entry.kind === 'race')!
  assert.equal(recorded.raceRunId, career.raceRun!.raceRunId)
  assert.ok(
    recorded.details.some((text) =>
      text.includes(String(log.result.prizeMoney.toLocaleString('ko-KR'))),
    ),
  )
  const { browserStorage } = await import('./helpers/browser-storage')
  const { writeBrowserSave, readBrowserSave } = await import('../lib/career/browser-save')
  const { retireLocalCareer } = await import('../lib/career/local-career')
  browserStorage()
  writeBrowserSave({ career: completed })
  retireLocalCareer(completed)
  const archived = readBrowserSave().lifecycle!.archive![0].story!
  const entries = archived.entries
    .map((entry) => (entry.kind === 'race' ? { ...entry, turn: undefined } : entry))
    .reverse()
  const frozen = JSON.stringify(entries)
  const sorted = sortStory(entries)
  assert.equal(sorted[0].raceRunId, career.raceRun!.raceRunId)
  assert.equal(sorted.at(-1)!.kind, 'retirement')
  assert.equal(JSON.stringify(entries), frozen)
  assert.deepEqual(captureCareer(result, completed), result)
})
