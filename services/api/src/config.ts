import { z } from 'zod'
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from '../../../packages/shared/src/events'
import { directorConfigSchema } from './modules/events/schema'
export type Config = {
  databaseUrl: string
  host: string
  port: number
  nodeEnv: string
  authMode: 'disabled' | 'dev-session'
  corsOrigins: string[]
  logLevel: string
  director: DirectorConfig
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = z
    .object({
      DATABASE_URL: z.string().url(),
      HOST: z.string().default('127.0.0.1'),
      PORT: z.coerce.number().int().min(1).max(65535).default(4000),
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      AUTH_MODE: z.enum(['disabled', 'dev-session']).default('disabled'),
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
    throw new Error(
      'dev-session requires a non-production loopback-only server. Production authentication is not configured.',
    )
  }
  return {
    databaseUrl: raw.DATABASE_URL,
    host: raw.HOST,
    port: raw.PORT,
    nodeEnv: raw.NODE_ENV,
    authMode: raw.AUTH_MODE,
    corsOrigins: raw.CORS_ORIGINS.split(',').filter(Boolean),
    logLevel: raw.LOG_LEVEL,
    director: directorConfigSchema.parse(
      env.EVENT_DIRECTOR_CONFIG ? JSON.parse(env.EVENT_DIRECTOR_CONFIG) : DEFAULT_DIRECTOR_CONFIG,
    ),
  }
}
