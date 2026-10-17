import test from 'node:test'
import assert from 'node:assert/strict'
import { browserStorage } from './helpers/browser-storage'
import { paidCareer, paidDraft } from './helpers/economy-fixture'
import { BROWSER_SAVE_KEY, readBrowserSave, writeBrowserSave } from '../lib/career/browser-save'
import { fixtureLifecycle } from '../lib/career/fixtures'
import { applyCareer } from '../lib/career/lifecycle'
import { careerStore, stableFunds } from '../lib/career/store'
import { migrateEconomy, settleLocal, assertEconomy } from '../lib/career/local-economy'
import { writeLifecycleSave } from '../lib/career/lifecycle-repository'
import { readRaceLog } from '../lib/career/race-log-repository'
import { raceEligibility, raceDefinitions } from '../lib/career/race-entry'
import { assertLifecycleSave } from '../lib/career/lifecycle-save'

function locks() {
  let tail = Promise.resolve<unknown>(undefined)
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name: string, callback: () => unknown) => {
          const next = tail.then(callback)
          tail = next.catch(() => {})
          return next
        },
      },
    },
  })
}
async function setup(fundsKRW = 20_000_000) {
  const storage = browserStorage()
  locks()
  const career = paidCareer()
  const lifecycle = applyCareer(
    { ...fixtureLifecycle(true), fundsKRW, economyLedger: [], activeHorse: null },
    career,
  )
  writeBrowserSave({ career, lifecycle })
  careerStore.configure('local')
  await careerStore.refresh()
  return { storage, career, lifecycle }
}
test('legacy money migrates once without replaying old records; invalid amounts and damaged ledgers fail closed', () => {
  for (const funds of ['', undefined]) {
    const legacy = { funds, archive: fixtureLifecycle(true).archive }
    assertLifecycleSave(legacy)
    const next = migrateEconomy(legacy)
    assert.equal(next.fundsKRW, 20_000_000)
    assert.deepEqual(next.economyLedger, [])
    assert.strictEqual(migrateEconomy(next), next)
    assert.equal(next.archive!.length, 2)
  }
  assert.equal(migrateEconomy({ funds: '₩42,800,000' }).fundsKRW, 42_800_000)
  assert.equal(migrateEconomy({ funds: '0원' }).fundsKRW, 0)
  assert.equal(
    migrateEconomy({ funds: 'old display', fundsKRW: 123, economyLedger: [] }).fundsKRW,
    123,
  )
  for (const funds of ['-1', '₩2,00', 'NaN', '1.5', '9007199254740992']) {
    assert.throws(() => migrateEconomy({ funds }), /자금/)
  }
  for (const fundsKRW of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => assertEconomy({ fundsKRW }), /자금/)
  }
  for (const ledger of [
    [{ raceRunId: 'r', kind: 'entry_fee', amount: 1 }],
    [{ raceRunId: 'r', kind: 'prize', amount: -1 }],
    [
      { raceRunId: 'r', kind: 'prize', amount: 1 },
      { raceRunId: 'r', kind: 'prize', amount: 1 },
    ],
  ]) {
    assert.throws(() => assertEconomy({ fundsKRW: 1, economyLedger: ledger }), /원장/)
  }
  assert.throws(
    () =>
      settleLocal(
        { fundsKRW: Number.MAX_SAFE_INTEGER, economyLedger: [] },
        { raceRunId: 'r', kind: 'prize', amount: 1 },
      ),
    /자금/,
  )
})
test('paid entry and verified prize commit once with Career, trust and archive; stale metadata and new horses preserve funds', async () => {
  const { career, lifecycle } = await setup()
  assert.equal(await careerStore.lockRace(paidDraft, career.horse.id, career.month), true)
  let saved = readBrowserSave()
  assert.equal(saved.lifecycle!.fundsKRW, 19_500_000)
  assert.deepEqual(saved.lifecycle!.economyLedger, [
    { raceRunId: saved.career!.raceRun!.raceRunId, kind: 'entry_fee', amount: -500_000 },
  ])
  const run = saved.career!.raceRun!
  const log = readRaceLog(run.raceRunId)!
  assert.equal(
    await careerStore.lockRace(
      { ...paidDraft, jockeyId: 'HAN_DOYUN' },
      career.horse.id,
      career.month,
    ),
    true,
  )
  assert.equal(readBrowserSave().lifecycle!.fundsKRW, 19_500_000)
  assert.equal(readBrowserSave().career!.raceRun!.raceRunId, run.raceRunId)
  writeLifecycleSave({ ...lifecycle, fundsKRW: 0, economyLedger: [] })
  assert.equal(readBrowserSave().lifecycle!.fundsKRW, 19_500_000)
  assert.equal(await careerStore.completeRace(run.raceRunId, log.result), true)
  saved = readBrowserSave()
  const funds = 19_500_000 + log.result.prizeMoney
  assert.equal(saved.lifecycle!.fundsKRW, funds)
  assert.deepEqual(saved.lifecycle!.activeHorse!.raceRecords, saved.career!.raceRecords)
  assert.deepEqual(saved.lifecycle!.activeHorse!.jockeyTrust, saved.career!.jockeyTrust)
  assert.equal(saved.lifecycle!.economyLedger!.length, 2)
  assert.equal(await careerStore.completeRace(run.raceRunId, log.result), true)
  assert.deepEqual(readBrowserSave(), saved)
  assert.equal(await careerStore.completeRace(career.raceRecords[0].raceRunId!, log.result), true)
  assert.deepEqual(readBrowserSave(), saved)
  const receipt = await careerStore.release()
  assert.ok(receipt && receipt.mode === 'local')
  assert.equal(receipt.lifecycle.fundsKRW, funds)
  assert.deepEqual(receipt.lifecycle.archive![0].jockeyTrust, saved.career!.jockeyTrust)
  assert.equal(await careerStore.select('DEV_HORSE_RED_COMET'), true)
  assert.equal(readBrowserSave().lifecycle!.fundsKRW, funds)
  assert.deepEqual(readBrowserSave().lifecycle!.economyLedger, saved.lifecycle!.economyLedger)
  assert.equal(stableFunds(careerStore.getSnapshot()), funds)
})
test('entry/result storage failures roll back every economic/game field and preserve the locked log for retry', async () => {
  const { storage, career } = await setup()
  const before = storage.data.get(BROWSER_SAVE_KEY)
  storage.rejectWrites(true)
  assert.equal(await careerStore.lockRace(paidDraft, career.horse.id, career.month), false)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), before)
  storage.rejectWrites(false)
  assert.equal(await careerStore.lockRace(paidDraft, career.horse.id, career.month), true)
  const pending = storage.data.get(BROWSER_SAVE_KEY)
  const run = readBrowserSave().career!.raceRun!
  const log = readRaceLog(run.raceRunId)!
  storage.rejectWrites(true)
  assert.equal(await careerStore.completeRace(run.raceRunId, log.result), false)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), pending)
  assert.deepEqual(readRaceLog(run.raceRunId), log)
  assert.equal(careerStore.getSnapshot().lifecycle!.fundsKRW, 19_500_000)
  storage.rejectWrites(false)
  assert.equal(await careerStore.completeRace(run.raceRunId, log.result), true)
  assert.equal(readBrowserSave().lifecycle!.fundsKRW, 19_500_000 + log.result.prizeMoney)
})
test('zero balance permits free entry, rejects paid entry and stale callers cannot replace a new horse', async () => {
  const { career } = await setup(0)
  assert.match(
    raceEligibility(
      career,
      raceDefinitions.find((r) => r.id === paidDraft.raceId)!,
      0,
    )!,
    /자금/,
  )
  assert.equal(await careerStore.lockRace(paidDraft, career.horse.id, career.month), false)
  assert.equal(readBrowserSave().lifecycle!.fundsKRW, 0)
  assert.equal(
    await careerStore.lockRace(
      { ...paidDraft, raceId: 'DEV_M6_ONE_WIN_1800' },
      career.horse.id,
      career.month,
    ),
    true,
  )
  assert.equal(readBrowserSave().lifecycle!.economyLedger![0].amount, 0)
  assert.equal(readBrowserSave().lifecycle!.fundsKRW, 0)
  const prior = readBrowserSave()
  writeBrowserSave({ career: null })
  writeBrowserSave({ career })
  const otherTab = readBrowserSave()
  assert.notEqual(prior.localCareerId, otherTab.localCareerId)
  assert.equal(
    await careerStore.completeRace(
      prior.career!.raceRun!.raceRunId,
      prior.career!.raceRun!.simulation!.result,
    ),
    false,
  )
  assert.deepEqual(readBrowserSave(), otherTab)
})
test('corrupt economics remain intact and cannot be hidden by lifecycle presentation writes', async () => {
  const { storage } = await setup()
  const raw = JSON.parse(storage.data.get(BROWSER_SAVE_KEY)!)
  raw.lifecycle.fundsKRW = -20
  const damaged = JSON.stringify(raw)
  storage.data.set(BROWSER_SAVE_KEY, damaged)
  await careerStore.refresh()
  assert.match(careerStore.getSnapshot().error!, /자금/)
  assert.equal(stableFunds(careerStore.getSnapshot()), null)
  assert.throws(() => writeLifecycleSave(fixtureLifecycle(true)), /자금/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), damaged)
})

test('durable migration initializes empty legacy money once and never credits historical races or archive prizes', async () => {
  for (const [funds, expected] of [
    ['', 20_000_000],
    ['₩42,800,000', 42_800_000],
  ] as const) {
    const { storage } = await setup()
    const saved = readBrowserSave()
    delete saved.lifecycle!.fundsKRW
    delete saved.lifecycle!.economyLedger
    saved.lifecycle!.funds = funds
    storage.data.set(BROWSER_SAVE_KEY, JSON.stringify(saved))
    await careerStore.refresh()
    const migrated = readBrowserSave()
    assert.equal(migrated.lifecycle!.fundsKRW, expected)
    assert.deepEqual(migrated.lifecycle!.economyLedger, [])
    assert.deepEqual(migrated.career!.raceRecords, saved.career!.raceRecords)
    assert.deepEqual(migrated.lifecycle!.archive, saved.lifecycle!.archive)
    await careerStore.refresh()
    assert.deepEqual(readBrowserSave(), migrated)
  }
})
test('concurrent commands on one month debit once and repeated completion has one prize record', async () => {
  const { career } = await setup()
  await Promise.all([
    careerStore.lockRace(paidDraft, career.horse.id, career.month),
    careerStore.lockRace({ ...paidDraft, jockeyId: 'HAN_DOYUN' }, career.horse.id, career.month),
  ])
  const saved = readBrowserSave()
  assert.equal(saved.lifecycle!.fundsKRW, 19_500_000)
  assert.equal(saved.lifecycle!.economyLedger!.length, 1)
  const run = saved.career!.raceRun!
  const result = readRaceLog(run.raceRunId)!.result
  await Promise.all([
    careerStore.completeRace(run.raceRunId, result),
    careerStore.completeRace(run.raceRunId, result),
  ])
  assert.equal(readBrowserSave().lifecycle!.fundsKRW, 19_500_000 + result.prizeMoney)
  assert.equal(readBrowserSave().lifecycle!.economyLedger!.length, 2)
})

test('a prize beyond the stable safe-integer cap leaves the entire locked result and ledger unchanged', async () => {
  const { career } = await setup(Number.MAX_SAFE_INTEGER)
  assert.equal(await careerStore.lockRace(paidDraft, career.horse.id, career.month), true)
  const saved = readBrowserSave()
  const run = saved.career!.raceRun!
  const result = readRaceLog(run.raceRunId)!.result
  assert.ok(result.prizeMoney > run.raceDefinitionSnapshot.entryFee)
  assert.equal(await careerStore.completeRace(run.raceRunId, result), false)
  assert.deepEqual(readBrowserSave(), saved)
  assert.ok(readRaceLog(run.raceRunId))
})
