import { readFile } from 'node:fs/promises'
import { readConfig } from './config'
import { postgresDatabase } from './db'
import { migrate } from './services/migrations'
import { seedDevelopmentCatalog } from './services/seed'
import { importEvents, readEventSource } from './modules/events/import'
import { createDevelopmentSession, revokeSession } from './modules/auth/sessions'
const config = readConfig()
const db = postgresDatabase(config.databaseUrl)
try {
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case 'migrate':
      console.log(JSON.stringify({ applied: await migrate(db) }))
      break
    case 'seed':
      if (config.nodeEnv === 'production') {
        throw new Error(
          'Development fixtures cannot be seeded in production. Use import-events separately.',
        )
      }
      console.log(JSON.stringify(await seedDevelopmentCatalog(db)))
      break
    case 'import-events': {
      const file = args[0] ?? 'seeds/events.catalog.json'
      console.log(
        JSON.stringify(
          await importEvents(
            db,
            readEventSource(await readFile(file, 'utf8'), file.endsWith('.csv') ? 'csv' : 'json'),
          ),
        ),
      )
      break
    }
    case 'session-create':
      if (config.authMode !== 'dev-session' || config.nodeEnv === 'production') {
        throw new Error('Set AUTH_MODE=dev-session for a local development session')
      }
      console.log(
        JSON.stringify(
          await createDevelopmentSession(db, args[0] ?? 'local-developer', Number(args[1] ?? 8)),
        ),
      )
      break
    case 'session-revoke':
      if (config.authMode !== 'dev-session' || config.nodeEnv === 'production') {
        throw new Error('Development only')
      }
      if (!process.env.DEV_SESSION_TOKEN) {
        throw new Error('DEV_SESSION_TOKEN is required; avoid putting a token in shell arguments')
      }
      await revokeSession(db, process.env.DEV_SESSION_TOKEN)
      console.log('Session revoked')
      break
    default:
      throw new Error(
        'Commands: migrate, seed, import-events [file], session-create [subject] [ttlHours], session-revoke',
      )
  }
} finally {
  await db.close()
}
