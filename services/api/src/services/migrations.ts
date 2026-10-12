import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Database } from '../db'

// One migration mechanism: versioned SQL, transactional and checksum-locked.
export async function migrate(db: Database, directory = resolve('migrations')) {
  return db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(182946,1)")
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = new Map((await tx.query('SELECT name,checksum FROM schema_migrations')).rows.map(x => [x.name, x.checksum]))
    const files = (await readdir(directory)).filter(x => /^\d+_[a-z0-9_-]+\.sql$/.test(x)).sort()
    const completed: string[] = []
    for (const name of files) {
      const sql = await readFile(resolve(directory, name), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) throw new Error(`Applied migration changed: ${name}. Add a new migration instead.`)
        continue
      }
      await tx.query(sql)
      await tx.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name,checksum])
      completed.push(name)
    }
    return completed
  })
}
