import type { FastifyInstance, FastifyRequest, RouteGenericInterface } from 'fastify'
import type { CareerRepository } from '../repositories/careers'
import type { CareerAuthorization } from '../modules/auth/authorization'
import type { components } from '../../../../packages/shared/src/generated/api'
import { routeSchema, type ApiContract } from '../contracts'
type Models = components['schemas']
type CareerParams = { careerId: string }
type HistoryParams = CareerParams & { historyId: string }
type RaceParams = CareerParams & { raceRunId: string }
type Page = { page: number; pageSize: number }
// Response serialization remains governed by the existing OpenAPI schemas.
type ValidatedRoute<Route extends RouteGenericInterface> = {
  Params: Route['Params']
  Querystring: Route['Querystring']
  Body: Route['Body']
  Headers: Route['Headers']
  Reply: unknown
}
export function careerRoutes(
  app: FastifyInstance,
  spec: ApiContract,
  careers: CareerRepository,
  auth: CareerAuthorization,
) {
  const register = <Route extends RouteGenericInterface>(
    method: 'GET' | 'POST',
    path: string,
    handler: (request: FastifyRequest<ValidatedRoute<Route>>, owner: string) => Promise<unknown>,
    created = false,
  ) => {
    app.route<ValidatedRoute<Route>>({
      method,
      url: path.replace(/\{(\w+)\}/g, ':$1'),
      schema: routeSchema(spec, path, method),
      preHandler: async (request) => {
        const owner = await auth.owner(request)
        ;(request as FastifyRequest<ValidatedRoute<Route>> & { principalId: string }).principalId =
          owner
      },
      handler: async (request, reply) => {
        const result = await handler(
          request,
          (request as FastifyRequest<ValidatedRoute<Route>> & { principalId: string }).principalId,
        )
        // Preserve the stored JSON.stringify digest byte order for every engine version.
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
  register<{ Querystring: Page }>('GET', '/v1/careers', (r, o) => {
    const p = r.query
    return careers.list(o, p.page, p.pageSize)
  })
  register<{ Querystring: Page }>('GET', '/v1/careers/workspace', (r, o) => {
    const p = r.query
    return careers.workspace(o, p.page, p.pageSize)
  })
  register<{ Body: Models['CreateCareer'] }>(
    'POST',
    '/v1/careers',
    (r, o) => careers.create(o, r.body),
    true,
  )
  register<{ Params: CareerParams }>('GET', '/v1/careers/{careerId}', (r, o) =>
    careers.get(o, r.params.careerId),
  )
  register<{ Params: CareerParams; Body: Models['RetireCareer'] }>(
    'POST',
    '/v1/careers/{careerId}/retirement',
    (r, o) => careers.retire(o, r.params.careerId, r.body),
  )
  register<{ Params: CareerParams }>('GET', '/v1/careers/{careerId}/retirement', (r, o) =>
    careers.retirement(o, r.params.careerId),
  )
  register<{ Params: CareerParams; Querystring: Page }>(
    'GET',
    '/v1/careers/{careerId}/actions',
    (r, o) => {
      const p = r.query
      return careers.actions(o, r.params.careerId, p.page, p.pageSize)
    },
  )
  register<{ Params: CareerParams; Body: Models['ConfirmAction'] }>(
    'POST',
    '/v1/careers/{careerId}/actions',
    (r, o) => careers.act(o, r.params.careerId, r.body),
  )
  register<{ Params: CareerParams; Body: Models['AdvanceMonth'] }>(
    'POST',
    '/v1/careers/{careerId}/months/advance',
    (r, o) => careers.advance(o, r.params.careerId, r.body),
  )
  register<{ Params: CareerParams; Querystring: Page }>(
    'GET',
    '/v1/careers/{careerId}/events',
    (r, o) => {
      const p = r.query
      return careers.events(o, r.params.careerId, p.page, p.pageSize)
    },
  )
  register<{ Params: HistoryParams; Body: Models['ChooseEvent'] }>(
    'POST',
    '/v1/careers/{careerId}/events/{historyId}/choice',
    (r, o) => {
      const p = r.params
      return careers.selectEvent(o, p.careerId, p.historyId, r.body)
    },
  )
  register<{ Params: CareerParams; Querystring: Page }>(
    'GET',
    '/v1/careers/{careerId}/records',
    (r, o) => {
      const p = r.query
      return careers.records(o, r.params.careerId, p.page, p.pageSize)
    },
  )
  register<{ Params: CareerParams }>('GET', '/v1/careers/{careerId}/expedition', (r, o) =>
    careers.expedition(o, r.params.careerId),
  )
  register<{ Params: CareerParams; Querystring: Page }>(
    'GET',
    '/v1/careers/{careerId}/expeditions/history',
    (r, o) => careers.expeditionHistory(o, r.params.careerId, r.query.page, r.query.pageSize),
  )
  register<{ Params: CareerParams; Body: Models['StartExpedition'] }>(
    'POST',
    '/v1/careers/{careerId}/expeditions',
    (r, o) => careers.depart(o, r.params.careerId, r.body),
  )
  register<{ Params: CareerParams & { expeditionId: string }; Body: Models['ReturnExpedition'] }>(
    'POST',
    '/v1/careers/{careerId}/expeditions/{expeditionId}/return',
    (r, o) => careers.returnHome(o, r.params.careerId, r.params.expeditionId, r.body),
  )
  register<{ Params: CareerParams }>('GET', '/v1/careers/{careerId}/jockey-relations', (r, o) =>
    careers.jockeyRelations(o, r.params.careerId),
  )
  register<{ Params: CareerParams; Querystring: { referenceRaceId?: string } }>(
    'GET',
    '/v1/careers/{careerId}/race-entries',
    (r, o) => careers.raceEntryOptions(o, r.params.careerId, r.query.referenceRaceId),
  )
  register<{ Params: CareerParams; Body: Models['EnterRace'] }>(
    'POST',
    '/v1/careers/{careerId}/race-entries',
    (r, o) => careers.enterRace(o, r.params.careerId, r.body),
  )
  register<{ Params: RaceParams }>(
    'GET',
    '/v1/careers/{careerId}/race-runs/{raceRunId}',
    (r, o) => {
      const p = r.params
      return careers.race(o, p.careerId, p.raceRunId)
    },
  )
  register<{ Params: RaceParams }>(
    'GET',
    '/v1/careers/{careerId}/race-runs/{raceRunId}/log',
    (r, o) => {
      const p = r.params
      return careers.race(o, p.careerId, p.raceRunId, true)
    },
  )
  register<{ Params: RaceParams; Body: Models['CompleteRace'] }>(
    'POST',
    '/v1/careers/{careerId}/race-runs/{raceRunId}/complete',
    (r, o) => {
      const p = r.params
      return careers.finishRace(o, p.careerId, p.raceRunId, r.body)
    },
  )
}
