import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import {
  validateRaceScheduleList,
  validateRacecourseList,
} from '../../../packages/shared/src/generated/save-validation.mjs'

// Read-only: no migration, import, session, credentials or game mutation.
export async function verifyPublicCatalog(baseUrl, fetcher = fetch) {
  const base = new URL(baseUrl)
  assert.ok(
    ['https:', 'http:'].includes(base.protocol) &&
      !base.username &&
      !base.password &&
      !base.search &&
      !base.hash &&
      base.pathname === '/',
    'API_BASE_URL must be an HTTP(S) origin without credentials, path or query',
  )
  async function get(path, status, validate) {
    const response = await fetcher(new URL(path, base), {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
    })
    assert.equal(response.status, status, `Unexpected HTTP status: ${path}`)
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/)
    const value = await response.json()
    if (validate) {
      assert.ok(validate(value), `Response does not match generated contract: ${path}`)
    }
    return value
  }
  assert.equal((await get('/health/ready', 200)).status, 'ready')
  const races = []
  for (let page = 1; page <= 9; page++) {
    const result = await get(
      `/v1/race-schedule?page=${page}&pageSize=100`,
      200,
      validateRaceScheduleList,
    )
    assert.equal(result.pagination.total, 851)
    assert.equal(result.pagination.page, page)
    assert.equal(result.data.length, page === 9 ? 51 : 100)
    races.push(...result.data)
  }
  assert.equal(new Set(races.map((r) => r.id)).size, 851)
  assert.ok(races.every((r) => !r.gameEnabled && r.entryEligibility === 'not_evaluated'))
  assert.equal(races.filter((r) => r.raceDate === null).length, 41)
  const countries = { KOR: 51, JPN: 176, USA: 624 }
  for (const [country, count] of Object.entries(countries)) {
    const result = await get(
      `/v1/race-schedule?country=${country}&year=2026&pageSize=100`,
      200,
      validateRaceScheduleList,
    )
    assert.equal(result.pagination.total, count)
    assert.equal(races.filter((r) => r.country === country).length, count)
  }
  const venues = await get('/v1/racecourses?pageSize=100', 200, validateRacecourseList)
  assert.equal(venues.pagination.total, 90)
  assert.equal(new Set(venues.data.map((r) => r.id)).size, 90)
  assert.ok(venues.data.every((r) => !r.gameEnabled))
  assert.equal((await get('/v1/careers', 503)).error.code, 'AUTH_NOT_CONFIGURED')
  assert.equal((await get('/v1/careers/workspace', 503)).error.code, 'AUTH_NOT_CONFIGURED')
  assert.equal((await get('/v1/race-schedule?page=0', 400)).error.code, 'VALIDATION_ERROR')
  return { races: races.length, countries, racecourses: venues.data.length, privateApi: 'disabled' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(
      JSON.stringify(
        await verifyPublicCatalog(process.env.API_BASE_URL ?? 'http://127.0.0.1:4000'),
      ),
    )
  } catch {
    // Fetch/Zod errors and third-party HTML can include sensitive deployment information.
    console.error(
      'Public catalog verification failed; check readiness, counts and response contract',
    )
    process.exitCode = 1
  }
}
