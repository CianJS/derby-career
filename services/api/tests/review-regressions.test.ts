import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app'
import { readConfig } from '../src/config'
import { importEvents } from '../src/modules/events/import'
import { digest } from '../src/services/identity'
import { fixture } from './helpers'
import { createEventCatalogAdapter } from '../../../packages/shared/src/event-catalog-adapter'
import { createEventCatalogProxy } from '../../../packages/shared/src/event-catalog-proxy'
import { createApiClient, DerbyApiError } from '../../../packages/shared/src/client'
import {
  parseCatalogEvent,
  parseCatalogPage,
} from '../../../packages/shared/src/event-catalog-validation'
import type { EventDefinition } from '../../../packages/shared/src/events'

test('malformed JSON, unsupported media and oversized requests keep their HTTP client error status', async () => {
  const unexpectedQuery = async () => {
    throw new Error('Invalid requests must not query the DB')
  }
  const app = await createApp(
    { query: unexpectedQuery, transaction: unexpectedQuery, close: async () => Promise.resolve() },
    readConfig({ DATABASE_URL: 'postgresql://test/test', LOG_LEVEL: 'silent' }),
  )
  try {
    for (const [contentType, payload, status, code] of [
      ['application/json', '{', 400, 'INVALID_REQUEST'],
      ['application/xml', '<request />', 415, 'UNSUPPORTED_MEDIA_TYPE'],
      [
        'application/json',
        JSON.stringify({ padding: 'x'.repeat(18000) }),
        413,
        'PAYLOAD_TOO_LARGE',
      ],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/careers',
        headers: { 'content-type': contentType },
        payload,
      })
      assert.equal(response.statusCode, status, response.body)
      assert.equal(response.json().error.code, code)
    }
  } finally {
    await app.close()
  }
})

test('public list, detail, adapter and Career history omit internal provenance while DB revisions keep it', async () => {
  const f = await fixture({ probability: 1 })
  try {
    const original = (await f.call('GET', '/v1/events/COM-0001')).json<EventDefinition>()
    const { revision: _revision, ...definition } = original
    const internal = {
      ...definition,
      source: {
        ...definition.source,
        url: 'https://private.example.invalid/import',
        body: 'PRIVATE_IMPORT_NOTE',
      },
    }
    await importEvents(f.db, {
      schemaVersion: 1,
      events: [{ ...internal, revision: digest(internal) }],
    })
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0001'")
    const detail = await f.call('GET', '/v1/events/COM-0001')
    const list = await f.call('GET', '/v1/events')
    const created = await f.create()
    for (const body of [detail.body, list.body, JSON.stringify(created.response)]) {
      assert.equal(body.includes('PRIVATE_IMPORT_NOTE'), false)
      assert.equal(body.includes('private.example.invalid'), false)
    }
    assert.equal(detail.json().revision, digest(internal))
    const stored = (
      await f.db.query('SELECT definition FROM event_revisions WHERE event_id=$1 AND revision=$2', [
        'COM-0001',
        digest(internal),
      ])
    ).rows[0].definition
    assert.equal(stored.source.body, 'PRIVATE_IMPORT_NOTE')
    const oldBackend = createEventCatalogAdapter('http://old-backend.test', async () =>
      Response.json({ ...internal, revision: digest(internal) }),
    )
    const projected = await oldBackend.detail(original.id)
    assert.equal(projected.source.url, null)
    assert.equal('body' in projected.source, false)
  } finally {
    await f.close()
  }
})

test('untrusted successful catalog JSON is rejected before proxy or renderer receives it', async () => {
  for (const body of [
    null,
    {},
    { data: [], pagination: null },
    { data: [{ id: 'wrong' }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
  ]) {
    assert.throws(() => parseCatalogPage(body))
    const proxy = createEventCatalogProxy({
      baseUrl: 'http://backend.test',
      fetch: async () => Response.json(body),
    })
    assert.equal(
      (await proxy.list(new Request('http://frontend.test/api/event-catalog'))).status,
      502,
    )
  }
  assert.throws(() => parseCatalogEvent({ id: 'wrong', choices: null }))
})

test('HTTP errors with null, string or non-JSON bodies still produce typed API errors', async () => {
  for (const response of [
    Response.json(null, { status: 404 }),
    Response.json('bad response', { status: 404 }),
    new Response('<html>not found</html>', { status: 404 }),
  ]) {
    const client = createApiClient({ baseUrl: 'http://backend.test', fetch: async () => response })
    await assert.rejects(
      client.getEvent('missing'),
      (error: unknown) =>
        error instanceof DerbyApiError && error.status === 404 && error.code === 'HTTP_ERROR',
    )
  }
})

test('cross-owner UUID collisions return 409 without leaking data or leaving partial writes', async () => {
  const f = await fixture()
  try {
    const first = await f.create()
    const collision = await f.call(
      'POST',
      '/v1/careers',
      { careerId: first.id, horseDefinitionId: 'DEV_HORSE_SERENE_STEP' },
      f.other.token,
    )
    assert.equal(collision.statusCode, 409, collision.body)
    assert.equal(
      (await f.db.query('SELECT id FROM stables WHERE owner_id=$1', [f.other.principalId])).rows
        .length,
      0,
    )
    const otherId = randomUUID()
    assert.equal(
      (
        await f.call(
          'POST',
          '/v1/careers',
          { careerId: otherId, horseDefinitionId: 'DEV_HORSE_SERENE_STEP' },
          f.other.token,
        )
      ).statusCode,
      201,
    )
    const before = (await f.call('GET', `/v1/careers/${otherId}`, undefined, f.other.token)).json()
    const body = { actionId: randomUUID(), choice: 'rest', expectedTurn: 1 }
    assert.equal((await f.call('POST', `/v1/careers/${first.id}/actions`, body)).statusCode, 200)
    const actionCollision = await f.call(
      'POST',
      `/v1/careers/${otherId}/actions`,
      body,
      f.other.token,
    )
    assert.equal(actionCollision.statusCode, 409, actionCollision.body)
    assert.deepEqual(
      (await f.call('GET', `/v1/careers/${otherId}`, undefined, f.other.token)).json(),
      before,
    )
    assert.equal(
      (await f.db.query('SELECT id FROM monthly_actions WHERE career_id=$1', [otherId])).rows
        .length,
      0,
    )
  } finally {
    await f.close()
  }
})

for (const [label, choice, effect, expected] of [
  [
    'rest penalty near zero',
    'rest',
    { type: 'action_modifier', action: 'rest', field: 'fatigue', operation: 'add', value: 5 },
    0,
  ],
  [
    'growth multiplier near cap',
    'speed',
    {
      type: 'action_modifier',
      action: 'training',
      training: 'speed',
      field: 'primaryGain',
      operation: 'multiply',
      value: 0.5,
    },
    1000,
  ],
] as const) {
  test(`event raw deltas are modified before limits: ${label}`, async () => {
    const f = await fixture({ probability: 1 })
    try {
      const original = (await f.call('GET', '/v1/events/COM-0001')).json<EventDefinition>()
      const { revision: _revision, ...source } = original
      const definition = {
        ...source,
        conditions: [{ type: 'always' }],
        choices: [{ id: 'auto', label, conditions: [], effects: [effect] }],
      }
      await importEvents(f.db, {
        schemaVersion: 1,
        events: [{ ...definition, revision: digest(definition) }],
      })
      await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0001'")
      const { id } = await f.create()
      if (choice === 'speed') {
        await f.db.query(
          "UPDATE careers SET state=jsonb_set(state,'{values,speed}','995') WHERE id=$1",
          [id],
        )
      }
      const body = { actionId: randomUUID(), choice, expectedTurn: 1 }
      const response = await f.call('POST', `/v1/careers/${id}/actions`, body)
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(
        response.json().career.state.values[choice === 'rest' ? 'fatigue' : 'speed'],
        expected,
      )
      assert.deepEqual(
        (await f.call('POST', `/v1/careers/${id}/actions`, body)).json(),
        response.json(),
      )
      assert.equal((await f.call('GET', `/v1/careers/${id}/actions`)).json().data.length, 1)
    } finally {
      await f.close()
    }
  })
}
