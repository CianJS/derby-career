import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { verifyPublicCatalog } from '../scripts/catalog-smoke.mjs'
import { postgresDatabase } from '../src/db'

const databaseUrl = process.env.TEST_DATABASE_URL
test(
  'relocated production bundle serves PostgreSQL catalog without source paths, fixtures or private access',
  {
    skip: !databaseUrl,
    timeout: 90000,
  },
  async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) {
      throw new Error('An isolated *_test database with migrations and racing:import is required')
    }
    const db = postgresDatabase(databaseUrl)
    try {
      for (const table of [
        'horse_definitions',
        'jockey_definitions',
        'race_definitions',
        'event_definitions',
        'careers',
        'sessions',
        'race_runs',
      ]) {
        assert.equal(
          Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n),
          0,
          table,
        )
      }
      assert.equal(
        Number((await db.query('SELECT count(*) n FROM racecourse_courses')).rows[0].n),
        101,
      )
    } finally {
      await db.close()
    }
    const directory = await mkdtemp(join(tmpdir(), 'derby-function-build-'))
    try {
      await cp('.vercel/output/functions/api.func', directory, { recursive: true })
      const metadata = JSON.parse(await readFile(join(directory, '.vc-config.json'), 'utf8'))
      assert.equal(metadata.shouldAddHelpers, false)
      assert.equal(metadata.runtime, 'nodejs24.x')
      assert.equal(
        await readFile(join(directory, 'dist/openapi.yaml'), 'utf8'),
        await readFile('../../contracts/openapi.yaml', 'utf8'),
      )
      const runner = `
      import { createServer } from 'node:http';
      import handler from ${JSON.stringify(pathToFileURL(join(directory, metadata.handler)).href)};
      const server = createServer((req,res)=>{ void handler(req,res).catch(()=>res.destroy()); });
      server.listen(0,'127.0.0.1',()=>console.log('PORT='+server.address().port));
    `
      const child = spawn(process.execPath, ['--input-type=module', '-e', runner], {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: databaseUrl,
          NODE_ENV: 'production',
          AUTH_MODE: 'disabled',
          LOG_LEVEL: 'silent',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      try {
        const port = await new Promise<string>((resolvePort, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Function harness startup timed out')),
            20000,
          )
          child.once('error', reject)
          child.once('exit', () => reject(new Error('Function harness exited before readiness')))
          child.stdout.on('data', (data: Buffer) => {
            const match = data.toString().match(/PORT=(\d+)/)
            if (match) {
              clearTimeout(timeout)
              resolvePort(match[1])
            }
          })
        })
        assert.equal((await verifyPublicCatalog(`http://127.0.0.1:${port}`)).races, 848)
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
          child.kill('SIGTERM')
          await exited
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
