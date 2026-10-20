import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from './helpers'
import { jockeyCatalog, starterJockeyOptions, tactics } from '../../../packages/shared/src/domain'
import {
  validateJockeyCatalog,
  validateCreateCareer,
} from '../../../packages/shared/src/generated/save-validation.mjs'

const input = (starterJockeyId?: string) => ({
  careerId: randomUUID(),
  horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
  ...(starterJockeyId === undefined ? {} : { starterJockeyId }),
})

test('four explicit starters share the unchanged six-jockey catalog and each creates exactly one free stable contract', async () => {
  const f = await fixture()
  try {
    const catalog = (await f.call('GET', '/v1/catalog/jockeys')).json()
    assert.equal(validateJockeyCatalog(catalog), true)
    assert.deepEqual(catalog.starterOptions, starterJockeyOptions)
    assert.deepEqual(
      catalog.data.map((x: { definition: { id: string } }) => x.definition.id).sort(),
      jockeyCatalog.map((x) => x.id).sort(),
    )
    for (const { jockeyId } of starterJockeyOptions) {
      const { createDevelopmentSession } = await import('../src/modules/auth/sessions')
      const user = await createDevelopmentSession(f.db, randomUUID())
      const body = input(jockeyId)
      assert.equal(validateCreateCareer(body), true)
      const one = await f.call('POST', '/v1/careers', body, user.token)
      assert.equal(one.statusCode, 201, one.body)
      const career = one.json().career
      assert.deepEqual(career.state.contractedJockeyIds, [jockeyId])
      assert.deepEqual(career.state.jockeyTrust, { [jockeyId]: { starts: 0, trust: 0 } })
      assert.equal(career.funds, 20000000)
      assert.deepEqual((await f.call('POST', '/v1/careers', body, user.token)).json(), one.json())
      const workspace = (await f.call('GET', '/v1/careers/workspace', undefined, user.token)).json()
      assert.deepEqual(workspace.stable.contractedJockeyIds, [jockeyId])
      const entries = (
        await f.call('GET', `/v1/careers/${body.careerId}/race-entries`, undefined, user.token)
      ).json()
      assert.deepEqual(
        entries.jockeys.map((j: { id: string }) => j.id),
        [jockeyId],
      )
      assert.deepEqual(entries.tactics, [...tactics])
      assert.equal(
        (await f.db.query('SELECT * FROM jockey_contracts WHERE stable_id=$1', [career.stableId]))
          .rows.length,
        1,
      )
      assert.equal(
        (await f.db.query('SELECT * FROM stable_ledger WHERE stable_id=$1', [career.stableId])).rows
          .length,
        0,
      )
    }
  } finally {
    await f.close()
  }
})

test('missing, non-starter and spoofed selections create no stable, horse, contracts or receipt', async () => {
  const f = await fixture()
  try {
    const missing = input()
    const response = await f.call('POST', '/v1/careers', missing)
    assert.equal(response.statusCode, 422, response.body)
    assert.equal(response.json().error.code, 'STARTER_JOCKEY_REQUIRED')
    for (const id of ['SEO_JIAN', 'YOON_TAESUNG', 'unknown']) {
      assert.equal((await f.call('POST', '/v1/careers', input(id))).statusCode, 400)
    }
    assert.equal(
      (
        await f.call('POST', '/v1/careers', {
          ...input('HAN_DOYUN'),
          contractedJockeyIds: ['SEO_JIAN'],
        })
      ).statusCode,
      400,
    )
    for (const table of ['stables', 'owned_horses', 'jockey_contracts', 'commands']) {
      assert.equal((await f.db.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count, 0)
    }
  } finally {
    await f.close()
  }
})

test('retirement keeps the selected contract and new horses begin with separate zero trust; starter cannot be changed', async () => {
  const f = await fixture()
  try {
    const first = input('PARK_SEOYUN')
    const created = await f.call('POST', '/v1/careers', first)
    assert.equal(created.statusCode, 201, created.body)
    const horse = created.json().career.ownedHorseId
    await f.db.query('UPDATE jockey_chemistry SET starts=3,chemistry=42 WHERE horse_id=$1', [horse])
    assert.equal(
      (await f.call('GET', `/v1/careers/${first.careerId}`, undefined, f.other.token)).statusCode,
      404,
    )
    const retired = await f.call('POST', `/v1/careers/${first.careerId}/retirement`, {
      commandId: randomUUID(),
      expectedRevision: 1,
    })
    assert.equal(retired.statusCode, 200, retired.body)
    const workspace = (await f.call('GET', '/v1/careers/workspace')).json()
    assert.equal(workspace.career, null)
    assert.deepEqual(workspace.stable.contractedJockeyIds, ['PARK_SEOYUN'])
    const rejected = await f.call('POST', '/v1/careers', input('KANG_HAJUN'))
    assert.equal(rejected.statusCode, 409)
    const next = await f.call('POST', '/v1/careers', input())
    assert.equal(next.statusCode, 201, next.body)
    assert.deepEqual(next.json().career.state.contractedJockeyIds, ['PARK_SEOYUN'])
    assert.deepEqual(next.json().career.state.jockeyTrust.PARK_SEOYUN, { starts: 0, trust: 0 })
    const old = (await f.call('GET', `/v1/careers/${first.careerId}/jockey-relations`)).json()
    assert.deepEqual(old.data, [{ jockeyId: 'PARK_SEOYUN', starts: 3, trust: 42 }])
  } finally {
    await f.close()
  }
})

test('owner locking serializes first selections and conflicting retries never add contracts', async () => {
  const f = await fixture()
  try {
    const body = input('CHOI_MINJAE')
    const replies = await Promise.all([
      f.call('POST', '/v1/careers', body),
      f.call('POST', '/v1/careers', body),
      f.call('POST', '/v1/careers', input('HAN_DOYUN')),
    ])
    assert.deepEqual(replies.map((r) => r.statusCode).sort(), [201, 201, 409])
    assert.deepEqual(replies[0].json(), replies[1].json())
    assert.equal(
      (await f.call('POST', '/v1/careers', { ...body, starterJockeyId: 'KANG_HAJUN' })).statusCode,
      409,
    )
    assert.deepEqual((await f.db.query('SELECT jockey_id FROM jockey_contracts')).rows, [
      { jockey_id: 'CHOI_MINJAE' },
    ])
    assert.equal((await f.db.query('SELECT count(*) AS count FROM commands')).rows[0].count, 1)
  } finally {
    await f.close()
  }
})

test('a failure after contract insertion rolls back all first-career writes and retries safely', async () => {
  const f = await fixture()
  try {
    await f.db.query(
      "CREATE FUNCTION reject_starter_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='career.create' THEN RAISE EXCEPTION 'Receipt failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_starter_receipt BEFORE INSERT ON commands FOR EACH ROW EXECUTE FUNCTION reject_starter_receipt()",
    )
    const body = input('HAN_DOYUN')
    assert.equal((await f.call('POST', '/v1/careers', body)).statusCode, 500)
    for (const table of [
      'stables',
      'owned_horses',
      'jockey_contracts',
      'jockey_chemistry',
      'careers',
      'commands',
    ]) {
      assert.equal(Number((await f.db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n), 0)
    }
    await f.db.query('DROP TRIGGER reject_starter_receipt ON commands')
    assert.equal((await f.call('POST', '/v1/careers', body)).statusCode, 201)
  } finally {
    await f.close()
  }
})

test('existing three-contract saves survive creation without a starter and cannot be reduced by a later selection', async () => {
  const f = await fixture()
  try {
    const { id, response } = await f.create()
    const original = response.career.state.contractedJockeyIds
    assert.deepEqual(original, ['HAN_DOYUN', 'SEO_JIAN', 'YOON_TAESUNG'])
    assert.equal(
      (
        await f.call('POST', `/v1/careers/${id}/retirement`, {
          commandId: randomUUID(),
          expectedRevision: 1,
        })
      ).statusCode,
      200,
    )
    const next = await f.call('POST', '/v1/careers', input('HAN_DOYUN'))
    assert.equal(next.statusCode, 201, next.body)
    assert.deepEqual(next.json().career.state.contractedJockeyIds, original)
  } finally {
    await f.close()
  }
})
