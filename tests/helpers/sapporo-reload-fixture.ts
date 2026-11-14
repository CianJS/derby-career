// Runs only in the disposable test copy, in a fresh process for each release state.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { browserStorage } from './browser-storage'
import { readBrowserSave, writeBrowserSave } from '../../lib/career/browser-save'
import { careerStore } from '../../lib/career/store'
import { readRaceLog } from '../../lib/career/race-log-repository'
import { localRacesForTurn } from '../../lib/career/race-entry'
import { paidCareer } from './economy-fixture'
import { fixtureLifecycle } from '../../lib/career/fixtures'
import { applyCareer } from '../../lib/career/lifecycle'

test('historical Sapporo locked run survives a new release', async () => {
  const storage = browserStorage()
  const saved = JSON.parse(readFileSync(process.env.SAPPORO_TEST_SAVE!, 'utf8')) as [
    string,
    string,
  ][]
  for (const [key, value] of saved) {
    storage.target.setItem(key, value)
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request: (_name: string, fn: () => unknown) => Promise.resolve().then(fn) } },
  })
  const active = localRacesForTurn(9).find((race) => race.id === 'JPN_SAPPORO_NISAI_G3')
  if (process.env.SAPPORO_TEST_DISABLED === '1') {
    assert.equal(active, undefined)
  } else {
    assert.equal(active?.entryFee, 800000)
  }
  const locked = readBrowserSave()
  const run = locked.career!.raceRun!
  assert.equal(run.raceDefinitionSnapshot.entryFee, 750000)
  assert.equal(run.raceDefinitionSnapshot.prize, 65000000)
  const log = readRaceLog(run.raceRunId)!
  careerStore.configure('local')
  await careerStore.refresh()
  assert.equal(await careerStore.completeRace(run.raceRunId, log.result), true)
  const result = readBrowserSave()
  assert.equal(result.lifecycle!.fundsKRW, 19250000 + log.result.prizeMoney)
  assert.equal(result.lifecycle!.economyLedger!.filter((entry) => entry.kind === 'prize').length, 1)
  assert.equal(await careerStore.completeRace(run.raceRunId, log.result), true)
  assert.deepEqual(readBrowserSave(), result)
  if (active) {
    storage.target.clear()
    const career = { ...paidCareer(), month: 9, careerTurnIndex: 9 }
    const lifecycle = applyCareer(
      { ...fixtureLifecycle(true), fundsKRW: 20000000, economyLedger: [], activeHorse: null },
      career,
    )
    writeBrowserSave({ career, lifecycle })
    await careerStore.refresh()
    assert.equal(await careerStore.startExpedition('JPN', 0), true)
    assert.equal(
      await careerStore.lockRace(
        { raceId: active.id, jockeyId: 'SEO_JIAN', tactic: '선입' },
        career.horse.id,
        9,
      ),
      true,
    )
    const next = readBrowserSave()
    assert.equal(next.career!.raceRun!.raceDefinitionSnapshot.entryFee, 800000)
    assert.equal(next.career!.raceRun!.raceDefinitionSnapshot.prize, 66000000)
    assert.notEqual(next.career!.raceRun!.mappingRevision, run.mappingRevision)
    assert.equal(next.lifecycle!.fundsKRW, 19200000)
  }
})
