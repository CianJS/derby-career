import pg, { type QueryResultRow } from 'pg'
export type Query = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>
}
export type Database = Query & {
  transaction<T>(fn: (tx: Query) => Promise<T>): Promise<T>
  close(): Promise<void>
}
export function postgresDatabase(
  url: string,
  options: { max?: number; attachPool?: (pool: pg.Pool) => void } = {},
): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    application_name: 'derby-career-api',
  })
  // An idle client can fail between requests (e.g. a pooled provider closes its socket).
  // Do not emit raw connection errors containing provider details or crash the warm function.
  pool.on('error', () => {
    console.error('Database idle connection unavailable')
  })
  options.attachPool?.(pool)
  return {
    query: <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) =>
      pool.query<T>(sql, values),
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}
