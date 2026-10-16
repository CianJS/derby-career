import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type { Pool } from 'pg'
import { createApp } from '../src/app'
import { createFunctionHandler, bootstrapPublicApp, readDeploymentConfig } from '../src/vercel'
import { readConfig } from '../src/config'
import { postgresDatabase, type Database } from '../src/db'
import { migrate } from '../src/services/migrations'
import { readRacingSource, importRacingCatalog } from '../src/modules/racing/import'
import { verifyPublicCatalog } from '../scripts/catalog-smoke.mjs'
import { embeddedDatabase } from './database'
import { serveFunction } from './function-server'

const contractPath = new URL('../../../contracts/openapi.yaml', import.meta.url)
const env = {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1/derby_deployment_test',
  LOG_LEVEL: 'silent',
}

test('deployment is production/public-only and rejects absent/wrong DB URLs and pool settings', () => {
  const deployment = readDeploymentConfig(env)
  assert.equal(deployment.poolMax, 3)
  assert.equal(deployment.config.nodeEnv, 'production')
  assert.equal(deployment.config.authMode, 'disabled')
  for (const invalid of [
    {},
    { ...env, DATABASE_URL: '' },
    { ...env, DATABASE_URL: 'https://example.invalid' },
    { ...env, AUTH_MODE: 'dev-session', NODE_ENV: 'development' },
    { ...env, AUTH_MODE: 'oidc-jwt' },
    { ...env, DB_POOL_MAX: '0' },
    { ...env, DB_POOL_MAX: '11' },
    { ...env, DB_POOL_MAX: 'NaN' },
  ]) {
    assert.throws(() => readDeploymentConfig(invalid))
  }
  assert.equal(readDeploymentConfig({ ...env, DB_POOL_MAX: '2' }).poolMax, 2)
})

test('cold start errors fail closed without leaking secrets and later initialization can recover', async () => {
  const logs: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    logs.push(args)
  }
  let app: Awaited<ReturnType<typeof createApp>> | undefined
  let attempts = 0
  const handler = createFunctionHandler(async () => {
    attempts++
    if (attempts === 1) {
      return bootstrapPublicApp({ ...env, AUTH_MODE: 'secret-private-token' }, contractPath)
    }
    app = await createApp(await embeddedDatabase(), readConfig(env))
    await app.ready()
    return app
  })
  const server = await serveFunction(handler)
  try {
    const responses = [await fetch(server.base + '/health/ready')]
    for (const response of responses) {
      assert.equal(response.status, 503)
      const text = await response.text()
      assert.equal(JSON.parse(text).error.code, 'API_NOT_CONFIGURED')
      assert.ok(!text.includes('secret-private-token') && !text.includes('postgresql:'))
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    // No migrations are run automatically; live can recover while ready still reports missing DB schema.
    assert.equal((await fetch(server.base + '/health/live')).status, 200)
    assert.ok(!JSON.stringify(logs).includes('secret-private-token'))
  } finally {
    console.error = original
    await server.close()
    await app?.close()
  }
})

test('production function serves 851/90 with one warm app, no fixtures and idempotent reference import', async () => {
  const db = await embeddedDatabase()
  await migrate(db)
  const source = await readRacingSource(['seeds/racing.notion.source.json'])
  const first = await importRacingCatalog(db, source)
  const second = await importRacingCatalog(db, source)
  assert.equal(first.created, 1042)
  assert.equal(second.created, 0)
  assert.equal(second.updated, 0)
  assert.equal(second.unchanged, 1042)
  let bootCount = 0
  const app = await createApp(db, readDeploymentConfig(env).config, { contractPath })
  const handler = createFunctionHandler(async () => {
    bootCount++
    await app.ready()
    return app
  })
  const server = await serveFunction(handler)
  try {
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => fetch(server.base + '/health/ready')),
    )
    assert.ok(concurrent.every((r) => r.status === 200))
    assert.equal(bootCount, 1)
    assert.deepEqual(await verifyPublicCatalog(server.base), {
      races: 851,
      countries: { KOR: 51, JPN: 176, USA: 624 },
      racecourses: 90,
      privateApi: 'disabled',
    })
    const forbiddenWrite = await fetch(server.base + '/v1/careers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-dev-token' },
      body: JSON.stringify({ careerId: randomUUID(), horseDefinitionId: 'horse_red_comet' }),
    })
    assert.equal(forbiddenWrite.status, 503)
    assert.equal((await forbiddenWrite.json()).error.code, 'AUTH_NOT_CONFIGURED')
    for (const table of [
      'horse_definitions',
      'jockey_definitions',
      'race_definitions',
      'event_definitions',
      'careers',
      'sessions',
      'race_runs',
    ]) {
      assert.equal(Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n), 0, table)
    }
  } finally {
    await server.close()
    await app.close()
  }
})

test('connection failures return contracted readiness 503 and generic catalog errors, never fake data', async () => {
  const db: Database = {
    query: async () => {
      throw new Error('DB_SECRET should not reach HTTP')
    },
    transaction: async () => {
      throw new Error('DB_SECRET should not reach HTTP')
    },
    close: async () => {},
  }
  const app = await createApp(db, readDeploymentConfig(env).config, { contractPath })
  const server = await serveFunction(
    createFunctionHandler(async () => {
      await app.ready()
      return app
    }),
  )
  try {
    const ready = await fetch(server.base + '/health/ready')
    assert.equal(ready.status, 503)
    assert.equal((await ready.json()).error.code, 'DATABASE_UNAVAILABLE')
    const catalog = await fetch(server.base + '/v1/race-schedule')
    assert.equal(catalog.status, 500)
    assert.ok(!(await catalog.text()).includes('DB_SECRET'))
    assert.equal((await fetch(server.base + '/v1/careers')).status, 503)
  } finally {
    await server.close()
    await app.close()
  }
})

test('read-only deployment smoke rejects HTML, malformed success JSON and wrong counts', async () => {
  for (const response of [
    new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }),
    Response.json({ status: 'ready' }),
    Response.json({ data: [], pagination: { page: 1, pageSize: 100, total: 850, totalPages: 9 } }),
  ]) {
    await assert.rejects(
      verifyPublicCatalog('https://api.example.invalid', async (url: URL) => {
        return url.pathname === '/health/ready'
          ? Response.json({ status: 'ready' })
          : response.clone()
      }),
    )
  }
  await assert.rejects(verifyPublicCatalog('https://secret:password@example.invalid'))
})

test('pg pool suspension hook is attached once and idle errors use a fixed safe log', async () => {
  let attached = 0
  let captured: Pool | undefined
  const db = postgresDatabase(env.DATABASE_URL, {
    max: 2,
    attachPool(pool) {
      captured = pool
      attached++
    },
  })
  const original = console.error
  const logs: unknown[][] = []
  console.error = (...args: unknown[]) => {
    logs.push(args)
  }
  try {
    assert.equal(attached, 1)
    assert.equal(captured?.options.max, 2)
    captured?.emit('error', new Error('secret-db-connection'))
    assert.deepEqual(logs, [['Database idle connection unavailable']])
  } finally {
    console.error = original
    await db.close()
  }
})

test('deployment DB operator commands reject missing env/invalid URLs/private auth and never print input secrets', () => {
  for (const override of [
    {},
    { DATABASE_URL_UNPOOLED: 'postgresql://user:secret-password@' },
    { DATABASE_URL_UNPOOLED: env.DATABASE_URL, AUTH_MODE: 'dev-session' },
    { DATABASE_URL_UNPOOLED: 'https://user:secret-password@example.invalid' },
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/deployment-db.ts', 'migrate'],
      {
        env: { PATH: process.env.PATH, LOG_LEVEL: 'silent', ...override },
        encoding: 'utf8',
        timeout: 15000,
      },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Deployment DB command failed/)
    assert.ok(!result.stderr.includes('secret-password') && !result.stderr.includes('postgresql:'))
  }
})
