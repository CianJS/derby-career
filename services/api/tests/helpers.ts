import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { migrate } from '../src/services/migrations'
import { seedDevelopmentCatalog } from '../src/services/seed'
import { createDevelopmentSession } from '../src/modules/auth/sessions'
import { createApp } from '../src/app'
import { readConfig } from '../src/config'
import { embeddedDatabase } from './database'
import type { Database } from '../src/db'
export async function fixture(
  options: {
    probability?: number
    share?: number
    db?: Database
    migrationsDirectory?: string
  } = {},
) {
  const db = options.db ?? (await embeddedDatabase())
  try {
    await migrate(db, options.migrationsDirectory)
    await seedDevelopmentCatalog(db)
  } catch (error) {
    await db.close()
    throw error
  }
  const user = await createDevelopmentSession(db, 'test-owner-' + randomUUID())
  const other = await createDevelopmentSession(db, 'other-owner-' + randomUUID())
  const config = readConfig({
    DATABASE_URL: 'postgresql://test/test',
    AUTH_MODE: 'dev-session',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    EVENT_DIRECTOR_CONFIG: JSON.stringify({
      version: 'event-director-v1',
      monthlyProbability: options.probability ?? 0,
      pityAfterMisses: 3,
      monthStartShare: options.share ?? 1,
    }),
  })
  const app = await createApp(db, config)
  await app.ready()
  const call = async (method: 'GET' | 'POST', url: string, payload?: unknown, token = user.token) =>
    app.inject({
      method,
      url,
      payload: payload as Record<string, unknown> | undefined,
      headers: { authorization: `Bearer ${token}` },
    })
  const create = async () => {
    const id = randomUUID()
    const result = await call('POST', '/v1/careers', {
      careerId: id,
      horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
    })
    assert.equal(result.statusCode, 201, result.body)
    return { id, response: result.json() }
  }
  return { db, app, config, call, create, user, other, close: () => app.close() }
}
export async function catalogSource(): Promise<{ rows: Record<string, string>[] }> {
  return JSON.parse(await readFile('seeds/events.import.json', 'utf8'))
}
