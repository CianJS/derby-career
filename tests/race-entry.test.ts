import test from 'node:test'
import assert from 'node:assert/strict'
import { applyRaceResult, advanceMonth, assertCareer, commitAction, horses, resolveAction, startCareer } from '../lib/career/model'
import { contractedJockeys, entryRestriction, lockRaceEntry, raceDefinitions, ridingFit, type RaceEntryDraft } from '../lib/career/race-entry'
import { readCareer, writeCareer } from '../lib/career/repository'
import { applyCareer } from '../lib/career/lifecycle'
import { summarizeRecords } from '../lib/career/records'

const draft: RaceEntryDraft = { raceId: raceDefinitions[1].id, jockeyId: contractedJockeys[2].id, tactic: '선입' }
const month3 = () => ({ ...startCareer(horses[1].id), month: 3, careerTurnIndex: 3 })
test('only healthy maiden horses in month three may enter, irrespective of aptitude', () => {
  assert.match(entryRestriction({ ...month3(), month: 2, careerTurnIndex: 2 })!, /3개월/)
  assert.match(entryRestriction({ ...month3(), health: '부상' })!, /건강/)
  assert.match(entryRestriction({ ...month3(), record: '1전 1승' })!, /미승리/)
  assert.equal(entryRestriction(month3()), null)
  assert.equal(entryRestriction({ ...month3(), health: 'HEALTHY' }), null)
  const state = month3()
  state.horse = { ...state.horse, aptitude: state.horse.aptitude.map(([name]) => [name, 'D']) }
  assert.ok(lockRaceEntry(state, draft).raceRun)
  assert.throws(() => lockRaceEntry({ ...month3(), month: 2, careerTurnIndex: 2 }, draft))
  assert.throws(() => lockRaceEntry({ ...month3(), health: '부상' }, draft))
})
test('draft selection is not a monthly commitment and incomplete selections are rejected', () => {
  const state = month3()
  for (const key of ['raceId', 'jockeyId', 'tactic'] as const) assert.throws(() => lockRaceEntry(state, { ...draft, [key]: null }))
  assert.equal(state.action, null)
  assert.equal(state.raceRun, undefined)
  assert.ok(commitAction(state, 'rest').action)
})
test('confirmation deep-copies snapshots, locks identity once and blocks all monthly mutations', () => {
  const state = month3()
  let calls = 0
  const locked = lockRaceEntry(state, draft, () => `identity-${++calls}`)
  assert.equal(calls, 2)
  assertCareer(locked)
  assert.equal(locked.raceRun!.runners.length, 12)
  assert.equal(locked.raceRun!.player.horseSnapshot.values.speed, state.values.speed)
  state.values.speed += 100
  assert.notEqual(locked.raceRun!.player.horseSnapshot.values.speed, state.values.speed)
  assert.equal(lockRaceEntry(locked, { ...draft, tactic: '추입' }, () => { throw new Error('must not generate again') }), locked)
  assert.equal(commitAction(locked, 'rest'), locked)
  assert.equal(resolveAction(locked), locked)
  assert.equal(advanceMonth(locked, 'anything'), locked)
  assert.throws(() => lockRaceEntry(commitAction(month3(), 'speed'), draft))
  assert.throws(() => assertCareer({ ...locked, raceRun: { ...locked.raceRun, raceSeed: '' } }))
  assert.throws(() => assertCareer({ ...locked, raceRun: { ...locked.raceRun, runners: [] } }))
})
test('all runner snapshots fit existing cookie repository and round-trip without reroll', () => {
  const cookies = new Map<string, string>()
  let rejectWrites = false
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'https:' } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { get cookie() { return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, set cookie(value: string) { if (rejectWrites) return; const pair = value.split(';')[0]; const at = pair.indexOf('='); const name = pair.slice(0, at); if (value.includes('max-age=0')) cookies.delete(name); else cookies.set(name, pair.slice(at + 1)) } } })
  const legacy = month3()
  const legacyPayload = encodeURIComponent(JSON.stringify(legacy))
  const chunks = legacyPayload.match(/.{1,2800}/g)!
  cookies.set('derby-career-lifecycle-checkpoint-1', `legacy.${chunks.length}`)
  chunks.forEach((chunk, i) => cookies.set(`derby-career-lifecycle-checkpoint-1-legacy-${i}`, chunk))
  assert.deepEqual(readCareer(), legacy)
  for (const race of raceDefinitions) {
    const locked = lockRaceEntry(month3(), { ...draft, raceId: race.id })
    writeCareer(locked)
    assert.deepEqual(readCareer(), locked)
    assert.ok(document.cookie.length < 6000, 'compressed race save must leave room for existing lifecycle and request headers')
    assert.equal(readCareer()!.raceRun!.raceSeed, locked.raceRun!.raceSeed)
    assert.ok(encodeURIComponent(JSON.stringify(locked)).length <= 16 * 2800)
    rejectWrites = true
    assert.throws(() => writeCareer(month3()))
    assert.deepEqual(readCareer(), locked)
    rejectWrites = false
  }
})
test('race records are empty initially and result application is idempotent across save reloads', () => {
  const locked = lockRaceEntry(month3(), draft)
  assert.deepEqual(locked.raceRecords, [])
  const runId = locked.raceRun!.raceRunId
  const finished = applyRaceResult(locked, runId, 2, 3000000)
  assert.equal(finished.raceRecords.length, 1)
  assert.equal(finished.record, '1전 0승')
  assert.equal(finished.prize, '₩3,000,000')
  assert.equal(finished.raceRecords[0].jockeyId, draft.jockeyId)
  const lifecycle = applyCareer<{ activeHorse: { id: string; name: string; age: string; sex: string; growth: string; growthNote: string; stats: [string, number][]; aptitude: [string, string, string][]; record: string; best: string; prize: string } | null; month: number }>({ activeHorse: null, month: 3 }, finished)
  assert.equal(lifecycle.activeHorse!.record, summarizeRecords(finished.raceRecords).record)
  assert.equal(lifecycle.activeHorse!.prize, finished.prize)
  assert.equal(lifecycle.activeHorse!.best, summarizeRecords(finished.raceRecords).best)
  assert.equal(applyRaceResult(finished, runId, 1, 9999), finished)
  writeCareer(finished)
  const restored = readCareer()!
  assert.equal(applyRaceResult(restored, runId, 2, 3000000).raceRecords.length, 1)
  assert.throws(() => applyRaceResult(locked, 'different-run', 2, 3000000))
})
test('entry rejects jockeys absent from persisted contract IDs', () => {
  assert.throws(() => lockRaceEntry({ ...month3(), contractedJockeyIds: [] }, draft))
})
test('riding fit is deterministic and depends on race, horse and tactic', () => {
  const state = month3()
  const fit = ridingFit(state, raceDefinitions[1], contractedJockeys[0], '선행')
  assert.deepEqual(fit, ridingFit(state, raceDefinitions[1], contractedJockeys[0], '선행'))
  assert.notDeepEqual(fit, ridingFit(state, raceDefinitions[2], contractedJockeys[0], '추입'))
})
