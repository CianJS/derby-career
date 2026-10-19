import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fixture } from '../services/api/tests/helpers'
import { importRacingCatalog, readRacingSource } from '../services/api/src/modules/racing/import'
import { createCatalogClient } from '../lib/race-catalog/client'
import { dateText, prizeText } from '../lib/race-catalog/model'

// Run from services/api after pnpm build. Actual Next HTTP -> Fastify HTTP -> migrated PGlite DB.
test('public catalog HTTP flow uses Next route and real server/DB for 848 distinct rows, nine pages, filters/details and empty DB', async () => {
  const f = await fixture()
  const upstream = await f.app.listen({ port: 0, host: '127.0.0.1' })
  const trace: { path: string; status: number }[] = []
  f.app.server.on('request', (request, response) => {
    if (request.url?.startsWith('/v1/race')) {
      assert.equal(request.headers.authorization, undefined)
      assert.equal(request.headers.cookie, undefined)
      response.once('finish', () => trace.push({ path: request.url!, status: response.statusCode }))
    }
  })
  const root = resolve('../..')
  const next = spawn(
    process.execPath,
    [
      resolve(root, 'node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '0',
    ],
    {
      cwd: root,
      env: { ...process.env, DERBY_API_URL: upstream },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  try {
    const url = await new Promise<string>((done, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Next startup timeout: ' + output.slice(-2000))),
        30000,
      )
      const read = (chunk: Buffer) => {
        output += chunk.toString()
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)
        if (match && /Ready in/.test(output)) {
          clearTimeout(timer)
          done(`http://127.0.0.1:${match[1]}`)
        }
      }
      next.stdout.on('data', read)
      next.stderr.on('data', read)
      next.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      next.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Next exited ${code}: ${output.slice(-2000)}`))
      })
    })
    const client = createCatalogClient(url + '/api/racing-catalog')
    assert.equal((await client.list({ pageSize: 100 })).pagination.total, 0)
    const before = await f.db.query('SELECT count(*)::int AS count FROM race_definitions')
    const imported = await importRacingCatalog(
      f.db,
      await readRacingSource(['seeds/racing.notion.source.json']),
    )
    assert.equal(imported.committed, true)
    const ids = new Set<string>()
    let unconfirmed = 0,
      cancelled = 0
    for (let page = 1; page <= 9; page++) {
      const result = await client.list({ page, pageSize: 100 })
      assert.equal(result.pagination.total, 848)
      assert.equal(result.data.length, page === 9 ? 48 : 100)
      for (const race of result.data) {
        assert.ok(!ids.has(race.id))
        ids.add(race.id)
        assert.equal(race.gameEnabled, false)
        if (race.scheduleStatus === 'date_unconfirmed') {
          unconfirmed++
          assert.equal(dateText(race), '일정 미확정')
        }
        if (race.scheduleStatus === 'not_run') {
          cancelled++
          assert.equal(dateText(race), '취소 / 미개최')
        }
      }
    }
    assert.equal(ids.size, 848)
    assert.equal(unconfirmed, 21)
    assert.equal(cancelled, 18)
    for (const [country, total, currency] of [
      ['KOR', 51, 'KRW'],
      ['JPN', 176, 'JPY'],
      ['USA', 621, 'USD'],
    ] as const) {
      const list = await client.list({ country, pageSize: 100 })
      assert.equal(list.pagination.total, total)
      assert.ok(list.data.every((race) => race.country === country))
      const selected = list.data.find(
        (race) => race.prizeMoney !== null && race.prizeCurrency === currency,
      )!
      const detail = await client.race(selected.id)
      assert.equal(detail.name, selected.name)
      assert.match(prizeText(detail), new RegExp(currency))
      assert.equal((await client.venue(detail.racecourseId)).racecourse.id, detail.racecourseId)
    }
    assert.equal(
      (
        await client.list({
          country: 'KOR',
          year: 2026,
          month: 9,
          grade: 'G1',
          surface: 'sand',
          racecourseId: 'RC_KOR_SEOUL',
          minDistance: 1200,
          maxDistance: 1800,
          pageSize: 100,
        })
      ).pagination.total,
      2,
    )
    assert.equal((await client.list({ search: '경주명_없음', pageSize: 100 })).pagination.total, 0)
    assert.equal((await client.venues({ pageSize: 100 })).pagination.total, 90)
    const unauthenticated = await fetch(url + '/api/racing-catalog/v1/race-schedule?pageSize=1', {
      headers: { Cookie: 'private', Authorization: 'Bearer private' },
    })
    assert.equal(unauthenticated.status, 200)
    assert.deepEqual(
      (await f.db.query('SELECT count(*)::int AS count FROM race_definitions')).rows,
      before.rows,
    )
    assert.ok(trace.every((request) => request.status === 200))
    console.log('Verified Next -> Fastify network trace:', JSON.stringify(trace))
  } finally {
    const exited = new Promise<void>((done) => next.once('exit', () => done()))
    if (next.exitCode === null) {
      next.kill('SIGTERM')
      await exited
    }
    await f.close()
  }
})
