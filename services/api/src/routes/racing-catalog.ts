import type { FastifyInstance } from 'fastify'
import { routeSchema, type ApiContract } from '../contracts'
import type {
  RacingCatalogRepository,
  RacecourseQuery,
  RaceScheduleQuery,
} from '../repositories/racing-catalog'
import { notFound } from '../errors'
export function racingCatalogRoutes(
  app: FastifyInstance,
  spec: ApiContract,
  catalog: RacingCatalogRepository,
) {
  app.get('/v1/racecourses', { schema: routeSchema(spec, '/v1/racecourses', 'get') }, (request) =>
    catalog.listRacecourses(request.query as RacecourseQuery),
  )
  app.get(
    '/v1/race-schedule',
    { schema: routeSchema(spec, '/v1/race-schedule', 'get') },
    (request) => catalog.listSchedule(request.query as RaceScheduleQuery),
  )
  for (const [path, get] of [
    ['/v1/racecourses', (id: string) => catalog.getRacecourse(id)],
    ['/v1/race-schedule', (id: string) => catalog.getSchedule(id)],
  ] as const) {
    app.get(
      path + '/:id',
      { schema: routeSchema(spec, path + '/{id}', 'get') },
      async (request) => {
        const record = await get((request.params as { id: string }).id)
        if (!record) {
          throw notFound()
        }
        return record
      },
    )
  }
}
