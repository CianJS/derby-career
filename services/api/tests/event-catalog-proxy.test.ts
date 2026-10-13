import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createEventCatalogProxy } from '../../../packages/shared/src/event-catalog-proxy'
import { fixture } from './helpers'

const request = (search = '') =>
  new Request(`http://frontend.test/api/event-catalog${search}`, {
    headers: { Cookie: 'browser-save=private', Authorization: 'Bearer browser-token' },
  })

test('public proxy reads DB pages, filters and details without forwarding browser credentials', async () => {
  const f = await fixture()
  const calls: string[] = []
  try {
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      calls.push(url.pathname + url.search)
      assert.equal(url.origin, 'http://backend.test')
      assert.equal(init?.credentials, 'omit')
      assert.equal(init?.cache, 'no-store')
      assert.equal(init?.redirect, 'error')
      assert.equal(new Headers(init?.headers).has('authorization'), false)
      assert.equal(new Headers(init?.headers).has('cookie'), false)
      assert.ok(init?.signal)
      const result = await f.app.inject({ method: 'GET', url: url.pathname + url.search })
      return new Response(result.body, {
        status: result.statusCode,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const proxy = createEventCatalogProxy({ baseUrl: 'http://backend.test/', fetch: fetcher })
    const response = await proxy.list(
      request('?category=common&enabled=true&status=ready&pageSize=20'),
    )
    const first = await response.json()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(first.pagination.total, 315)
    assert.equal(first.data.length, 20)
    const second = await proxy.list(request('?enabled=true&status=ready&page=2&pageSize=20'))
    assert.equal((await second.json()).data[0].id, 'COM-0021')
    const detail = await proxy.detail(request(), first.data[0].id)
    assert.deepEqual(await detail.json(), first.data[0])
    const deferred = await proxy.list(
      request('?status=deferred&enabled=false&sort=name&order=desc'),
    )
    const held = await deferred.json()
    assert.equal(held.pagination.total, 35)
    assert.ok(
      held.data.every(
        (event: { status: string; enabled: boolean }) =>
          event.status === 'deferred' && !event.enabled,
      ),
    )
    const empty = await proxy.list(request('?category=hidden'))
    assert.equal((await empty.json()).pagination.total, 0)
    const absent = await proxy.detail(request(), 'COM-DOES-NOT-EXIST')
    assert.equal(absent.status, 404)
    assert.equal((await absent.json()).error.message, '이벤트를 찾을 수 없습니다.')
    const encoded = await proxy.detail(request(), '../careers?ownerId=private')
    assert.equal(encoded.status, 404)
    assert.ok(calls.at(-1)?.startsWith('/v1/events/..%2Fcareers%3FownerId%3Dprivate'))
    assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM careers')).rows[0].n), 0)
  } finally {
    await f.close()
  }
})

test('invalid and duplicate query parameters are rejected before contacting the API', async () => {
  let calls = 0
  const proxy = createEventCatalogProxy({
    baseUrl: 'http://backend.test',
    fetch: async () => {
      calls++
      throw new Error('must not fetch')
    },
  })
  for (const search of [
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?page=100001',
    '?pageSize=101',
    '?pageSize=',
    '?enabled=yes',
    '?category=unknown',
    '?status=unknown',
    '?sort=weight',
    '?order=down',
    '?page=1&page=2',
    '?url=http://untrusted.test',
    '?kind=focus',
  ]) {
    const result = await proxy.list(request(search))
    assert.equal(result.status, 400, search)
    assert.equal((await result.json()).error.code, 'INVALID_QUERY')
  }
  assert.equal((await proxy.detail(request(), ' ')).status, 400)
  assert.equal((await proxy.detail(request(), 'a'.repeat(101))).status, 400)
  assert.equal(calls, 0)
})

test('missing or invalid server configuration is explicit and does not use fixture data', async () => {
  let calls = 0
  for (const baseUrl of [
    undefined,
    '',
    'invalid',
    'file:///etc/passwd',
    'http://user:secret@backend.test',
    'http://backend.test?token=secret',
  ]) {
    const proxy = createEventCatalogProxy({
      baseUrl,
      fetch: async () => {
        calls++
        throw new Error('must not fetch')
      },
    })
    const result = await proxy.list(request())
    assert.equal(result.status, 503)
    const body = await result.json()
    assert.equal(body.error.code, 'API_NOT_CONFIGURED')
    assert.equal(JSON.stringify(body).includes('secret'), false)
  }
  assert.equal(calls, 0)
})

test('network, invalid JSON, redirects and upstream server errors have safe retryable responses', async () => {
  const brokenFetchers: (typeof fetch)[] = [
    async () => {
      throw new Error('postgresql://private:secret@db.internal')
    },
    async () => new Response('<html>private upstream error</html>', { status: 200 }),
    async () => new Response('<html>private upstream error</html>', { status: 502 }),
    async () =>
      Response.json(
        { error: { code: 'INTERNAL', message: 'secret DB connection' } },
        { status: 500 },
      ),
  ]
  for (const fetcher of brokenFetchers) {
    const result = await createEventCatalogProxy({
      baseUrl: 'http://backend.test',
      fetch: fetcher,
    }).list(request())
    assert.equal(result.status, 502)
    const body = await result.json()
    assert.equal(body.error.code, 'CATALOG_UNAVAILABLE')
    assert.equal(JSON.stringify(body).includes('secret'), false)
    assert.equal(JSON.stringify(body).includes('private'), false)
  }
  const throttled = await createEventCatalogProxy({
    baseUrl: 'http://backend.test',
    fetch: async () =>
      Response.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        { status: 429 },
      ),
  }).list(request())
  assert.equal(throttled.status, 429)
  assert.match((await throttled.json()).error.message, /잠시 후/)
})

test('upstream timeout covers the response body and redirects cannot select a different service', async () => {
  const server = createServer((req, res) => {
    if (req.url?.includes('page=2')) {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/private' })
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"data":')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    const proxy = createEventCatalogProxy({
      baseUrl: `http://127.0.0.1:${address.port}`,
      timeoutMs: 100,
    })
    const delayed = await proxy.list(request())
    assert.equal(delayed.status, 504)
    assert.equal((await delayed.json()).error.code, 'CATALOG_TIMEOUT')
    const redirect = await proxy.list(request('?page=2'))
    assert.equal(redirect.status, 502)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
