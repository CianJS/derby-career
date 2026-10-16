import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { jockeyTrust, raceEntryJockeyTrust } from '../lib/career/jockey-trust-presentation'
import { JockeyTrustValue } from '../components/career/jockey-trust'
import { startCareer } from '../lib/career/model'
import { contractedJockeys } from '../lib/career/race-entry'
import { parseSaveWorkspace } from '../lib/server-save/workspace'
import { randomUUID } from 'node:crypto'
import type { components } from '../packages/shared/src/generated/api'

function source(): Parameters<typeof jockeyTrust>[0] {
  const state = startCareer('DEV_HORSE_SERENE_STEP')
  state.jockeyTrust = Object.fromEntries(
    contractedJockeys.map((j, i) => [j.id, { starts: i, trust: [0, 72, 100][i] }]),
  )
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
  assert.deepEqual(jockeyTrust({ ...saved, raceOptions: null }, id), {
    status: 'available',
    value: 0,
  })
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
  assert.deepEqual(jockeyTrust({ ...saved, mode: 'local' }, id), { status: 'available', value: 72 })
  assert.deepEqual(
    jockeyTrust({ ...saved, mode: 'local', career: startCareer('DEV_HORSE_RED_COMET') }, id),
    { status: 'available', value: 0 },
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

test('confirmed race/event changes display growth, decline and explicit zero without writes or guessed missing history', async () => {
  const { TrustChangeValue, EventTrustChanges } = await import('../components/career/jockey-trust')
  const { trustFixture } = await import('./helpers/trust-fixture')
  const { applyTrustEvent } = await import('../lib/career/jockey-trust')
  for (const kind of ['growth', 'decline', 'zero'] as const) {
    const fixture = trustFixture(kind)
    const before = JSON.stringify(fixture)
    const html = renderToStaticMarkup(createElement(TrustChangeValue, { change: fixture.change }))
    assert.match(
      html,
      kind === 'zero'
        ? /신뢰도 변화 없음/
        : new RegExp(`신뢰도 ${fixture.change.before} → ${fixture.change.after}`),
    )
    assert.equal(JSON.stringify(fixture), before)
  }
  assert.match(renderToStaticMarkup(createElement(TrustChangeValue)), /변화 정보 없음/)
  const result = applyTrustEvent(
    { ...startCareer('DEV_HORSE_RED_COMET'), jockeyTrust: { SEO_JIAN: { starts: 1, trust: 72 } } },
    { jockeyId: 'SEO_JIAN', amount: -8 },
  )
  const saved = JSON.stringify(result)
  for (let entry = 0; entry < 2; entry++) {
    const html = renderToStaticMarkup(
      createElement(EventTrustChanges, { changes: [result.change] }),
    )
    assert.match(html, /서지안/)
    assert.match(html, /72 → 64/)
    assert.match(html, /-8/)
  }
  assert.equal(JSON.stringify(result), saved)
  assert.equal(renderToStaticMarkup(createElement(EventTrustChanges)), '')
})

test('relation endpoint validates identity, owner-scoped errors, revision, status and duplicate IDs', async () => {
  const { readServerRelations } = await import('../lib/career/jockey-trust-presentation')
  const { createApiClient } = await import('../packages/shared/src/client')
  const identity = {
    careerId: randomUUID(),
    ownedHorseId: randomUUID(),
    revision: 7,
    status: 'retired' as const,
  }
  const value = { ...identity, data: [{ jockeyId: 'SEO_JIAN', starts: 2, trust: 72 }] }
  const api = (body: unknown, status = 200) =>
    createApiClient({ baseUrl: 'http://test', fetch: async () => Response.json(body, { status }) })
  assert.deepEqual(await readServerRelations(api(value), identity), {
    SEO_JIAN: { starts: 2, trust: 72 },
  })
  for (const patch of [
    { careerId: randomUUID() },
    { ownedHorseId: randomUUID() },
    { revision: 6 },
    { status: 'active' },
    { data: [...value.data, ...value.data] },
  ]) {
    await assert.rejects(readServerRelations(api({ ...value, ...patch }), identity))
  }
  for (const status of [401, 403, 404, 503]) {
    await assert.rejects(
      readServerRelations(
        api({ error: { code: 'UNAUTHORIZED', message: 'denied' } }, status),
        identity,
      ),
    )
  }
})
