import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
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
const children = []
const streams = []
const startedAt = new Date().toISOString()
let stopping = false
let interrupted = false

// Only public, anonymous fixture traffic is recorded. Never copy the process environment.
function sanitize(value) {
  let text = String(value)
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
  const record = { name, child, exited: false, code: null, error: null }
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
    if (server.exited || server.error) {
      throw new Error(`${server.name} exited unexpectedly (${server.code}): ${server.error ?? ''}`)
    }
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
let exitCode = 1
try {
  start('api', ['dist/server.js'], resolve(root, 'services/api'), {
    ...process.env,
    NODE_ENV: 'production',
    AUTH_MODE: 'disabled',
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: '4000',
  })
  await ready(`${apiUrl}/health/ready`)
  await ready(`${apiUrl}/v1/race-schedule?pageSize=1`, 851)
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
  await ready(`${nextUrl}/api/racing-catalog/v1/race-schedule?pageSize=1`, 851)
  const test = start('playwright', ['node_modules/@playwright/test/cli.js', 'test'], root, {
    ...process.env,
    E2E_BASE_URL: nextUrl,
    E2E_API_URL: apiUrl,
  })
  while (!test.exited) {
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
