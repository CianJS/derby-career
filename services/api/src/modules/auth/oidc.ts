import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { createRemoteJWKSet, customFetch, errors, jwtVerify, type FetchImplementation } from 'jose'
import type { OidcConfig } from '../../config'
import type { Database } from '../../db'
import { ApiError } from '../../errors'
import { digest } from '../../services/identity'

const INVALID_TOKEN_CODES = new Set([
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_INVALID',
])
const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', '유효한 로그인 토큰이 필요합니다.')

export class OidcAuthorization {
  private keys: ReturnType<typeof createRemoteJWKSet>
  constructor(
    private db: Database,
    private config: OidcConfig,
    fetcher?: FetchImplementation,
  ) {
    this.keys = createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 2000,
      cacheMaxAge: 300000,
      cooldownDuration: 30000,
      [customFetch]: fetcher,
    })
  }
  async owner(request: FastifyRequest): Promise<string> {
    const header = request.headers.authorization
    const token =
      header && header.length <= 8192
        ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header)?.[1]
        : undefined
    if (!token) {
      throw unauthorized()
    }
    let subject: string
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        algorithms: ['RS256', 'ES256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
        typ: this.config.tokenType,
        requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp'],
        maxTokenAge: this.config.maxTokenAgeSeconds,
        clockTolerance: 5,
      })
      if (
        typeof payload.sub !== 'string' ||
        !payload.sub.length ||
        payload.sub.length > 255 ||
        !Number.isFinite(payload.iat) ||
        !Number.isFinite(payload.exp)
      ) {
        throw unauthorized()
      }
      // Never use email, a client ownerId or token bytes as a persisted security identity.
      subject = digest({ issuer: this.config.issuer, subject: payload.sub })
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      if (error instanceof errors.JOSEError && INVALID_TOKEN_CODES.has(error.code)) {
        throw unauthorized()
      }
      // An unavailable or malformed trusted key source is distinct from an invalid credential.
      throw new ApiError(
        503,
        'AUTH_PROVIDER_UNAVAILABLE',
        '로그인 인증 서비스를 확인할 수 없습니다.',
      )
    }
    const principal = (
      await this.db.query<{ id: string }>(
        "INSERT INTO principals(id,provider,subject) VALUES($1,'external',$2) ON CONFLICT(provider,subject) DO UPDATE SET subject=EXCLUDED.subject RETURNING id",
        [randomUUID(), subject],
      )
    ).rows[0]
    return principal.id
  }
}
