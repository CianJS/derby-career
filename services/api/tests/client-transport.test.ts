import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, DerbyApiError } from '../../../packages/shared/src/client'

test('shared client preserves paths, query serialization and public request isolation', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  let tokenReads = 0
  const client = createApiClient({
    baseUrl: 'https://api.example.test/',
    getSessionToken: () => {
      tokenReads++
      return 'test-session'
    },
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return Response.json({ data: [] })
    },
  })
  await client.listEvents({ enabled: false, page: 1, pageSize: undefined })
  await client.getEvent('COM/0001 ?')
  assert.equal(tokenReads, 0)
  assert.equal(calls[0].url, 'https://api.example.test/v1/events?enabled=false&page=1')
  assert.equal(calls[1].url, 'https://api.example.test/v1/events/COM%2F0001%20%3F')
  for (const { init } of calls) {
    assert.equal(init?.method, 'GET')
    assert.equal(init?.body, undefined)
    assert.deepEqual(init?.headers, { Accept: 'application/json' })
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.cache, 'no-store')
  }
})

test('private requests read the current token each time and keep retry bodies identical', async () => {
  const calls: RequestInit[] = []
  const tokens = ['first-session', 'refreshed-session', undefined]
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    getSessionToken: async () => tokens.shift(),
    fetch: async (_input, init) => {
      calls.push(init!)
      return Response.json({})
    },
  })
  const body = { actionId: 'same-action-id', choice: 'rest' as const, expectedTurn: 2 }
  await client.confirmAction('career/id', body)
  await client.confirmAction('career/id', body)
  await client.getCareer('career/id')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].body, JSON.stringify(body))
  assert.equal(calls[1].body, calls[0].body)
  assert.deepEqual(
    calls.map((call) => new Headers(call.headers).get('authorization')),
    ['Bearer first-session', 'Bearer refreshed-session', null],
  )
})

test('typed API errors retain codes and request IDs; malformed success JSON stays invalid', async () => {
  const responses = [
    Response.json(
      { error: { code: 'STALE_TURN', message: '변경된 월', requestId: 'request-id' } },
      { status: 409 },
    ),
    new Response('invalid JSON', { status: 200 }),
    Response.json({ error: null }, { status: 503 }),
  ]
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetch: async () => responses.shift()!,
  })
  await assert.rejects(client.listHorses(), (error: unknown) => {
    assert.ok(error instanceof DerbyApiError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'STALE_TURN')
    assert.equal(error.message, '변경된 월')
    assert.equal(error.requestId, 'request-id')
    return true
  })
  await assert.rejects(client.listHorses(), (error: unknown) => {
    assert.ok(error instanceof DerbyApiError)
    assert.equal(error.status, 502)
    assert.equal(error.code, 'INVALID_RESPONSE')
    return true
  })
  await assert.rejects(client.listHorses(), (error: unknown) => {
    assert.ok(error instanceof DerbyApiError)
    assert.equal(error.status, 503)
    assert.equal(error.code, 'HTTP_ERROR')
    return true
  })
})

test('network and response body failures keep their original error identity', async () => {
  const networkError = new TypeError('network unavailable')
  const bodyError = new Error('body unavailable')
  const networkClient = createApiClient({
    baseUrl: 'https://api.example.test',
    fetch: async () => {
      throw networkError
    },
  })
  await assert.rejects(networkClient.listHorses(), (error) => error === networkError)
  const response = Response.json({})
  response.json = async () => {
    throw bodyError
  }
  const bodyClient = createApiClient({
    baseUrl: 'https://api.example.test',
    fetch: async () => response,
  })
  await assert.rejects(bodyClient.listHorses(), (error) => error === bodyError)
})

test('expedition history is an authenticated read with encoded Career identity and page query', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const client = createApiClient({
    baseUrl: 'https://api.example.test/',
    getSessionToken: () => 'history-session',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return Response.json({ data: [], page: 2, pageSize: 1 })
    },
  })
  const response = await client.getExpeditionHistory('career/id ?', { page: 2, pageSize: 1 })
  assert.deepEqual(response, { data: [], page: 2, pageSize: 1 })
  assert.equal(
    calls[0].url,
    'https://api.example.test/v1/careers/career%2Fid%20%3F/expeditions/history?page=2&pageSize=1',
  )
  assert.equal(calls[0].init?.method, 'GET')
  assert.equal(calls[0].init?.body, undefined)
  assert.equal(calls[0].init?.cache, 'no-store')
  assert.equal(calls[0].init?.credentials, 'omit')
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer history-session')
})

test('reference entry query preserves an encoded source identity without changing entry commands', async () => {
  const urls: string[] = []
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    getSessionToken: () => 'session',
    fetch: async (url) => {
      urls.push(String(url))
      return Response.json({})
    },
  })
  await client.getRaceEntryOptions('career/id', { referenceRaceId: 'RACE_A' })
  assert.equal(
    urls[0],
    'https://api.example.test/v1/careers/career%2Fid/race-entries?referenceRaceId=RACE_A',
  )
})
