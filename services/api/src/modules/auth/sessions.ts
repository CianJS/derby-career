import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Database } from '../../db'
import type { Config } from '../../config'
import { ApiError } from '../../errors'
import { tokenHash } from '../../services/identity'

export async function createDevelopmentSession(db: Database, subject: string, ttlHours=8) {
  if (!subject||!Number.isInteger(ttlHours)||ttlHours<1||ttlHours>24) throw new Error('Session TTL must be 1..24 hours')
  const token=randomBytes(32).toString('base64url')
  const expiresAt=new Date(Date.now()+ttlHours*3600000).toISOString()
  const principalId=await db.transaction(async tx=>{
    const principal=(await tx.query("INSERT INTO principals(id,provider,subject) VALUES($1,'development',$2) ON CONFLICT(provider,subject) DO UPDATE SET subject=EXCLUDED.subject RETURNING id",[randomUUID(),subject])).rows[0].id as string
    await tx.query('INSERT INTO sessions(token_hash,principal_id,expires_at) VALUES($1,$2,$3)',[tokenHash(token),principal,expiresAt])
    return principal
  })
  return {principalId,token,expiresAt}
}
export async function revokeSession(db: Database, token: string) {
  await db.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(token)])
}
export class SessionAuthorization {
  constructor(private db: Database, private config: Config) {}
  async owner(request: FastifyRequest): Promise<string> {
    if (this.config.authMode==='disabled') throw new ApiError(503,'AUTH_NOT_CONFIGURED','Career API는 인증 정책이 구성될 때까지 비활성화되어 있습니다.')
    if (this.config.nodeEnv==='production'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip)) throw new ApiError(403,'FORBIDDEN','개발용 세션은 로컬 개발에서만 사용할 수 있습니다.')
    const header=request.headers.authorization
    if (!header||!/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new ApiError(401,'UNAUTHORIZED','유효한 세션이 필요합니다.')
    const result=await this.db.query("SELECT s.principal_id FROM sessions s JOIN principals p ON p.id=s.principal_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND p.provider='development'",[tokenHash(header.slice(7))])
    if (!result.rows.length) throw new ApiError(401,'UNAUTHORIZED','세션이 만료되었거나 유효하지 않습니다.')
    return result.rows[0].principal_id
  }
}
