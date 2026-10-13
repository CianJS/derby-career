import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { migrate } from '../src/services/migrations'
import { importEvents, convertNotionRows, readEventSource } from '../src/modules/events/import'
import { readConfig } from '../src/config'
import { revokeSession } from '../src/modules/auth/sessions'
import { fixture, catalogSource } from './helpers'
import { embeddedDatabase } from './database'
import type { components } from '../../../packages/shared/src/generated/api'

type Models = components['schemas']

test('transactional migration runs once; SQL constraints reject invalid stats and immutable history mutation', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(await migrate(f.db), [])
    const { id } = await f.create()
    await assert.rejects(
      f.db.query("UPDATE careers SET state=jsonb_set(state,'{values,speed}','1001') WHERE id=$1", [
        id,
      ]),
      /check constraint/,
    )
    await assert.rejects(
      f.db.query("UPDATE event_revisions SET definition=definition WHERE event_id='COM-0001'"),
      /Immutable history/,
    )
    await assert.rejects(
      f.db.query("DELETE FROM event_choices WHERE event_id='COM-0001'"),
      /Immutable history/,
    )
  } finally {
    await f.close()
  }
})
test('all 350 actual Notion IDs survive import; 35 race preparations are disabled; import and CSV re-import are idempotent', async () => {
  const f = await fixture()
  try {
    const source = await catalogSource()
    const catalog = convertNotionRows(source.rows)
    assert.equal(catalog.events.length, 350)
    assert.equal(new Set(catalog.events.map((e) => e.id)).size, 350)
    assert.equal(catalog.events.filter((e) => e.introduction === 'candidate').length, 315)
    assert.equal(catalog.events.filter((e) => e.status === 'deferred' && !e.enabled).length, 35)
    await importEvents(f.db, catalog)
    await importEvents(f.db, catalog)
    assert.equal(
      Number((await f.db.query('SELECT count(*) AS n FROM event_definitions')).rows[0].n),
      350,
    )
    assert.equal(
      Number((await f.db.query('SELECT count(*) AS n FROM event_revisions')).rows[0].n),
      350,
    )
    const row = source.rows.find((x) => x['이벤트 ID'] === 'COM-0046')
    assert.ok(row)
    const keys = Object.keys(row)
    const escape = (s: string) => '"' + s.replaceAll('"', '""') + '"'
    const csv =
      '\ufeff' +
      keys.map(escape).join(',') +
      '\n' +
      keys.map((k) => escape(row[k])).join(',') +
      '\n'
    assert.deepEqual(
      readEventSource(csv, 'csv').events[0],
      catalog.events.find((e) => e.id === 'COM-0046'),
    )
    const malformed = {
      ...catalog,
      events: [
        {
          ...catalog.events[0],
          choices: [
            { ...catalog.events[0].choices[0], effects: [{ type: 'unknown' }] },
            ...catalog.events[0].choices.slice(1),
          ],
        },
        ...catalog.events.slice(1),
      ],
    }
    await assert.rejects(importEvents(f.db, malformed))
    await assert.rejects(
      importEvents(f.db, { schemaVersion: 1, events: [catalog.events[0], catalog.events[0]] }),
    )
  } finally {
    await f.close()
  }
})
test('event filtering, stable pagination, sorting and strict request validation match the contract', async () => {
  const f = await fixture()
  try {
    const all = await f.call('GET', '/v1/events?category=common&pageSize=100')
    assert.equal(all.statusCode, 200, all.body)
    assert.equal(all.json().pagination.total, 350)
    const one = await f.call(
      'GET',
      '/v1/events?category=common&enabled=false&status=deferred&pageSize=100',
    )
    assert.equal(one.json().pagination.total, 35)
    assert.ok(one.json<Models['EventList']>().data.every((x) => !x.enabled))
    const pages = await Promise.all([
      f.call('GET', '/v1/events?page=1&pageSize=10'),
      f.call('GET', '/v1/events?page=2&pageSize=10'),
    ])
    assert.equal(
      new Set(pages.flatMap((p) => p.json<Models['EventList']>().data.map((x) => x.id))).size,
      20,
    )
    const descending = await f.call('GET', '/v1/events?sort=id&order=desc&pageSize=1')
    assert.equal(descending.json().data[0].id, 'COM-0350')
    assert.equal((await f.call('GET', '/v1/events/COM-0001')).json().name, '새벽 직선 주로')
    for (const url of [
      '/v1/events?enabled=oops',
      '/v1/events?pageSize=0',
      '/v1/events?sort=sql',
      '/v1/events?unknown=true',
    ]) {
      assert.equal((await f.call('GET', url)).statusCode, 400, url)
    }
    assert.equal((await f.call('GET', '/v1/events/no-such-event')).statusCode, 404)
  } finally {
    await f.close()
  }
})
test('private reads and writes require unexpired owned sessions; default/production modes fail closed', async () => {
  const f = await fixture()
  try {
    const { id } = await f.create()
    assert.equal((await f.app.inject({ url: `/v1/careers/${id}` })).statusCode, 401)
    assert.equal(
      (await f.call('GET', `/v1/careers/${id}`, undefined, f.other.token)).statusCode,
      404,
    )
    assert.equal(
      (
        await f.call(
          'POST',
          `/v1/careers/${id}/actions`,
          { actionId: randomUUID(), choice: 'rest', expectedTurn: 1 },
          f.other.token,
        )
      ).statusCode,
      404,
    )
    await revokeSession(f.db, f.user.token)
    assert.equal((await f.call('GET', `/v1/careers/${id}`)).statusCode, 401)
    await f.db.query(
      "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE principal_id=$1",
      [f.other.principalId],
    )
    assert.equal((await f.call('GET', '/v1/careers', undefined, f.other.token)).statusCode, 401)
    assert.throws(() =>
      readConfig({
        DATABASE_URL: 'postgresql://local/local',
        NODE_ENV: 'production',
        AUTH_MODE: 'dev-session',
      }),
    )
    assert.throws(() =>
      readConfig({
        DATABASE_URL: 'postgresql://local/local',
        AUTH_MODE: 'dev-session',
        HOST: '0.0.0.0',
      }),
    )
  } finally {
    await f.close()
  }
  const db = await embeddedDatabase()
  const { createApp } = await import('../src/app')
  const app = await createApp(
    db,
    readConfig({
      DATABASE_URL: 'postgresql://local/local',
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
    }),
  )
  try {
    assert.equal((await app.inject({ url: '/v1/careers' })).statusCode, 503)
    assert.equal((await app.inject({ url: '/health/live' })).statusCode, 200)
    assert.equal((await app.inject({ url: '/health/ready' })).statusCode, 503)
  } finally {
    await app.close()
  }
})
