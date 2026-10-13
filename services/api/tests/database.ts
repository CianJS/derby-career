import { PGlite } from '@electric-sql/pglite'
import type { Database, Query } from '../src/db'
import type { QueryResultRow } from 'pg'

// Embedded PostgreSQL engine for reproducible SQL tests, not an application storage fallback.
// Real concurrent connection behavior is verified separately by test:postgres in CI.
export async function embeddedDatabase(): Promise<Database> {
  const pg = new PGlite()
  await pg.waitReady
  const query: Query['query'] = async <T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => {
    if (!params.length) {
      const result = (await pg.exec(sql)).at(-1)
      return {
        rows: (result?.rows as T[]) ?? [],
        rowCount: result?.affectedRows ?? result?.rows.length ?? 0,
      }
    }
    const result = await pg.query(sql, params)
    return { rows: result.rows as T[], rowCount: result.affectedRows ?? result.rows.length }
  }
  return {
    query,
    transaction: (fn) =>
      pg.transaction(async (tx) =>
        fn({
          query: async <T extends QueryResultRow>(sql: string, params: unknown[] = []) => {
            if (!params.length) {
              const result = (await tx.exec(sql)).at(-1)
              return {
                rows: (result?.rows as T[]) ?? [],
                rowCount: result?.affectedRows ?? result?.rows.length ?? 0,
              }
            }
            const result = await tx.query(sql, params)
            return {
              rows: result.rows as T[],
              rowCount: result.affectedRows ?? result.rows.length,
            }
          },
        }),
      ),
    close: () => pg.close(),
  }
}
