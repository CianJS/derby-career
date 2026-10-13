import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { CareerRepository } from '../repositories/careers'
import type { CareerAuthorization } from '../modules/auth/authorization'
import type { components } from '../../../../packages/shared/src/generated/api'
import { routeSchema, type ApiContract } from '../contracts'
type Models = components['schemas']
type Params = { careerId: string; historyId: string; raceRunId: string }
type Page = { page: number; pageSize: number }
export function careerRoutes(
  app: FastifyInstance,
  spec: ApiContract,
  careers: CareerRepository,
  auth: CareerAuthorization,
) {
  const register = (
    method: 'GET' | 'POST',
    path: string,
    handler: (request: FastifyRequest, owner: string) => Promise<unknown>,
    created = false,
  ) => {
    app.route({
      method,
      url: path.replace(/\{(\w+)\}/g, ':$1'),
      schema: routeSchema(spec, path, method),
      preHandler: async (request) => {
        const owner = await auth.owner(request)
        ;(request as FastifyRequest & { principalId: string }).principalId = owner
      },
      handler: async (request, reply) => {
        const result = await handler(
          request,
          (request as FastifyRequest & { principalId: string }).principalId,
        )
        // Preserve the existing v1/v2 JSON.stringify digest byte order on log responses.
        if (path.endsWith('/log')) {
          reply.serializer(JSON.stringify)
        }
        if (created) {
          reply.code(201)
        }
        return result
      },
    })
  }
  register('GET', '/v1/careers', (r, o) => {
    const p = r.query as Page
    return careers.list(o, p.page, p.pageSize)
  })
  register(
    'POST',
    '/v1/careers',
    (r, o) => careers.create(o, r.body as Models['CreateCareer']),
    true,
  )
  register('GET', '/v1/careers/{careerId}', (r, o) => careers.get(o, (r.params as Params).careerId))
  register('POST', '/v1/careers/{careerId}/retirement', (r, o) =>
    careers.retire(o, (r.params as Params).careerId, r.body as Models['RetireCareer']),
  )
  register('GET', '/v1/careers/{careerId}/retirement', (r, o) =>
    careers.retirement(o, (r.params as Params).careerId),
  )
  register('GET', '/v1/careers/{careerId}/actions', (r, o) => {
    const p = r.query as Page
    return careers.actions(o, (r.params as Params).careerId, p.page, p.pageSize)
  })
  register('POST', '/v1/careers/{careerId}/actions', (r, o) =>
    careers.act(o, (r.params as Params).careerId, r.body as Models['ConfirmAction']),
  )
  register('POST', '/v1/careers/{careerId}/months/advance', (r, o) =>
    careers.advance(o, (r.params as Params).careerId, r.body as Models['AdvanceMonth']),
  )
  register('GET', '/v1/careers/{careerId}/events', (r, o) => {
    const p = r.query as Page
    return careers.events(o, (r.params as Params).careerId, p.page, p.pageSize)
  })
  register('POST', '/v1/careers/{careerId}/events/{historyId}/choice', (r, o) => {
    const p = r.params as Params
    return careers.selectEvent(o, p.careerId, p.historyId, r.body as Models['ChooseEvent'])
  })
  register('GET', '/v1/careers/{careerId}/records', (r, o) => {
    const p = r.query as Page
    return careers.records(o, (r.params as Params).careerId, p.page, p.pageSize)
  })
  register('POST', '/v1/careers/{careerId}/race-entries', (r, o) =>
    careers.enterRace(o, (r.params as Params).careerId, r.body as Models['EnterRace']),
  )
  register('GET', '/v1/careers/{careerId}/race-runs/{raceRunId}', (r, o) => {
    const p = r.params as Params
    return careers.race(o, p.careerId, p.raceRunId)
  })
  register('GET', '/v1/careers/{careerId}/race-runs/{raceRunId}/log', (r, o) => {
    const p = r.params as Params
    return careers.race(o, p.careerId, p.raceRunId, true)
  })
  register('POST', '/v1/careers/{careerId}/race-runs/{raceRunId}/complete', (r, o) => {
    const p = r.params as Params
    return careers.finishRace(o, p.careerId, p.raceRunId, r.body as Models['CompleteRace'])
  })
}
