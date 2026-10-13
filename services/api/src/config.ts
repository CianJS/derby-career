import { z } from 'zod'
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from '../../../packages/shared/src/events'
import { directorConfigSchema } from './modules/events/schema'
export type Config = {
  databaseUrl: string
  host: string
  port: number
  nodeEnv: string
  authMode: 'disabled' | 'dev-session' | 'oidc-jwt'
  oidc: OidcConfig | null
  corsOrigins: string[]
  logLevel: string
  director: DirectorConfig
}
export type OidcConfig = {
  issuer: string
  audience: string
  jwksUrl: string
  tokenType: 'at+jwt' | 'JWT'
  maxTokenAgeSeconds: number
}
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash
    } catch {
      return false
    }
  }, 'A trusted HTTPS URL without credentials or a fragment is required')
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = z
    .object({
      DATABASE_URL: z.string().url(),
      HOST: z.string().default('127.0.0.1'),
      PORT: z.coerce.number().int().min(1).max(65535).default(4000),
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      AUTH_MODE: z.enum(['disabled', 'dev-session', 'oidc-jwt']).default('disabled'),
      CORS_ORIGINS: z.string().default('http://localhost:3000'),
      LOG_LEVEL: z
        .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
        .default('info'),
    })
    .parse(env)
  if (
    raw.AUTH_MODE === 'dev-session' &&
    (raw.NODE_ENV === 'production' || !['127.0.0.1', '::1', 'localhost'].includes(raw.HOST))
  ) {
    throw new Error('dev-session requires a non-production loopback-only server.')
  }
  const oidc =
    raw.AUTH_MODE === 'oidc-jwt'
      ? z
          .object({
            issuer: httpsUrl.refine(
              (value) => !value.includes('?'),
              'Issuer must not contain a query',
            ),
            audience: z.string().min(1).max(256),
            jwksUrl: httpsUrl,
            tokenType: z.enum(['at+jwt', 'JWT']).default('at+jwt'),
            maxTokenAgeSeconds: z.coerce.number().int().min(60).max(3600).default(3600),
          })
          .parse({
            issuer: env.OIDC_ISSUER,
            audience: env.OIDC_AUDIENCE,
            jwksUrl: env.OIDC_JWKS_URL,
            tokenType: env.OIDC_TOKEN_TYPE,
            maxTokenAgeSeconds: env.OIDC_MAX_TOKEN_AGE_SECONDS,
          })
      : null
  return {
    databaseUrl: raw.DATABASE_URL,
    host: raw.HOST,
    port: raw.PORT,
    nodeEnv: raw.NODE_ENV,
    authMode: raw.AUTH_MODE,
    oidc,
    corsOrigins: raw.CORS_ORIGINS.split(',').filter(Boolean),
    logLevel: raw.LOG_LEVEL,
    director: directorConfigSchema.parse(
      env.EVENT_DIRECTOR_CONFIG ? JSON.parse(env.EVENT_DIRECTOR_CONFIG) : DEFAULT_DIRECTOR_CONFIG,
    ),
  }
}
