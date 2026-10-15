import { spawnSync } from 'node:child_process'
import { mkdirSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = resolve(root, '.e2e-artifacts/logs')
mkdirSync(directory, { recursive: true })

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
  ['git', 'diff', '--exit-code', '--stat', '--', 'seeds', 'reports'],
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
