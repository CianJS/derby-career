import { spawn, spawnSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = resolve(root, '.e2e-artifacts')
const databaseUrl = process.env.DATABASE_URL
const database = new URL(databaseUrl ?? 'postgresql://invalid/invalid')
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['postgres', 'localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
  !database.pathname.endsWith('_test')
) {
  throw new Error('DATABASE_URL must point to an ephemeral local PostgreSQL *_test database')
}
const apiUrl = 'http://127.0.0.1:4000'
const nextUrl = 'http://127.0.0.1:3000'
const controlDir = resolve(artifacts, 'control')
const apiEnv = {
  ...process.env,
  NODE_ENV: 'production',
  AUTH_MODE: 'disabled',
  LOG_LEVEL: 'silent',
  HOST: '127.0.0.1',
  PORT: '4000',
}
let api
let devToken
let apiStarts = 0
let controlId = null
const children = []
const streams = []
const startedAt = new Date().toISOString()
let stopping = false
let interrupted = false

// Only public, anonymous fixture traffic is recorded. Never copy the process environment.
function sanitize(value) {
  let text = String(value)
  if (devToken) {
    text = text.replaceAll(devToken, '[test session redacted]')
  }
  if (databaseUrl) {
    text = text.replaceAll(databaseUrl, '[database redacted]')
  }
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
    .replace(/(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[header redacted]')
}

function start(name, args, cwd, env) {
  const log = createWriteStream(resolve(artifacts, 'logs', `${name}.log`))
  streams.push(log)
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const record = { name, child, exited: false, code: null, error: null, expectedExit: false }
  children.push(record)
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    let pending = ''
    stream.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const safe = sanitize(line) + '\n'
        log.write(safe)
        process.stdout.write(`[${name}] ${safe}`)
      }
    })
    stream.on('end', () => {
      if (pending) {
        log.write(sanitize(pending) + '\n')
      }
    })
  }
  child.on('error', (error) => {
    record.error = sanitize(error.message)
  })
  child.on('close', (code) => {
    record.exited = true
    record.code = code
  })
  return record
}

function assertServers() {
  if (interrupted) {
    throw new Error('E2E interrupted')
  }
  for (const server of children.filter((child) => child.name !== 'playwright')) {
    if (!server.expectedExit && (server.exited || server.error)) {
      throw new Error(`${server.name} exited unexpectedly (${server.code}): ${server.error ?? ''}`)
    }
  }
}

function startApi() {
  api = start(`api-${++apiStarts}`, ['dist/server.js'], resolve(root, 'services/api'), apiEnv)
}

// A file mailbox shared only with the spawned QA process, never an application endpoint.
// Only this runner's anonymous fixture API can be stopped; PostgreSQL and original rows stay intact.
async function controlApi() {
  let command
  try {
    command = JSON.parse(await readFile(resolve(controlDir, 'request.json'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      return
    }
    throw error
  }
  if (command.id === controlId) {
    return
  }
  controlId = command.id
  try {
    if (command.action === 'stop') {
      api.expectedExit = true
      // Simulate an abrupt outage of this runner's read-only anonymous fixture API.
      // SIGTERM can wait for pooled keep-alive connections across serial scenarios.
      api.child.kill('SIGKILL')
      const deadline = Date.now() + 5000
      while (!api.exited && Date.now() < deadline) {
        await delay(50)
      }
      if (!api.exited) {
        throw new Error('QA API did not stop')
      }
    } else if (command.action === 'start') {
      if (!api.exited) {
        throw new Error('QA API is already running')
      }
      startApi()
      await ready(`${apiUrl}/health/ready`)
    } else {
      throw new Error('Unsupported QA control action')
    }
    await writeFile(
      resolve(controlDir, 'response.json'),
      JSON.stringify({ id: controlId, ok: true }),
    )
  } catch (error) {
    await writeFile(
      resolve(controlDir, 'response.json'),
      JSON.stringify({ id: controlId, ok: false, error: sanitize(error.message) }),
    )
    throw error
  }
}

async function ready(path, expectedTotal) {
  const deadline = Date.now() + 60_000
  let last = 'not started'
  while (Date.now() < deadline) {
    assertServers()
    try {
      const response = await fetch(path, { signal: AbortSignal.timeout(2000) })
      last = `HTTP ${response.status}`
      if (response.ok) {
        if (expectedTotal === undefined) {
          console.log(`Ready: ${path} (HTTP ${response.status})`)
          return
        }
        const body = await response.json()
        last += ` total=${body.pagination?.total}`
        if (body.pagination?.total === expectedTotal) {
          console.log(`Ready: ${path} (${last})`)
          return
        }
      }
    } catch (error) {
      last = sanitize(error.message)
    }
    await delay(500)
  }
  throw new Error(`Readiness failed: ${path}: ${last}`)
}

async function stop() {
  stopping = true
  for (const { child, exited } of children.toReversed()) {
    if (!exited) {
      child.kill('SIGTERM')
    }
  }
  const deadline = Date.now() + 5000
  while (children.some((child) => !child.exited) && Date.now() < deadline) {
    await delay(100)
  }
  for (const { child, exited } of children) {
    if (!exited) {
      child.kill('SIGKILL')
    }
  }
  for (const stream of streams) {
    stream.end()
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true
    if (!stopping) {
      for (const { child } of children) {
        child.kill('SIGTERM')
      }
    }
  })
}

await mkdir(resolve(artifacts, 'logs'), { recursive: true })
await mkdir(controlDir, { recursive: true })
let exitCode = 1
try {
  startApi()
  await ready(`${apiUrl}/health/ready`)
  await ready(`${apiUrl}/v1/race-schedule?pageSize=1`, 848)
  start(
    'next',
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3000'],
    root,
    {
      ...process.env,
      NODE_ENV: 'production',
      DERBY_API_URL: apiUrl,
    },
  )
  await ready(`${nextUrl}/api/racing-catalog/v1/race-schedule?pageSize=1`, 848)
  // Separate loopback development services exercise the existing dev-session bridge.
  // Session stdout stays in memory and is never an artifact or a browser credential.
  const devEnv = {
    ...process.env,
    NODE_ENV: 'development',
    AUTH_MODE: 'dev-session',
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: '4001',
    EVENT_DIRECTOR_CONFIG: JSON.stringify({
      version: 'event-director-v1',
      monthlyProbability: 0,
      pityAfterMisses: 100,
      monthStartShare: 1,
    }),
  }
  const session = spawnSync(
    process.execPath,
    ['dist/cli.js', 'session-create', 'frontend-browser-qa', '1'],
    { cwd: resolve(root, 'services/api'), env: devEnv, encoding: 'utf8', timeout: 30000 },
  )
  if (session.status !== 0) {
    throw new Error('Could not prepare isolated development test session')
  }
  try {
    const sessionData = JSON.parse(session.stdout)
    devToken = sessionData.token
    if (typeof devToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(devToken)) {
      throw new Error()
    }
    // These existing browser regressions restore a pre-starter stable, not a new
    // onboarding flow. The runner above permits only an ephemeral local *_test DB.
    const { Client } = createRequire(import.meta.url)('../services/api/node_modules/pg')
    const legacy = new Client({ connectionString: databaseUrl })
    try {
      await legacy.connect()
      await legacy.query('BEGIN')
      const stable = (await legacy.query('SELECT id FROM stables WHERE owner_id=$1', [sessionData.principalId])).rows[0]
      if (!stable) {
        const id = randomUUID()
        await legacy.query('INSERT INTO stables(id,owner_id) VALUES($1,$2)', [id, sessionData.principalId])
        // The catalog's historical subset is selected by the exact saved IDs,
        // and exists exclusively as an explicit old-save test fixture.
        for (const jockeyId of ['HAN_DOYUN', 'SEO_JIAN', 'YOON_TAESUNG']) {
          await legacy.query('INSERT INTO jockey_contracts(stable_id,jockey_id) VALUES($1,$2)', [id, jockeyId])
        }
      }
      await legacy.query('COMMIT')
    } catch (error) {
      await legacy.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      await legacy.end()
    }
  } catch {
    throw new Error('Could not read isolated development test session')
  }
  start('api-dev-save', ['dist/server.js'], resolve(root, 'services/api'), devEnv)
  await ready('http://127.0.0.1:4001/health/ready')
  start(
    'next-dev-save',
    ['node_modules/next/dist/bin/next', 'dev', '-H', '127.0.0.1', '-p', '3001'],
    root,
    {
      ...process.env,
      NODE_ENV: 'development',
      DERBY_SAVE_MODE: 'server',
      DERBY_SERVER_SAVE_LOCAL: '1',
      DERBY_API_URL: 'http://127.0.0.1:4001',
      DERBY_API_DEV_SESSION_TOKEN: devToken,
    },
  )
  await ready('http://127.0.0.1:3001/api/server-save/v1/catalog/horses')
  await ready('http://127.0.0.1:3001/')
  const test = start('playwright', ['node_modules/@playwright/test/cli.js', 'test'], root, {
    ...process.env,
    E2E_BASE_URL: nextUrl,
    E2E_SERVER_BASE_URL: 'http://127.0.0.1:3001',
    E2E_API_URL: apiUrl,
    E2E_API_CONTROL_DIR: controlDir,
  })
  while (!test.exited) {
    await controlApi()
    assertServers()
    if (test.error) {
      throw new Error(test.error)
    }
    await delay(100)
  }
  assertServers()
  exitCode = test.code ?? 1
} catch (error) {
  console.error(sanitize(error.stack ?? error.message))
} finally {
  await stop()
  await writeFile(
    resolve(artifacts, 'run.json'),
    JSON.stringify(
      { startedAt, finishedAt: new Date().toISOString(), exitCode, node: process.version },
      null,
      2,
    ),
  )
}
process.exitCode = exitCode
