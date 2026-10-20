import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { SignJWT, UnsecuredJWT } from 'jose'
import { createApp } from '../src/app'
import { readConfig } from '../src/config'
import type { Database } from '../src/db'
import { fixture } from './helpers'
import { oidcConfig, testIssuer, OIDC_TEST_ISSUER, OIDC_TEST_AUDIENCE } from './oidc-helpers'

const noDatabase: Database = {
  query: async () => {
    throw new Error('Invalid credentials must not query the DB')
  },
  transaction: async () => {
    throw new Error('Invalid credentials must not start a transaction')
  },
  close: async () => {},
}

test('OIDC configuration requires trusted HTTPS endpoints and explicit API policy; development auth stays local', () => {
  const config = oidcConfig()
  assert.equal(config.authMode, 'oidc-jwt')
  assert.equal(config.oidc?.tokenType, 'at+jwt')
  assert.equal(config.oidc?.maxTokenAgeSeconds, 3600)
  for (const env of [
    { OIDC_ISSUER: undefined },
    { OIDC_AUDIENCE: '' },
    { OIDC_JWKS_URL: undefined },
    { OIDC_ISSUER: 'http://identity.test' },
    { OIDC_ISSUER: 'https://identity.test?issuer=other' },
    { OIDC_ISSUER: 'not-a-url' },
    { OIDC_JWKS_URL: 'http://identity.test/keys' },
    { OIDC_JWKS_URL: 'https://user:password@identity.test/keys' },
    { OIDC_JWKS_URL: 'https://identity.test/keys#fragment' },
    { OIDC_TOKEN_TYPE: 'id_token' },
    { OIDC_MAX_TOKEN_AGE_SECONDS: '0' },
    { OIDC_MAX_TOKEN_AGE_SECONDS: '3601' },
  ]) {
    assert.throws(() => oidcConfig(env))
  }
  assert.equal(readConfig({ DATABASE_URL: 'postgresql://test/test' }).oidc, null)
  assert.throws(() => oidcConfig({ AUTH_MODE: 'dev-session' }))
})

test('invalid signatures, token types and required claims fail closed before principal provisioning', async () => {
  const issuer = await testIssuer()
  const app = await createApp(noDatabase, oidcConfig(), { jwksFetch: issuer.fetcher })
  try {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: OIDC_TEST_ISSUER,
      aud: OIDC_TEST_AUDIENCE,
      sub: 'user-one',
      iat: now,
      exp: now + 600,
    }
    const hmac = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .sign(new TextEncoder().encode('only-a-test-hmac-key-with-32-bytes'))
    const tokens = [
      'not-a-jwt',
      'a.b.c',
      'x'.repeat(8193),
      new UnsecuredJWT(claims).encode(),
      hmac,
      await issuer.sign(
        'user-one',
        {},
        { kid: 'primary', jwk: issuer.secondKey, jku: 'https://attacker.example.invalid/keys' },
        true,
      ),
      await issuer.sign('user-one', {}, { kid: 'unknown' }),
      await issuer.sign('user-one', {}, { typ: 'JWT' }),
      await issuer.sign('user-one', { iss: 'https://other-issuer.example.invalid' }),
      await issuer.sign('user-one', { aud: 'other-api' }),
      await issuer.sign('user-one', { exp: now - 30 }),
      await issuer.sign('user-one', { nbf: now + 120 }),
      await issuer.sign('user-one', { iat: now + 120 }),
      await issuer.sign('user-one', { iat: now - 7200, exp: now + 600 }),
      await issuer.sign('user-one', { sub: 42 }),
      await issuer.sign(''),
      await issuer.sign('x'.repeat(256)),
    ]
    for (const claim of ['iss', 'aud', 'sub', 'iat', 'exp']) {
      tokens.push(await issuer.sign('user-one', { [claim]: undefined }))
    }
    for (const token of tokens) {
      const result = await app.inject({
        url: '/v1/careers',
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(result.statusCode, 401, result.body)
      assert.equal(result.json().error.code, 'UNAUTHORIZED')
      assert.equal(result.headers['www-authenticate'], 'Bearer')
    }
    assert.equal((await app.inject({ url: '/v1/careers' })).statusCode, 401)
    assert.ok(
      issuer.requests.every(
        (request) => request.url === oidcConfig().oidc!.jwksUrl && request.redirect === 'manual',
      ),
    )
  } finally {
    await app.close()
  }
})

test('production JWT maps issuer and subject to one owner without merging email or development saves', async () => {
  const f = await fixture()
  const issuer = await testIssuer()
  const app = await createApp({ ...f.db, close: async () => {} }, oidcConfig(), {
    jwksFetch: issuer.fetcher,
  })
  try {
    const ownerToken = await issuer.sign('owner', {
      email: 'same@example.invalid',
      jti: randomUUID(),
    })
    const careerId = randomUUID()
    const created = await app.inject({
      method: 'POST',
      url: '/v1/careers',
      remoteAddress: '203.0.113.1',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        careerId,
        horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
        starterJockeyId: 'HAN_DOYUN' as const,
      },
    })
    assert.equal(created.statusCode, 201, created.body)
    assert.equal(created.json().career.authority, 'server')
    const call = (token: string, url: string) =>
      app.inject({ url, headers: { authorization: `Bearer ${token}` } })
    const refresh = await issuer.sign('owner', {
      email: 'changed@example.invalid',
      jti: randomUUID(),
    })
    assert.deepEqual((await call(refresh, `/v1/careers/${careerId}`)).json(), created.json())
    const differentOwner = await issuer.sign('other', {
      email: 'same@example.invalid',
      ownerId: f.user.principalId,
    })
    assert.equal((await call(differentOwner, `/v1/careers/${careerId}`)).statusCode, 404)
    assert.equal((await call(differentOwner, '/v1/careers')).json().data.length, 0)
    assert.equal((await call(f.user.token, `/v1/careers/${careerId}`)).statusCode, 401)
    assert.equal((await f.call('GET', `/v1/careers/${careerId}`)).statusCode, 404)
    const action = await app.inject({
      method: 'POST',
      url: `/v1/careers/${careerId}/actions`,
      headers: { authorization: `bearer ${refresh}` },
      payload: { actionId: randomUUID(), choice: 'rest', expectedTurn: 1 },
    })
    assert.equal(action.statusCode, 200, action.body)
    const retirementBody = {
      commandId: randomUUID(),
      expectedRevision: action.json().career.revision,
    }
    const retirement = await app.inject({
      method: 'POST',
      url: `/v1/careers/${careerId}/retirement`,
      headers: { authorization: `Bearer ${refresh}` },
      payload: retirementBody,
    })
    assert.equal(retirement.statusCode, 200, retirement.body)
    assert.deepEqual(
      (await call(ownerToken, `/v1/careers/${careerId}/retirement`)).json().retirement,
      retirement.json().retirement,
    )
    assert.equal((await call(differentOwner, `/v1/careers/${careerId}/retirement`)).statusCode, 404)
    assert.equal(
      (await f.db.query("SELECT * FROM principals WHERE provider='external'")).rows.length,
      2,
    )
    assert.equal(issuer.requests.length, 1)
    assert.equal((await app.inject({ url: '/v1/events?pageSize=1' })).statusCode, 200)
    assert.equal((await f.db.query('SELECT * FROM sessions')).rows.length, 2)
    const otherIssuer = 'https://another-identity.example.invalid'
    const otherApp = await createApp(
      { ...f.db, close: async () => {} },
      oidcConfig({ OIDC_ISSUER: otherIssuer }),
      { jwksFetch: issuer.fetcher },
    )
    try {
      const sameSubjectElsewhere = await issuer.sign('owner', {
        iss: otherIssuer,
        email: 'same@example.invalid',
      })
      const separate = await otherApp.inject({
        url: `/v1/careers/${careerId}`,
        headers: { authorization: `Bearer ${sameSubjectElsewhere}` },
      })
      assert.equal(separate.statusCode, 404)
      assert.equal(
        (await f.db.query("SELECT * FROM principals WHERE provider='external'")).rows.length,
        3,
      )
    } finally {
      await otherApp.close()
    }
  } finally {
    await app.close()
    await f.close()
  }
})

test('JWKS failures return a safe 503 and never fall back to a decoded identity or development sessions', async () => {
  const issuer = await testIssuer()
  const token = await issuer.sign()
  for (const fetcher of [
    async () => {
      throw new TypeError('private provider network failure')
    },
    async () => {
      throw new DOMException('private timeout', 'TimeoutError')
    },
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://attacker.example.invalid' },
      }),
    async () => new Response('private upstream failure', { status: 503 }),
    async () => new Response('invalid-json'),
    async () => Response.json({ keys: 'invalid' }),
  ]) {
    const app = await createApp(noDatabase, oidcConfig(), { jwksFetch: fetcher })
    try {
      const result = await app.inject({
        url: '/v1/careers',
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(result.statusCode, 503, result.body)
      assert.equal(result.json().error.code, 'AUTH_PROVIDER_UNAVAILABLE')
      assert.equal(result.body.includes('private'), false)
      assert.equal(result.body.includes(token), false)
    } finally {
      await app.close()
    }
  }
})

test('JWKS rotation keeps known keys cached and refreshes an unknown key after the cooldown', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const f = await fixture()
  const issuer = await testIssuer()
  const app = await createApp({ ...f.db, close: async () => {} }, oidcConfig(), {
    jwksFetch: issuer.fetcher,
  })
  try {
    const first = await issuer.sign()
    const call = (token: string) =>
      app.inject({ url: '/v1/careers', headers: { authorization: `Bearer ${token}` } })
    assert.equal((await call(first)).statusCode, 200)
    const second = await issuer.sign('user-one', {}, {}, true)
    issuer.jwks.keys.push(issuer.secondKey)
    assert.equal((await call(second)).statusCode, 401)
    assert.equal(issuer.requests.length, 1)
    t.mock.timers.tick(30001)
    assert.equal((await call(second)).statusCode, 200)
    assert.equal(issuer.requests.length, 2)
    assert.equal((await call(first)).statusCode, 200)
    assert.equal(
      (await f.db.query("SELECT * FROM principals WHERE provider='external'")).rows.length,
      1,
    )
  } finally {
    await app.close()
    await f.close()
  }
})

test('RS256 and explicitly configured API session JWT types can authenticate', async () => {
  const f = await fixture()
  const issuer = await testIssuer('RS256')
  const app = await createApp(
    { ...f.db, close: async () => {} },
    oidcConfig({ OIDC_TOKEN_TYPE: 'JWT' }),
    { jwksFetch: issuer.fetcher },
  )
  try {
    const token = await issuer.sign('user-one', {}, { typ: 'JWT' })
    const result = await app.inject({
      url: '/v1/careers',
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(result.statusCode, 200, result.body)
  } finally {
    await app.close()
    await f.close()
  }
})
