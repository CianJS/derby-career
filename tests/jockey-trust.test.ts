import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { jockeyTrust, raceEntryJockeyTrust } from '../lib/career/jockey-trust'
import { JockeyTrustValue } from '../components/career/jockey-trust'
import { startCareer } from '../lib/career/model'
import { contractedJockeys } from '../lib/career/race-entry'
import { parseSaveWorkspace } from '../lib/server-save/workspace'
import { randomUUID } from 'node:crypto'
import type { components } from '../packages/shared/src/generated/api'

function source(): Parameters<typeof jockeyTrust>[0] {
  const state = startCareer('DEV_HORSE_SERENE_STEP')
  const career = {
    id: randomUUID(),
    stableId: randomUUID(),
    ownedHorseId: randomUUID(),
    horseDefinitionId: state.horse.id,
    status: 'active' as const,
    revision: 1,
    authority: 'server' as const,
    funds: 100,
    state,
    event: null,
  }
  const workspace = parseSaveWorkspace({
    stable: { id: career.stableId, funds: 100, calendarDate: state.calendarDate },
    career,
    confirmedActionId: null,
    retirements: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  })
  return {
    mode: 'server',
    ready: true,
    busy: false,
    pending: false,
    error: null,
    career: workspace.career!.state,
    workspace,
    raceOptions: {
      career: workspace.career!,
      defaultEngineVersion: 'race-sim-v3',
      restrictionReason: null,
      races: [],
      jockeys: contractedJockeys.map((j, i) => ({ ...j, chemistry: [0, 72, 100][i] })),
      tactics: ['도주', '선행', '선입', '추입'],
    },
  }
}

test('current owner-scoped relationship values include real zero, differ by jockey and never mutate source', () => {
  const saved = source()
  const before = JSON.stringify(saved)
  for (const [index, value] of [0, 72, 100].entries()) {
    const trust = jockeyTrust(saved, contractedJockeys[index].id)
    assert.deepEqual(trust, { status: 'available', value })
    assert.match(
      renderToStaticMarkup(createElement(JockeyTrustValue, { trust })),
      new RegExp(`${value} / 100`),
    )
  }
  assert.deepEqual(jockeyTrust(saved, 'unqueried'), { status: 'unavailable' })
  assert.equal(JSON.stringify(saved), before)
})

test('loading, uncertain command, read failure and absent data never become zero or retain an old value', () => {
  const saved = source()
  const id = contractedJockeys[0].id
  for (const patch of [{ ready: false }, { busy: true }, { pending: true }]) {
    assert.deepEqual(jockeyTrust({ ...saved, ...patch }, id), { status: 'loading' })
  }
  assert.deepEqual(jockeyTrust({ ...saved, error: 'offline' }, id), { status: 'error' })
  assert.deepEqual(jockeyTrust({ ...saved, raceOptions: null }, id), { status: 'unavailable' })
  assert.deepEqual(jockeyTrust({ ...saved, career: null }, id), { status: 'no-horse' })
  for (const status of ['loading', 'error', 'unavailable', 'no-horse'] as const) {
    const html = renderToStaticMarkup(createElement(JockeyTrustValue, { trust: { status } }))
    assert.doesNotMatch(html, /0 \/ 100/)
  }
})

test('Career/revision changes, local mode and fresh local horses cannot reuse server or frozen entry chemistry', () => {
  const saved = source()
  const id = contractedJockeys[1].id
  const options = saved.raceOptions!
  for (const career of [
    { ...options.career, id: 'career-b' },
    { ...options.career, ownedHorseId: 'horse-b' },
    { ...options.career, revision: 2 },
  ]) {
    assert.deepEqual(jockeyTrust({ ...saved, raceOptions: { ...options, career } }, id), {
      status: 'unavailable',
    })
  }
  assert.deepEqual(jockeyTrust({ ...saved, mode: 'local' }, id), { status: 'unavailable' })
  assert.deepEqual(
    jockeyTrust({ ...saved, mode: 'local', career: startCareer('DEV_HORSE_RED_COMET') }, id),
    { status: 'unavailable' },
  )
  assert.deepEqual(jockeyTrust({ ...saved, career: { ...saved.career! } }, id), {
    status: 'unavailable',
  })
})

test('entry display uses only provided server relationships and rejects missing or out-of-range values without clamping', () => {
  const options = source().raceOptions!
  const id = contractedJockeys[0].id
  assert.deepEqual(raceEntryJockeyTrust(undefined, id), { status: 'unavailable' })
  for (const value of [-1, 101, NaN, 0.5]) {
    const invalid: components['schemas']['RaceEntryOptions'] = {
      ...options,
      jockeys: [{ ...options.jockeys[0], chemistry: value }],
    }
    assert.deepEqual(raceEntryJockeyTrust(invalid, id), { status: 'unavailable' })
  }
})
