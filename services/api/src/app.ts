import Fastify, { type FastifyError } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import type { Database } from './db'
import type { Config } from './config'
import type { FetchImplementation } from 'jose'
import { readContract, routeSchema } from './contracts'
import { EventRepository } from './repositories/events'
import { CareerRepository } from './repositories/careers'
import { createCareerAuthorization } from './modules/auth/authorization'
import { eventRoutes } from './routes/events'
import { careerRoutes } from './routes/careers'
import { ApiError } from './errors'

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'INVALID_REQUEST',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
}
const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: '요청 본문을 확인해 주세요.',
  413: '요청 본문이 허용된 크기를 초과했습니다.',
  415: '지원하지 않는 요청 본문 형식입니다.',
  429: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
}

export async function createApp(
  db: Database,
  config: Config,
  options: { jwksFetch?: FetchImplementation } = {},
) {
  if (
    config.authMode === 'dev-session' &&
    (config.nodeEnv === 'production' || !['127.0.0.1', '::1', 'localhost'].includes(config.host))
  ) {
    throw new Error('Development sessions require local non-production use')
  }
  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
          },
    trustProxy: false,
    bodyLimit: 16384,
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
    requestTimeout: 15000,
  })
  const spec = await readContract()
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof ApiError
    const fastifyError = error as FastifyError
    const validation = !!fastifyError.validation
    const status = known
      ? error.status
      : validation
        ? 400
        : fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500
          ? fastifyError.statusCode
          : 500
    if (status >= 500 && (!known || status !== 503)) {
      request.log.error({ err: error }, 'API request failed')
    }
    if (status === 401) {
      reply.header('WWW-Authenticate', 'Bearer')
    }
    reply.code(status).send({
      error: {
        code: known
          ? error.code
          : validation
            ? 'VALIDATION_ERROR'
            : (CLIENT_ERROR_CODES[status] ?? 'INTERNAL_ERROR'),
        message: known
          ? error.message
          : validation
            ? '요청 구조가 API 계약과 일치하지 않습니다.'
            : (CLIENT_ERROR_MESSAGES[status] ?? '서버에서 요청을 처리하지 못했습니다.'),
        requestId: request.id,
      },
    })
  })
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: '요청한 리소스를 찾을 수 없습니다.',
        requestId: request.id,
      },
    }),
  )
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'OPTIONS'],
  })
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' })
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin && !config.corsOrigins.includes(request.headers.origin)) {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: '허용되지 않은 요청 출처입니다.',
          requestId: request.id,
        },
      })
    }
  })
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/v1/careers')) {
      reply.header('Cache-Control', 'no-store')
    }
    reply.header('X-Content-Type-Options', 'nosniff')
  })
  app.get('/health/live', { schema: routeSchema(spec, '/health/live', 'get') }, async () => ({
    status: 'ok',
  }))
  app.get('/health/ready', { schema: routeSchema(spec, '/health/ready', 'get') }, async () => {
    try {
      const result = await db.query(
        "SELECT name FROM schema_migrations WHERE name IN ('001_foundation.sql','002_history_guards.sql','003_exact_race_log_json.sql')",
      )
      if (result.rows.length !== 3) {
        throw new Error('Migration missing')
      }
      return { status: 'ready' }
    } catch {
      throw new ApiError(
        503,
        'DATABASE_UNAVAILABLE',
        '데이터베이스 연결 또는 마이그레이션이 필요합니다.',
      )
    }
  })
  for (const [name, table] of [
    ['horses', 'horse_definitions'],
    ['jockeys', 'jockey_definitions'],
    ['races', 'race_definitions'],
  ] as const) {
    app.get(
      `/v1/catalog/${name}`,
      { schema: routeSchema(spec, `/v1/catalog/${name}`, 'get') },
      async () => ({
        data: (await db.query(`SELECT payload,source_kind FROM ${table} ORDER BY id`)).rows.map(
          (x) => ({ sourceKind: x.source_kind, definition: x.payload }),
        ),
      }),
    )
  }
  eventRoutes(app, spec, new EventRepository(db))
  careerRoutes(
    app,
    spec,
    new CareerRepository(db, config.director),
    createCareerAuthorization(db, config, options.jwksFetch),
  )
  app.addHook('onClose', () => db.close())
  return app
}
