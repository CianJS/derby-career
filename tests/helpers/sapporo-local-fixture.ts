// Runs only in a disposable copied checkout with a synthetic, test-only manifest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { browserStorage } from './browser-storage'
import { paidCareer } from './economy-fixture'
import { readBrowserSave, writeBrowserSave } from '../../lib/career/browser-save'
import { fixtureLifecycle } from '../../lib/career/fixtures'
import { applyCareer } from '../../lib/career/lifecycle'
import { careerStore } from '../../lib/career/store'
import { readRaceLog } from '../../lib/career/race-log-repository'
import { localRacesForTurn, raceEligibility } from '../../lib/career/race-entry'
import { sapporoPilot } from '../../packages/shared/src/sapporo-pilot'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('test-only Sapporo manifest exercises Local entry, payment, completion and reload', async () => {
  const storage = browserStorage()
  let tail = Promise.resolve<unknown>(undefined)
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name: string, fn: () => unknown) => {
          const result = tail.then(fn)
          tail = result.catch(() => {})
          return result
        },
      },
    },
  })
  const career = { ...paidCareer(), month: 9, careerTurnIndex: 9 }
  const lifecycle = applyCareer(
    { ...fixtureLifecycle(true), fundsKRW: 20_000_000, economyLedger: [], activeHorse: null },
    career,
  )
  writeBrowserSave({ career, lifecycle })
  careerStore.configure('local')
  await careerStore.refresh()
  const race = localRacesForTurn(9).find((r) => r.id === sapporoPilot.definition.id)!
  assert.ok(race)
  const draft = { raceId: race.id, jockeyId: 'SEO_JIAN', tactic: '선입' } as const
  assert.equal(await careerStore.lockRace(draft, career.horse.id, 9), false)
  assert.equal(await careerStore.startExpedition('JPN', 0), true)
  const travel = readBrowserSave().lifecycle!.travel!
  assert.equal(raceEligibility(career, race, 750000, travel), null)
  assert.match(raceEligibility(career, race, 749999, travel)!, /자금/)
  assert.match(raceEligibility({ ...career, raceRecords: [] }, race, 750000, travel)!, /1승/)
  assert.match(
    raceEligibility(
      { ...career, month: 21, careerTurnIndex: 21 },
      { ...race, month: 21 },
      750000,
      travel,
    )!,
    /연령/,
  )
  assert.equal(await careerStore.lockRace(draft, career.horse.id, 9), true)
  const locked = readBrowserSave()
  const run = locked.career!.raceRun!
  assert.equal(run.raceDefinitionSnapshot.id, sapporoPilot.definition.id)
  assert.equal(run.opponentProfile, 'sapporo-g3-2yo-v1')
  assert.match(run.mappingRevision!, /^[a-f0-9]{64}$/)
  assert.equal(locked.lifecycle!.fundsKRW, 19_250_000)
  assert.equal(
    locked.lifecycle!.economyLedger!.filter((e) => e.kind === 'entry_fee')[0].amount,
    -750000,
  )
  await careerStore.refresh()
  assert.equal(readBrowserSave().career!.raceRun!.raceRunId, run.raceRunId)
  assert.equal(await careerStore.lockRace(draft, career.horse.id, 9), true)
  assert.equal(readBrowserSave().lifecycle!.fundsKRW, 19_250_000)
  if (process.env.SAPPORO_TEST_ALT) {
    const directory = mkdtempSync(join(tmpdir(), 'sapporo-locked-'))
    const savePath = join(directory, 'storage.json')
    const registryPath = 'packages/shared/src/approved-playable.json'
    const originalRegistry = readFileSync(registryPath, 'utf8')
    try {
      writeFileSync(savePath, JSON.stringify([...storage.data]))
      for (const disabled of [false, true]) {
        writeFileSync(registryPath, disabled ? '[]\n' : process.env.SAPPORO_TEST_ALT)
        const output = execFileSync(
          process.execPath,
          [
            '--import',
            './services/api/node_modules/tsx/dist/loader.mjs',
            '--test',
            'tests/helpers/sapporo-reload-fixture.ts',
          ],
          {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 60000,
            env: {
              ...process.env,
              NODE_TEST_CONTEXT: undefined,
              SAPPORO_TEST_SAVE: savePath,
              SAPPORO_TEST_DISABLED: disabled ? '1' : '0',
            },
          },
        )
        assert.match(output, /pass 1/)
      }
    } finally {
      writeFileSync(registryPath, originalRegistry)
      rmSync(directory, { recursive: true, force: true })
    }
  }
  const stored = storage.target.getItem('derby-career-browser-save-v1')!
  for (const tamper of [
    (value: typeof locked) => {
      value.career!.raceRun!.mappingRevision = '0'.repeat(64)
    },
    (value: typeof locked) => {
      value.career!.raceRun!.raceDefinitionSnapshot.prize += 1
    },
    (value: typeof locked) => {
      value.career!.raceRun!.opponentProfile = 'shared-development-v1'
    },
  ]) {
    const altered = JSON.parse(stored)
    tamper(altered)
    storage.target.setItem('derby-career-browser-save-v1', JSON.stringify(altered))
    assert.throws(() => readBrowserSave())
  }
  storage.target.setItem('derby-career-browser-save-v1', stored)
  const log = readRaceLog(run.raceRunId)!
  assert.equal(await careerStore.completeRace(run.raceRunId, log.result), true)
  const completed = readBrowserSave()
  assert.equal(completed.lifecycle!.fundsKRW, 19_250_000 + log.result.prizeMoney)
  assert.equal(completed.lifecycle!.economyLedger!.filter((e) => e.kind === 'prize').length, 1)
  assert.equal(await careerStore.completeRace(run.raceRunId, log.result), true)
  assert.deepEqual(readBrowserSave(), completed)
  await careerStore.refresh()
  assert.deepEqual(readBrowserSave(), completed)
})
