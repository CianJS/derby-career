import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { handleServerSave, serverSaveEnabled } from '../lib/server-save/bridge'
import { ServerSaveController } from '../lib/server-save/controller'
import { createApiClient } from '../packages/shared/src/client'

const env = {
  NODE_ENV: 'development',
  DERBY_SAVE_MODE: 'server',
  DERBY_SERVER_SAVE_LOCAL: '1',
  DERBY_API_URL: 'http://127.0.0.1:4000',
  DERBY_API_DEV_SESSION_TOKEN: 'x'.repeat(43),
}
const command = { careerId: randomUUID(), horseDefinitionId: 'DEV_HORSE_SERENE_STEP' }
const post = (origin = 'http://127.0.0.1:3000', path = '/v1/careers', body: unknown = command) =>
  new Request('http://127.0.0.1:3000/api/server-save' + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

test('server-save bridge is opt-in, loopback-only and always disabled in production', async () => {
  let requests = 0
  const upstream: typeof fetch = async () => {
    requests++
    throw new Error('must not fetch')
  }
  assert.equal(serverSaveEnabled({ ...env, NODE_ENV: 'production' }), false)
  assert.equal(
    (await handleServerSave(post(), { ...env, NODE_ENV: 'production' }, upstream)).status,
    404,
  )
  assert.equal(
    (await handleServerSave(post(), { ...env, DERBY_SERVER_SAVE_LOCAL: undefined }, upstream))
      .status,
    404,
  )
  assert.equal(
    (await handleServerSave(post(), { ...env, DERBY_API_URL: 'https://remote.example' }, upstream))
      .status,
    502,
  )
  assert.equal(
    (
      await handleServerSave(
        new Request('http://remote.example/api/server-save/v1/careers/workspace'),
        env,
        upstream,
      )
    ).status,
    403,
  )
  assert.equal(requests, 0)
})

test('bridge rejects cross-origin, missing-origin, unknown paths and malformed commands before forwarding', async () => {
  let requests = 0
  const upstream: typeof fetch = async () => {
    requests++
    throw new Error('must not fetch')
  }
  assert.equal((await handleServerSave(post('https://other.example'), env, upstream)).status, 403)
  assert.equal(
    (
      await handleServerSave(
        new Request(post(), { headers: { 'Content-Type': 'application/json' } }),
        env,
        upstream,
      )
    ).status,
    403,
  )
  assert.equal(
    (
      await handleServerSave(
        post(undefined, '/v1/careers', { ...command, state: {} }),
        env,
        upstream,
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await handleServerSave(
        post(undefined, '/v1/careers', { ...command, careerId: 'invalid' }),
        env,
        upstream,
      )
    ).status,
    400,
  )
  assert.equal(
    (await handleServerSave(post(undefined, '/v1/session/revoke'), env, upstream)).status,
    400,
  )
  assert.equal(
    (
      await handleServerSave(
        new Request('http://127.0.0.1:3000/api/server-save/v1/careers/workspace?token=leak'),
        env,
        upstream,
      )
    ).status,
    400,
  )
  assert.equal(requests, 0)
})

test('bridge sends only server credential and sanitizes errors, redirects and invalid success bodies', async () => {
  const request = post()
  request.headers.set('Authorization', 'Bearer browser-token')
  request.headers.set('Cookie', 'browser-save=private')
  const response = await handleServerSave(request, env, async (_input, init) => {
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('Authorization'), 'Bearer ' + env.DERBY_API_DEV_SESSION_TOKEN)
    assert.equal(headers.get('Cookie'), null)
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'manual')
    assert.ok(init?.signal)
    return Response.json(
      { error: { code: 'CONFLICT', message: env.DERBY_API_DEV_SESSION_TOKEN } },
      { status: 409 },
    )
  })
  assert.equal(response.status, 409)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal((await response.text()).includes(env.DERBY_API_DEV_SESSION_TOKEN), false)
  assert.equal(
    (
      await handleServerSave(
        post(),
        env,
        async () =>
          new Response(null, { status: 302, headers: { Location: 'https://other.example' } }),
      )
    ).status,
    502,
  )
  assert.equal(
    (
      await handleServerSave(post(), env, async () =>
        Response.json({ token: env.DERBY_API_DEV_SESSION_TOKEN }),
      )
    ).status,
    502,
  )
})

test('normalized Next loopback URL accepts the actual local Host origin and rejects remote or forwarded hosts', async () => {
  let forwarded = 0
  const upstream: typeof fetch = async () => {
    forwarded++
    return Response.json({ error: { message: 'conflict' } }, { status: 409 })
  }
  const normalized = () =>
    new Request('http://localhost:3000/api/server-save/v1/careers', {
      method: 'POST',
      headers: {
        Host: '127.0.0.1:3000',
        Origin: 'http://127.0.0.1:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    })
  assert.equal((await handleServerSave(normalized(), env, upstream)).status, 409)
  const remote = normalized()
  remote.headers.set('Host', 'remote.example:3000')
  remote.headers.set('X-Forwarded-Host', '127.0.0.1:3000')
  assert.equal((await handleServerSave(remote, env, upstream)).status, 403)
  assert.equal(forwarded, 1)
})

test('unreadable journal and quota failure block writes without contacting API or deleting the journal', async () => {
  let requests = 0
  let cleared = false
  const api = createApiClient({
    baseUrl: 'http://api',
    fetch: async () => {
      requests++
      throw new Error('must not fetch')
    },
  })
  const broken = new ServerSaveController(
    api,
    {
      read: () => '{',
      write: () => {},
      clear: () => {
        cleared = true
      },
    },
    () => {},
  )
  assert.equal(await broken.refresh(), false)
  const unavailable = new ServerSaveController(
    api,
    {
      read: () => {
        throw new Error('Storage unavailable')
      },
      write: () => {},
      clear: () => {
        cleared = true
      },
    },
    () => {},
  )
  assert.equal(await unavailable.refresh(), false)
  const full = new ServerSaveController(
    api,
    {
      read: () => null,
      write: () => {
        throw new Error('Quota exceeded')
      },
      clear: () => {
        cleared = true
      },
    },
    () => {},
  )
  assert.equal(await full.send({ kind: 'create', body: command }), false)
  assert.equal(requests, 0)
  assert.equal(cleared, false)
})

test('private trust read bridge validates current and retired identities and never accepts trust uploads', async () => {
  const careerId = randomUUID()
  const path = `/v1/careers/${careerId}/jockey-relations`
  const url = 'http://127.0.0.1:3000/api/server-save' + path
  const body = {
    careerId,
    ownedHorseId: randomUUID(),
    revision: 2,
    status: 'retired',
    data: [{ jockeyId: 'SEO_JIAN', starts: 2, trust: 30 }],
  }
  let forwarded = 0
  const upstream: typeof fetch = async (_input, options) => {
    forwarded++
    assert.equal(
      new Headers(options?.headers).get('authorization'),
      'Bearer ' + env.DERBY_API_DEV_SESSION_TOKEN,
    )
    return Response.json(body)
  }
  const reply = await handleServerSave(new Request(url), env, upstream)
  assert.equal(reply.status, 200)
  assert.deepEqual(await reply.json(), body)
  assert.equal(reply.headers.get('cache-control'), 'no-store')
  assert.equal((await handleServerSave(new Request(url + '?trust=100'), env, upstream)).status, 400)
  assert.equal(
    (await handleServerSave(post(undefined, path, { trust: 100 }), env, upstream)).status,
    400,
  )
  assert.equal(forwarded, 1)
  const malformed: typeof fetch = async () =>
    Response.json({ ...body, data: [{ jockeyId: 'SEO_JIAN', starts: 2, trust: 101 }] })
  assert.equal((await handleServerSave(new Request(url), env, malformed)).status, 502)
})

test('history bridge allows only bounded single page queries, validates every envelope and keeps errors private', async () => {
  const id = randomUUID()
  let calls = 0
  const request = (path: string, query = '') =>
    new Request(`http://localhost:3000/api/server-save/v1/careers/${id}/${path}${query}`, {
      headers: { Authorization: 'Bearer browser-secret', Cookie: 'private=1' },
    })
  const invalid: typeof fetch = async (_target, options) => {
    calls += 1
    assert.equal(options?.method, 'GET')
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('Authorization'), `Bearer ${env.DERBY_API_DEV_SESSION_TOKEN}`)
    assert.equal(headers.get('Cookie'), null)
    assert.equal(options?.credentials, 'omit')
    return Response.json({ token: env.DERBY_API_DEV_SESSION_TOKEN })
  }
  for (const path of ['actions', 'events', 'records', 'expeditions/history']) {
    for (const query of [
      '?page=0',
      '?page=100001',
      '?pageSize=101',
      '?page=1&page=2',
      '?pageSize=2&pageSize=3',
      '?token=leak',
    ]) {
      assert.equal((await handleServerSave(request(path, query), env, invalid)).status, 400)
    }
    assert.equal(
      (
        await handleServerSave(request(path), env, async () =>
          Response.json({
            data: [],
            page: 1,
            pageSize: 20,
            token: env.DERBY_API_DEV_SESSION_TOKEN,
          }),
        )
      ).status,
      502,
    )
    const previous = calls
    assert.equal(
      (await handleServerSave(request(path, '?page=2&pageSize=20'), env, invalid)).status,
      502,
    )
    assert.equal(calls, previous + 1)
    const response = await handleServerSave(request(path), env, async () =>
      Response.json({ error: { message: env.DERBY_API_DEV_SESSION_TOKEN } }, { status: 401 }),
    )
    assert.equal(response.status, 401)
    assert.equal((await response.text()).includes(env.DERBY_API_DEV_SESSION_TOKEN), false)
    assert.equal(
      (
        await handleServerSave(request(path, '?page=1&pageSize=20'), env, async () =>
          Response.json({ data: [], page: 2, pageSize: 20 }),
        )
      ).status,
      502,
    )
  }
  assert.equal((await handleServerSave(request('retirement', '?page=1'), env, invalid)).status, 400)
  assert.equal((await handleServerSave(request('retirement'), env, invalid)).status, 502)
})
