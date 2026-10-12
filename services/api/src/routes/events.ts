import type { FastifyInstance } from 'fastify'
import type { EventRepository, EventQuery } from '../repositories/events'
import { routeSchema } from '../contracts'
import { notFound } from '../errors'
export function eventRoutes(app: FastifyInstance, spec: any, events: EventRepository) {
  app.get('/v1/events',{schema:routeSchema(spec,'/v1/events','get')},async request=>events.list(request.query as EventQuery))
  app.get('/v1/events/:eventId',{schema:routeSchema(spec,'/v1/events/{eventId}','get')},async request=>{
    const event=await events.get((request.params as {eventId:string}).eventId)
    if (!event) throw notFound()
    return event
  })
}
