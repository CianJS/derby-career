import { readDeploymentConfig } from '../src/vercel'
import { postgresDatabase } from '../src/db'
import { migrate } from '../src/services/migrations'
import { importRacingCatalog, readRacingSource } from '../src/modules/racing/import'

// Explicit operator action only; this file is never imported by the function/build.
// Keep privileged direct connections separate from the pooled runtime DATABASE_URL.
async function main() {
  const command = process.argv[2]
  if (!['migrate', 'import-racing'].includes(command)) {
    throw new Error('Unsupported deployment DB command')
  }
  const { config } = readDeploymentConfig({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL_UNPOOLED,
  })
  const db = postgresDatabase(config.databaseUrl, { max: 1 })
  try {
    if (command === 'migrate') {
      return { applied: await migrate(db) }
    }
    const report = await importRacingCatalog(
      db,
      await readRacingSource(['seeds/racing.notion.source.json']),
    )
    if (!report.committed) {
      throw new Error('Reference import failed')
    }
    return report
  } finally {
    await db.close()
  }
}

try {
  console.log(JSON.stringify(await main()))
} catch {
  // The underlying parser/driver may include connection URLs in its message or stack.
  console.error(
    JSON.stringify({
      committed: false,
      error: 'Deployment DB command failed; check command, direct connection and migrations',
    }),
  )
  process.exitCode = 1
}
