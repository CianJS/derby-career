import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RaceEntryForm } from '../components/career/race-entry-workspace'
import { createRaceDataAdapter } from '../lib/career/race-data-adapter'

import { lockRaceEntry } from '../lib/career/race-entry'
import { recommendRaceEntry } from '../lib/career/race-entry-recommendation'
import { simulateRace, summarizeRaceLog } from '../lib/career/race-simulation'
import { createApiClient } from '../packages/shared/src/client'
import { handleServerSave } from '../lib/server-save/bridge'

function fixture(version: 'race-sim-v1' | 'race-sim-v2' | 'race-sim-v3' | 'race-sim-v4') {
  const initial = { ...startCareer('DEV_HORSE_SERENE_STEP'), month: 3, careerTurnIndex: 3 }
  const career = lockRaceEntry(initial, recommendRaceEntry(initial))
  const log = simulateRace(career.raceRun!, version)
  career.raceRun = { ...career.raceRun!, simulation: summarizeRaceLog(log) }
  return { career, log }
}

for (const version of ['race-sim-v1', 'race-sim-v2', 'race-sim-v3', 'race-sim-v4'] as const) {
  test(`local adapter preserves persisted ${version} without server requests`, async () => {
    const { career, log } = fixture(version)
    const api = createApiClient({
      baseUrl: '',
      fetch: async () => {
        throw new Error('must not fetch')
      },
    })
    const data = await createRaceDataAdapter('local', api, () => log).load(career)
    assert.equal(data.log, log)
    assert.equal(data.run, career.raceRun)
  })
}
for (const version of ['race-sim-v1', 'race-sim-v2', 'race-sim-v3', 'race-sim-v4'] as const) {
  test(`server adapter reads ${version} with GET only and never touches local storage`, async () => {
    const { career, log } = fixture(version)
    const calls: string[] = []
    const api = createApiClient({
      baseUrl: '/api/server-save',
      fetch: async (input, options) => {
        assert.equal(options?.method, 'GET')
        calls.push(String(input))
        return Response.json(
          String(input).endsWith('/log')
            ? { log }
            : {
                raceRun: Object.fromEntries(Object.entries(career.raceRun!).reverse()),
                healthAtEntry: '정상',
                metadata: {
                  engineVersion: version,
                  digest: career.raceRun!.simulation!.digest,
                  durationMs: log.durationMs,
                  byteLength: JSON.stringify(log).length,
                  storageVersion: 1,
                },
              },
        )
      },
    })
    const adapter = createRaceDataAdapter('server', api, () => {
      throw new Error('must not read local')
    })
    const data = await adapter.load(career, 'server-career')
    // The server returns persisted JSON, where a rounded -0 is represented as 0.
    assert.equal(JSON.stringify(data.log), JSON.stringify(log))
    assert.equal(calls.length, 2)
    await assert.rejects(adapter.load(career), /서버 육성/)
  })
}

test('server failure retries the same read paths; corrupt logs and changed locked input fail closed', async () => {
  const { career, log } = fixture('race-sim-v2')
  let fail = true
  let corrupt = false
  let changed = false
  const paths: string[] = []
  const api = createApiClient({
    baseUrl: '',
    fetch: async (input) => {
      paths.push(String(input))
      if (fail) {
        throw new Error('offline')
      }
      if (String(input).endsWith('/log')) {
        return Response.json({ log: { ...log, durationMs: log.durationMs + Number(corrupt) } })
      }
      return Response.json({
        raceRun: { ...career.raceRun, raceSeed: changed ? 'different' : career.raceRun!.raceSeed },
        healthAtEntry: '정상',
        metadata: {
          engineVersion: 'race-sim-v2',
          digest: career.raceRun!.simulation!.digest,
          durationMs: log.durationMs,
          byteLength: JSON.stringify(log).length,
          storageVersion: 1,
        },
      })
    },
  })
  const adapter = createRaceDataAdapter('server', api, () => {
    throw new Error('fallback forbidden')
  })
  await assert.rejects(adapter.load(career, 'id'), /offline/)
  fail = false
  await adapter.load(career, 'id')
  assert.equal(paths[0], paths[1])
  corrupt = true
  await assert.rejects(adapter.load(career, 'id'), /손상/)
  corrupt = false
  changed = true
  await assert.rejects(adapter.load(career, 'id'), /변경/)
})

test('server entry form shows locked selections while new entry cannot be confirmed', () => {
  const { career } = fixture('race-sim-v2')
  const markup = renderToStaticMarkup(
    createElement(RaceEntryForm, { career, busy: false, error: null, canConfirm: false }),
  )
  assert.match(markup, /출전 정보 저장 완료/)
  assert.match(markup, /disabled=""/)
  const unlocked = { ...career, raceRun: undefined }
  const draft = renderToStaticMarkup(
    createElement(RaceEntryForm, { career: unlocked, busy: false, error: null, canConfirm: false }),
  )
  assert.match(draft, /disabled=""/)
})

test('race bridge rejects malformed completion commands and read query parameters', async () => {
  const env = {
    NODE_ENV: 'development',
    DERBY_SAVE_MODE: 'server',
    DERBY_SERVER_SAVE_LOCAL: '1',
    DERBY_API_DEV_SESSION_TOKEN: 'x'.repeat(43),
  }
  const path =
    '/v1/careers/11111111-1111-4111-8111-111111111111/race-runs/22222222-2222-4222-8222-222222222222'
  const request = (suffix: string, method = 'GET') =>
    new Request('http://localhost:3000/api/server-save' + path + suffix, {
      method,
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    })
  let calls = 0
  const upstream: typeof fetch = async (_input, options) => {
    calls++
    assert.equal(
      options?.headers && (options.headers as Record<string, string>).Authorization,
      'Bearer ' + 'x'.repeat(43),
    )
    return Response.json({ log: {} })
  }
  assert.equal((await handleServerSave(request('/log'), env, upstream)).status, 502)
  assert.equal(calls, 1)
  assert.equal((await handleServerSave(request('/complete', 'POST'), env, upstream)).status, 400)
  assert.equal((await handleServerSave(request('/log?page=1'), env, upstream)).status, 400)
  assert.equal(calls, 1)
})
