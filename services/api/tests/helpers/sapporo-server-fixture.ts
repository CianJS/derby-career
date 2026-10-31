// Executed only inside the disposable checkout with the test-only approval manifest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from '../helpers'
import { importRacingCatalog, readRacingSource } from '../../src/modules/racing/import'
import { sapporoPilot } from '../../../../packages/shared/src/sapporo-pilot'
import { approvedPlayableDefinitions } from '../../../../packages/shared/src/approved-playable'
import { paidCareer } from '../../../../tests/helpers/economy-fixture'

test('isolated Sapporo fixture uses authoritative server entry and settlement', async () => {
  const f = await fixture({ probability: 0 })
  try {
    await importRacingCatalog(f.db, await readRacingSource(['seeds/racing.notion.source.json']))
    const manifest = approvedPlayableDefinitions[0]
    assert.equal(manifest?.sourceId, sapporoPilot.source.id)
    await f.db.query(
      'INSERT INTO race_definitions(id,payload,source_kind,country_code) VALUES($1,$2,$3,$4)',
      [manifest.definitionId, JSON.stringify(manifest.definition), 'catalog', 'JPN'],
    )
    await f.db.query(
      'INSERT INTO official_race_mapping_revisions(race_definition_id,source_race_id,revision) VALUES($1,$2,$3)',
      [manifest.definitionId, manifest.sourceId, manifest.revision],
    )
    const { id, response } = await f.create()
    const state = {
      ...response.career.state,
      month: 9,
      careerTurnIndex: 9,
      calendarDate: { year: 2028, month: 9 },
      raceRecords: paidCareer().raceRecords,
    }
    await f.db.query('UPDATE careers SET turn=9,state=$2 WHERE id=$1', [id, JSON.stringify(state)])
    const path = `/v1/careers/${id}/race-entries`
    const options = await f.call('GET', `${path}?referenceRaceId=${manifest.sourceId}`)
    assert.equal(options.statusCode, 200, options.body)
    const detail = await f.call('GET', `/v1/race-schedule/${manifest.sourceId}`)
    assert.equal(detail.statusCode, 200, detail.body)
    assert.equal(detail.json().playability.status, 'playable')
    assert.equal(options.json().referenceRace.raceDefinitionId, manifest.definitionId)
    assert.equal(options.json().referenceRace.status, 'playable')
    assert.equal(options.json().races.length, 1)
    assert.equal(options.json().races[0].eligible, false)
    assert.equal(
      (
        await f.call(
          'GET',
          `${path}?referenceRaceId=${manifest.sourceId}`,
          undefined,
          f.other.token,
        )
      ).statusCode,
      404,
    )
    const body = {
      raceRunId: randomUUID(),
      raceDefinitionId: manifest.definitionId,
      jockeyId: 'SEO_JIAN',
      tactic: '선입',
      expectedTurn: 9,
    }
    await f.db.query(
      'INSERT INTO race_definitions(id,payload,source_kind,country_code) VALUES($1,$2,$3,$4)',
      ['ALIAS_SAPPORO_TEST', JSON.stringify(manifest.definition), 'catalog', 'JPN'],
    )
    assert.equal(
      (await f.call('POST', path, { ...body, raceDefinitionId: 'ALIAS_SAPPORO_TEST' })).statusCode,
      422,
    )
    assert.equal((await f.call('POST', path, body, f.other.token)).statusCode, 404)
    assert.equal(
      (await f.call('POST', path, { ...body, raceDefinitionId: manifest.sourceId })).statusCode,
      422,
    )
    assert.equal((await f.call('POST', path, body)).statusCode, 422)
    const travel = await f.call('POST', `/v1/careers/${id}/expeditions`, {
      commandId: randomUUID(),
      targetCountry: 'JPN',
      expectedTravelRevision: 0,
    })
    assert.equal(travel.statusCode, 200, travel.body)
    assert.equal(
      (await f.call('GET', `${path}?referenceRaceId=${manifest.sourceId}`)).json().races[0]
        .eligible,
      true,
    )
    await f.db.query('UPDATE careers SET state=$2 WHERE id=$1', [
      id,
      JSON.stringify({ ...state, raceRecords: [] }),
    ])
    assert.equal((await f.call('POST', path, body)).statusCode, 422)
    await f.db.query('UPDATE careers SET turn=21,state=$2 WHERE id=$1', [
      id,
      JSON.stringify({ ...state, month: 21, careerTurnIndex: 21 }),
    ])
    assert.equal((await f.call('POST', path, { ...body, expectedTurn: 21 })).statusCode, 422)
    await f.db.query('UPDATE careers SET turn=9,state=$2 WHERE id=$1', [id, JSON.stringify(state)])
    assert.equal((await f.call('POST', path, { ...body, jockeyId: 'PARK_SEOYUN' })).statusCode, 422)
    await f.db.query('UPDATE stables SET funds=749999 WHERE id=$1', [response.career.stableId])
    assert.equal((await f.call('POST', path, body)).statusCode, 422)
    await f.db.query('UPDATE stables SET funds=20000000 WHERE id=$1', [response.career.stableId])
    await f.db.query(
      'UPDATE official_race_mapping_revisions SET revision=$2 WHERE race_definition_id=$1',
      [manifest.definitionId, '0'.repeat(64)],
    )
    assert.equal(
      (await f.call('GET', `${path}?referenceRaceId=${manifest.sourceId}`)).json().referenceRace
        .status,
      'blocked',
    )
    assert.equal((await f.call('POST', path, body)).statusCode, 422)
    await f.db.query(
      'UPDATE official_race_mapping_revisions SET revision=$2 WHERE race_definition_id=$1',
      [manifest.definitionId, manifest.revision],
    )
    await f.db.query(
      "UPDATE racecourse_courses SET payload=jsonb_set(payload,'{notes}','\"tampered\"') WHERE id=$1",
      [manifest.courseId],
    )
    assert.equal((await f.call('POST', path, body)).statusCode, 422)
    const catalog = (await import('../../src/modules/racing/catalog')).normalizeRacingCatalog(
      await readRacingSource(['seeds/racing.notion.source.json']),
    )
    const originalCourse = catalog.courses.find((c) => c.id === manifest.courseId)!
    await f.db.query('UPDATE racecourse_courses SET payload=$2 WHERE id=$1', [
      manifest.courseId,
      JSON.stringify(originalCourse),
    ])
    await f.db.query(
      "UPDATE race_definitions SET payload=jsonb_set(payload,'{entryFee}','1') WHERE id=$1",
      [manifest.definitionId],
    )
    assert.equal((await f.call('POST', path, body)).statusCode, 422)
    await f.db.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
      manifest.definitionId,
      JSON.stringify(manifest.definition),
    ])
    await f.db.query(
      "UPDATE race_schedules SET payload=jsonb_set(payload,'{notes}','\"tampered\"') WHERE id=$1",
      [manifest.sourceId],
    )
    assert.equal((await f.call('POST', path, body)).statusCode, 422)
    const source = catalog.races.find((r) => r.id === manifest.sourceId)!
    await f.db.query('UPDATE race_schedules SET payload=$2 WHERE id=$1', [
      manifest.sourceId,
      JSON.stringify(source),
    ])
    const entered = await f.call('POST', path, body)
    assert.equal(entered.statusCode, 200, entered.body)
    assert.equal(entered.json().career.funds, 19250000)
    assert.equal(entered.json().career.state.raceRun.mappingRevision, manifest.revision)
    assert.deepEqual((await f.call('POST', path, body)).json(), entered.json())
    assert.equal((await f.call('POST', path, { ...body, raceRunId: randomUUID() })).statusCode, 409)
    const log = (await f.call('GET', `/v1/careers/${id}/race-runs/${body.raceRunId}/log`)).json()
      .log
    const finishPath = `/v1/careers/${id}/race-runs/${body.raceRunId}/complete`
    const completion = { commandId: randomUUID() }
    const finished = await f.call('POST', finishPath, completion)
    assert.equal(finished.statusCode, 200, finished.body)
    assert.equal(finished.json().career.funds, 19250000 + log.result.prizeMoney)
    assert.deepEqual((await f.call('POST', finishPath, completion)).json(), finished.json())
    const rows = (
      await f.db.query('SELECT kind,amount FROM stable_ledger WHERE stable_id=$1', [
        response.career.stableId,
      ])
    ).rows
    assert.equal(rows.filter((r) => r.kind === 'entry_fee').length, 1)
    assert.equal(rows.filter((r) => r.kind === 'prize').length, 1)
  } finally {
    await f.close()
  }
})
