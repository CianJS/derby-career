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
export function postgresDatabase(url: string): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    application_name: 'derby-career-api',
  })
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
