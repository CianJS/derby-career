import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = resolve(root, '.e2e-artifacts/logs')
mkdirSync(directory, { recursive: true })

// Source-archive checkouts may lack .git. Compare fixture bytes directly rather than
// letting `git diff seeds reports` fall back to a directory-to-directory no-index diff.
function snapshot(relative, result = new Map()) {
  for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      snapshot(path, result)
    } else {
      result.set(
        path,
        createHash('sha256')
          .update(readFileSync(resolve(root, path)))
          .digest('hex'),
      )
    }
  }
  return result
}
const before = snapshot('services/api/reports', snapshot('services/api/seeds'))

function sanitize(value) {
  let text = String(value)
  if (process.env.DATABASE_URL) {
    text = text.replaceAll(process.env.DATABASE_URL, '[database redacted]')
  }
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
    .replace(/(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[header redacted]')
}

// Keep each required command and its nonzero status visible, including before servers start.
for (const [command, ...args] of [
  ['npm', 'run', 'db:migrate'],
  ['npm', 'run', 'db:seed'],
  ['npm', 'run', 'racing:prepare'],
  ['npm', 'run', 'racing:import'],
]) {
  const result = spawnSync(command, args, {
    cwd: resolve(root, 'services/api'),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  const output = sanitize(
    `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`,
  )
  const label = `${command} ${args.join(' ')}`
  console.log(`=== ${label} ===\n${output}`)
  appendFileSync(resolve(directory, 'fixtures.log'), `${label}\n${output}\n`)
  if (result.status !== 0) {
    // Public annotations also work when the GitHub log API is unavailable.
    const message = `${label} failed (${result.status ?? result.signal}): ${output.slice(-6000)}`
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A')
    console.error(`::error::${message}`)
    process.exit(result.status ?? 1)
  }
}

const after = snapshot('services/api/reports', snapshot('services/api/seeds'))
const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
  (path) => before.get(path) !== after.get(path),
)
if (changed.length) {
  console.error(`::error::Fixture preparation changed protected files: ${changed.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`Protected fixture check: ${before.size} files unchanged (SHA-256)`)
}

// Isolated test DB only: exercise paid entry with the normal runner count and saved simulation result.
const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
if (!databaseUrl.pathname.endsWith('_test')) {
  throw new Error('Browser economy fixtures require an isolated _test database')
}
const { Client } = createRequire(import.meta.url)('../services/api/node_modules/pg')
const database = new Client({ connectionString: databaseUrl.href })
try {
  await database.connect()
  const changed = await database.query(
    'UPDATE race_definitions SET payload=payload || $2::jsonb WHERE id=$1',
    ['DEV_M3_SPRINT_1400', JSON.stringify({ entryFee: 500000 })],
  )
  if (changed.rowCount !== 1) {
    throw new Error('Paid-entry browser fixture is missing')
  }
  console.log(
    'Isolated server economy fixture: entry fee 500000; original runners and source files unchanged',
  )
} finally {
  await database.end()
}
