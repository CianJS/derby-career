import { validateExpeditionHistory } from '../../../packages/shared/src/generated/save-validation.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { randomUUID } from 'node:crypto'
import { readContract, resolveSchema } from '../src/contracts'
import { createApiClient } from '../../../packages/shared/src/client'
import { createEventCatalogAdapter } from '../../../packages/shared/src/event-catalog-adapter'
import { fixture } from './helpers'

test('actual responses conform to OpenAPI and the public adapter works without touching browser saves', async () => {
  const f = await fixture()
  try {
    const spec = await readContract()
    const ajv = new Ajv({ strict: false })
    addFormats(ajv)
    const validate = (path: string, method: string, body: unknown, status = '200') => {
      const response = resolveSchema(spec.paths[path][method].responses[status], spec)
      const check = ajv.compile(response.content['application/json'].schema)
      assert.equal(check(body), true, JSON.stringify(check.errors))
    }
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((value, name) => {
        headers[name] = value
      })
      const result = await f.app.inject({
        method: (init?.method as 'GET' | 'POST' | undefined) ?? 'GET',
        url: url.pathname + url.search,
        payload: init?.body as string | undefined,
        headers,
      })
      return new Response(result.body, {
        status: result.statusCode,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const adapter = createEventCatalogAdapter('http://127.0.0.1:4000', fetcher)
    const list = await adapter.list({ category: 'common', enabled: true, pageSize: 5 })
    validate('/v1/events', 'get', list)
    assert.equal(list.pagination.total, 315)
    validate('/v1/events/{eventId}', 'get', await adapter.detail('COM-0001'))
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4000',
      fetch: fetcher,
      getSessionToken: () => f.user.token,
    })
    const id = randomUUID()
    const created = await client.createCareer({
      careerId: id,
      horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
      starterJockeyId: 'HAN_DOYUN',
    })
    validate('/v1/careers', 'post', created, '201')
    validate('/v1/careers/{careerId}', 'get', await client.getCareer(id))
    validate('/v1/careers/{careerId}/expedition', 'get', await client.getExpedition(id))
    const departed = await client.startExpedition(id, {
      commandId: randomUUID(),
      targetCountry: 'JPN',
      expectedTravelRevision: 0,
    })
    validate('/v1/careers/{careerId}/expeditions', 'post', departed)
    assert.ok(departed.career.travel?.activeExpedition)
    const returned = await client.returnExpedition(id, departed.career.travel.activeExpedition.id, {
      commandId: randomUUID(),
      expectedTravelRevision: 1,
    })
    validate('/v1/careers/{careerId}/expeditions/{expeditionId}/return', 'post', returned)
    assert.equal(returned.career.travel?.activeExpedition, null)
    const history = await client.getExpeditionHistory(id, { page: 1, pageSize: 1 })
    validate('/v1/careers/{careerId}/expeditions/history', 'get', history)
    assert.ok(validateExpeditionHistory(history))
    assert.equal(history.data[0].id, departed.career.travel.activeExpedition.id)
    assert.equal(history.data[0].endReason, 'return')
    assert.equal(history.data[0].startedTurn, 1)
    assert.equal(history.data[0].endedTurn, 1)
    assert.equal(
      validateExpeditionHistory({ ...history, data: [{ ...history.data[0], endedTurn: 0 }] }),
      false,
    )
    assert.equal(
      validateExpeditionHistory({
        ...history,
        data: [{ ...history.data[0], endReason: 'inferred' }],
      }),
      false,
    )
    assert.equal(validateExpeditionHistory({ ...history, extra: 'unsupported' }), false)
    assert.equal(validateExpeditionHistory({ data: [], page: 0, pageSize: 1 }), false)

    const action = await client.confirmAction(id, {
      actionId: randomUUID(),
      choice: 'speed',
      expectedTurn: 1,
    })
    validate('/v1/careers/{careerId}/actions', 'post', action)
    validate('/v1/careers/{careerId}/actions', 'get', await client.listActions(id))
    const next = await client.advanceMonth(id, {
      commandId: randomUUID(),
      actionId: action.actionId,
      expectedTurn: 1,
    })
    validate('/v1/careers/{careerId}/months/advance', 'post', next)
    const retired = await client.retireCareer(id, {
      commandId: randomUUID(),
      expectedRevision: next.career.revision,
    })
    validate('/v1/careers/{careerId}/retirement', 'post', retired)
    const archive = await client.getRetirement(id)
    validate('/v1/careers/{careerId}/retirement', 'get', archive)
    assert.deepEqual(archive.retirement, retired.retirement)
    assert.deepEqual(await client.getExpeditionHistory(id, { page: 1, pageSize: 1 }), history)
  } finally {
    await f.close()
  }
})
