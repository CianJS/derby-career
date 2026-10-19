import type { FastifyRequest } from 'fastify'
import type { FetchImplementation } from 'jose'
import type { Database } from '../../db'
import type { Config } from '../../config'
import { SessionAuthorization } from './sessions'
import { OidcAuthorization } from './oidc'

export type CareerAuthorization = { owner(request: FastifyRequest): Promise<string> }
export function createCareerAuthorization(
  db: Database,
  config: Config,
  jwksFetch?: FetchImplementation,
): CareerAuthorization {
  if (config.authMode === 'oidc-jwt') {
    if (!config.oidc) {
      throw new Error('OIDC authentication configuration is required')
    }
    return new OidcAuthorization(db, config.oidc, jwksFetch)
  }
  return new SessionAuthorization(db, config)
}
