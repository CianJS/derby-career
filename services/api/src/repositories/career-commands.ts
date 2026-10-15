import type { Database, Query } from '../db'
import { ApiError, conflict } from '../errors'
import { digest } from '../services/identity'
import { readCareerRow } from './career-rows'

const REQUEST_ID_CONSTRAINTS = new Set(['careers_pkey', 'monthly_actions_pkey', 'race_runs_pkey'])

type CommandReceipt<T> = {
  operation: string
  request_hash: string
  career_id: string | null
  response: T
}

export async function executeCareerCommand<T>(
  db: Database,
  owner: string,
  id: string,
  operation: string,
  body: unknown,
  careerId: string | null,
  fn: (tx: Query) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      // All commands for an owner lock the same principal first: stable funds, month and replay are atomic.
      // This also makes retries with a different action ID serialize before checking the monthly unique key.
      if (
        !(await tx.query('SELECT id FROM principals WHERE id=$1 FOR UPDATE', [owner])).rows.length
      ) {
        throw new ApiError(401, 'UNAUTHORIZED', '유효한 세션이 필요합니다.')
      }
      if (careerId) {
        await readCareerRow(tx, owner, careerId)
      }
      const hash = digest({ operation, careerId, body })
      const existing = (
        await tx.query<CommandReceipt<T>>(
          'SELECT * FROM commands WHERE principal_id=$1 AND request_id=$2',
          [owner, id],
        )
      ).rows[0]
      if (existing) {
        if (
          existing.operation !== operation ||
          existing.request_hash !== hash ||
          existing.career_id !== careerId
        ) {
          throw conflict('동일한 요청 ID를 다른 요청에 사용할 수 없습니다.')
        }
        return existing.response
      }
      const response = await fn(tx)
      await tx.query(
        'INSERT INTO commands(principal_id,request_id,operation,career_id,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)',
        [owner, id, operation, careerId, hash, JSON.stringify(response)],
      )
      return response
    })
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      typeof error.constraint === 'string' &&
      REQUEST_ID_CONSTRAINTS.has(error.constraint)
    ) {
      throw conflict('요청 ID가 이미 사용 중입니다. 새 요청 ID로 다시 시도해 주세요.')
    }
    throw error
  }
}
