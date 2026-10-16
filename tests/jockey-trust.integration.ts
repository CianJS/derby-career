import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from '../services/api/tests/helpers'
import { createApiClient } from '../packages/shared/src/client'
import { ServerSaveController, type SaveSnapshot } from '../lib/server-save/controller'
import { jockeyTrust } from '../lib/career/jockey-trust-presentation'
import { readServerRelations } from '../lib/server-save/jockey-relations'

// Real Fastify + generated validators + PostgreSQL engine. SQL values below are isolated test
// data, not a frontend relationship calculation or an application API fallback.
test('current server relationship values survive controller reconnect, stay owner-scoped and reset for a new horse', async () => {
  const f = await fixture()
  try {
    const { id } = await f.create()
    let snapshot: SaveSnapshot
    let unavailable = false
    const api = createApiClient({
      baseUrl: 'http://api',
      fetch: async (input, init) => {
        if (unavailable) {
          throw new Error('network unavailable')
        }
        const url = new URL(String(input))
        const response = await f.call(
          (init?.method ?? 'GET') as 'GET' | 'POST',
          url.pathname + url.search,
          init?.body ? JSON.parse(String(init.body)) : undefined,
        )
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    let journal: string | null = null
    const controller = () =>
      new ServerSaveController(
        api,
        {
          read: () => journal,
          write: (value) => {
            journal = value
          },
          clear: () => {
            journal = null
          },
        },
        (value) => {
          snapshot = value
        },
      )
    let c = controller()
    assert.equal(await c.refresh(), true)
    const horseId = snapshot!.workspace!.career!.ownedHorseId
    await f.db.query(
      'UPDATE jockey_chemistry SET chemistry=72 WHERE horse_id=$1 AND jockey_id=$2',
      [horseId, 'SEO_JIAN'],
    )
    assert.equal(await c.refresh(), true)
    const trust = (jockeyId: string) =>
      jockeyTrust(
        {
          ...snapshot!,
          mode: 'server',
          career: snapshot!.workspace?.career?.state ?? null,
        },
        jockeyId,
      )
    assert.deepEqual(trust('HAN_DOYUN'), { status: 'available', value: 0 })
    assert.deepEqual(trust('SEO_JIAN'), { status: 'available', value: 72 })
    assert.deepEqual(trust('unqueried'), { status: 'unavailable' })
    c.dispose()
    c = controller()
    assert.equal(await c.refresh(), true)
    assert.deepEqual(trust('SEO_JIAN'), { status: 'available', value: 72 })
    unavailable = true
    assert.equal(await c.refresh(), false)
    assert.deepEqual(trust('SEO_JIAN'), { status: 'error' })
    unavailable = false
    assert.equal(await c.refresh(), true)
    assert.deepEqual(trust('SEO_JIAN'), { status: 'available', value: 72 })
    assert.equal(
      (await f.call('GET', `/v1/careers/${id}/race-entries`, undefined, f.other.token)).statusCode,
      404,
    )
    assert.equal(
      await c.send({
        kind: 'retire',
        careerId: id,
        body: { commandId: randomUUID(), expectedRevision: snapshot!.workspace!.career!.revision },
      }),
      true,
    )
    assert.equal(snapshot!.workspace!.career, null)
    const retirement = snapshot!.workspace!.retirements[0]
    const identity = {
      careerId: id,
      ownedHorseId: horseId,
      revision: retirement.snapshot.revision,
      status: 'retired' as const,
    }
    assert.equal((await readServerRelations(api, identity)).SEO_JIAN.trust, 72)
    assert.equal(
      (await f.call('GET', `/v1/careers/${id}/jockey-relations`, undefined, f.other.token))
        .statusCode,
      404,
    )
    assert.deepEqual(trust('SEO_JIAN'), { status: 'no-horse' })
    assert.equal(
      await c.send({
        kind: 'create',
        body: {
          careerId: randomUUID(),
          horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
        },
      }),
      true,
    )
    assert.notEqual(snapshot!.workspace!.career!.ownedHorseId, horseId)
    assert.deepEqual(trust('SEO_JIAN'), { status: 'available', value: 0 })
    assert.equal(journal, null)
    assert.equal((await readServerRelations(api, identity)).SEO_JIAN.trust, 72)
    c.dispose()
  } finally {
    await f.close()
  }
})
