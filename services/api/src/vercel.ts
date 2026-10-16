import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { attachDatabasePool } from '@vercel/functions'
import { z } from 'zod'
import { createApp } from './app'
import { readConfig } from './config'
import { postgresDatabase } from './db'

// This deployment is intentionally public-catalog-only, including Preview builds.
// A project setting cannot enable development sessions or private save commands here.
export function readDeploymentConfig(env: NodeJS.ProcessEnv = process.env) {
  const deployment = z
    .object({
      DATABASE_URL: z
        .string()
        .url()
        .refine((value) => /^postgres(?:ql)?:/.test(value)),
      AUTH_MODE: z.literal('disabled').default('disabled'),
      DB_POOL_MAX: z.coerce.number().int().min(1).max(10).default(3),
    })
    .parse(env)
  return {
    config: readConfig({ ...env, AUTH_MODE: deployment.AUTH_MODE, NODE_ENV: 'production' }),
    poolMax: deployment.DB_POOL_MAX,
  }
}

export async function bootstrapPublicApp(
  env: NodeJS.ProcessEnv = process.env,
  contractPath: string | URL = new URL('./openapi.yaml', import.meta.url),
) {
  const { config, poolMax } = readDeploymentConfig(env)
  const db = postgresDatabase(config.databaseUrl, { max: poolMax, attachPool: attachDatabasePool })
  try {
    const app = await createApp(db, config, { contractPath, logErrorDetails: false })
    await app.ready()
    return app
  } catch (error) {
    await db.close()
    throw error
  }
}

export function createFunctionHandler(
  bootstrap: () => Promise<FastifyInstance> = bootstrapPublicApp,
) {
  let boot: Promise<FastifyInstance> | undefined
  return async (req: IncomingMessage, res: ServerResponse) => {
    let app: FastifyInstance
    try {
      // All concurrent cold-start requests share one app and pool; no listen() or per-request close().
      boot ??= bootstrap().catch((error: unknown) => {
        boot = undefined
        throw error
      })
      app = await boot
    } catch {
      // Never serialize Zod input, DATABASE_URL, pool errors or stack traces to response/logs.
      console.error('Public API initialization unavailable; check deployment configuration')
      res.writeHead(503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(
        JSON.stringify({
          error: {
            code: 'API_NOT_CONFIGURED',
            message: 'API 배포 설정을 확인해 주세요.',
            requestId: randomUUID(),
          },
        }),
      )
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    // Use the real Node request stream, preserving query, body limits and Fastify validation.
    // Keep the invocation alive until response completion (or client disconnect).
    await new Promise<void>((resolve) => {
      const done = () => {
        res.off('finish', done)
        res.off('close', done)
        resolve()
      }
      res.once('finish', done)
      res.once('close', done)
      app.server.emit('request', req, res)
    })
  }
}

export default createFunctionHandler()
