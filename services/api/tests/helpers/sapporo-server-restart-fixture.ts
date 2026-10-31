// Test-only: each phase runs in a different process against the same local test database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { postgresDatabase } from '../../src/db'
import { fixture } from '../helpers'
import { approvedPlayableDefinitions } from '../../../../packages/shared/src/approved-playable'
import { paidCareer } from '../../../../tests/helpers/economy-fixture'

test('Sapporo R1 to R2 restart preserves old run and uses R2 for new entry', async () => {
  const url = process.env.SAPPORO_TEST_POSTGRES
  const file = process.env.SAPPORO_RESTART_STATE
  const phase = process.env.SAPPORO_RESTART_PHASE
  if (!url || !file || !['prepare', 'restart'].includes(phase ?? '')) {
    throw new Error('Missing isolated restart fixture settings')
  }
  const parsed = new URL(url)
  if (
    !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) ||
    !parsed.pathname.endsWith('_test')
  ) {
    throw new Error('Restart fixture requires a local dedicated *_test database')
  }
  const manifest = approvedPlayableDefinitions[0]
  assert.ok(manifest)
  const db = postgresDatabase(url)
  if (phase === 'restart') {
    try {
      await db.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO official_race_mapping_history(race_definition_id,source_race_id,revision,snapshot) VALUES($1,$2,$3,$4)',
          [manifest.definitionId, manifest.sourceId, manifest.revision, JSON.stringify(manifest)],
        )
        await tx.query('UPDATE race_definitions SET payload=$2 WHERE id=$1', [
          manifest.definitionId,
          JSON.stringify(manifest.definition),
        ])
        await tx.query(
          'UPDATE official_race_mapping_revisions SET revision=$2 WHERE race_definition_id=$1',
          [manifest.definitionId, manifest.revision],
        )
      })
    } catch (error) {
      await db.close()
      throw error
    }
  }
  const f = await fixture({ db, probability: 0 })
  try {
    if (phase === 'prepare') {
      assert.equal(manifest.definition.entryFee, 750000)
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
      await f.db.query('UPDATE careers SET turn=9,state=$2 WHERE id=$1', [
        id,
        JSON.stringify(state),
      ])
      const travel = await f.call('POST', `/v1/careers/${id}/expeditions`, {
        commandId: randomUUID(),
        targetCountry: 'JPN',
        expectedTravelRevision: 0,
      })
      assert.equal(travel.statusCode, 200, travel.body)
      const runId = randomUUID()
      const entered = await f.call('POST', `/v1/careers/${id}/race-entries`, {
        raceRunId: runId,
        raceDefinitionId: manifest.definitionId,
        jockeyId: 'SEO_JIAN',
        tactic: '선입',
        expectedTurn: 9,
      })
      assert.equal(entered.statusCode, 200, entered.body)
      assert.equal(entered.json().career.funds, 19250000)
      const run = await f.call('GET', `/v1/careers/${id}/race-runs/${runId}`)
      const log = await f.call('GET', `/v1/careers/${id}/race-runs/${runId}/log`)
      assert.equal(run.statusCode, 200, run.body)
      assert.equal(log.statusCode, 200, log.body)
      const exactLog = (
        await f.db.query('SELECT log_json,digest FROM race_simulation_logs WHERE race_run_id=$1', [
          runId,
        ])
      ).rows[0]
      assert.equal(exactLog.digest, run.json().metadata.digest)
      await writeFile(
        file,
        JSON.stringify({
          pid: process.pid,
          token: f.user.token,
          id,
          runId,
          stableId: response.career.stableId,
          run: run.json(),
          log: log.json(),
          exactLog,
        }),
        { mode: 0o600 },
      )
      return
    }
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.notEqual(process.pid, saved.pid)
    assert.equal(manifest.definition.entryFee, 800000)
    assert.equal(manifest.definition.prize, 66000000)
    assert.notEqual(manifest.revision, saved.run.raceRun.mappingRevision)
    assert.equal(saved.run.raceRun.raceDefinitionSnapshot.entryFee, 750000)
    assert.equal(saved.run.raceRun.raceDefinitionSnapshot.prize, 65000000)
    const revisions = (
      await f.db.query(
        'SELECT revision FROM official_race_mapping_history WHERE race_definition_id=$1',
        [manifest.definitionId],
      )
    ).rows.map((row) => row.revision)
    assert.ok(revisions.includes(saved.run.raceRun.mappingRevision))
    assert.ok(revisions.includes(manifest.revision))
    const run = await f.call(
      'GET',
      `/v1/careers/${saved.id}/race-runs/${saved.runId}`,
      undefined,
      saved.token,
    )
    const log = await f.call(
      'GET',
      `/v1/careers/${saved.id}/race-runs/${saved.runId}/log`,
      undefined,
      saved.token,
    )
    assert.equal(run.statusCode, 200, run.body)
    assert.equal(log.statusCode, 200, log.body)
    assert.deepStrictEqual(run.json(), saved.run)
    assert.deepStrictEqual(log.json(), saved.log)
    assert.deepStrictEqual(
      (
        await f.db.query('SELECT log_json,digest FROM race_simulation_logs WHERE race_run_id=$1', [
          saved.runId,
        ])
      ).rows[0],
      saved.exactLog,
    )
    const completion = { commandId: randomUUID() }
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.call(
          'POST',
          `/v1/careers/${saved.id}/race-runs/${saved.runId}/complete`,
          completion,
          saved.token,
        ),
      ),
    )
    for (const result of results) {
      assert.equal(result.statusCode, 200, result.body)
      assert.deepStrictEqual(result.json(), results[0].json())
    }
    assert.equal(results[0].json().career.funds, 19250000 + saved.log.log.result.prizeMoney)
    const retry = await f.call(
      'POST',
      `/v1/careers/${saved.id}/race-runs/${saved.runId}/complete`,
      completion,
      saved.token,
    )
    assert.equal(retry.statusCode, 200, retry.body)
    assert.deepStrictEqual(retry.json(), results[0].json())
    assert.deepStrictEqual(
      (
        await f.db.query('SELECT log_json,digest FROM race_simulation_logs WHERE race_run_id=$1', [
          saved.runId,
        ])
      ).rows[0],
      saved.exactLog,
    )
    const ledger = (
      await f.db.query(
        'SELECT kind,amount FROM stable_ledger WHERE stable_id=$1 AND race_run_id=$2',
        [saved.stableId, saved.runId],
      )
    ).rows
    assert.equal(ledger.filter((row) => row.kind === 'entry_fee').length, 1)
    assert.equal(ledger.filter((row) => row.kind === 'prize').length, 1)
    assert.equal(Number(ledger.find((row) => row.kind === 'entry_fee')?.amount), -750000)
    assert.equal(
      Number(ledger.find((row) => row.kind === 'prize')?.amount),
      saved.log.log.result.prizeMoney,
    )

    const fresh = await f.create()
    const freshState = {
      ...fresh.response.career.state,
      month: 9,
      careerTurnIndex: 9,
      calendarDate: { year: 2028, month: 9 },
      raceRecords: paidCareer().raceRecords,
    }
    await f.db.query('UPDATE careers SET turn=9,state=$2 WHERE id=$1', [
      fresh.id,
      JSON.stringify(freshState),
    ])
    const travel = await f.call('POST', `/v1/careers/${fresh.id}/expeditions`, {
      commandId: randomUUID(),
      targetCountry: 'JPN',
      expectedTravelRevision: 0,
    })
    assert.equal(travel.statusCode, 200, travel.body)
    const options = await f.call(
      'GET',
      `/v1/careers/${fresh.id}/race-entries?referenceRaceId=${manifest.sourceId}`,
    )
    assert.equal(options.statusCode, 200, options.body)
    assert.equal(options.json().races[0].eligible, true)
    const entered = await f.call('POST', `/v1/careers/${fresh.id}/race-entries`, {
      raceRunId: randomUUID(),
      raceDefinitionId: manifest.definitionId,
      jockeyId: 'SEO_JIAN',
      tactic: '선입',
      expectedTurn: 9,
    })
    assert.equal(entered.statusCode, 200, entered.body)
    assert.equal(entered.json().career.state.raceRun.mappingRevision, manifest.revision)
    assert.equal(entered.json().career.state.raceRun.raceDefinitionSnapshot.entryFee, 800000)
    assert.equal(entered.json().career.funds, 19200000)
  } finally {
    await f.close()
  }
})
