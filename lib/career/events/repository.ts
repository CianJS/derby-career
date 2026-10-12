import { EVENT_FIXTURES } from './fixtures'
import type { EventDefinition, EventKind, EventTiming } from './types'

export type EventQuery = { kind?: EventKind; timing?: EventTiming }

/** Where event definitions come from. A DB-backed implementation replaces the static one without touching the event rules. */
export interface EventRepository {
  list(query?: EventQuery): Promise<readonly EventDefinition[]>
}

export function filterEvents(events: readonly EventDefinition[], query: EventQuery = {}): EventDefinition[] {
  return events.filter(event => (!query.kind || event.kind === query.kind) && (!query.timing || event.timing === query.timing))
}

export const staticEventRepository: EventRepository = {
  list: async query => filterEvents(EVENT_FIXTURES, query),
}

/** Reads definitions from `GET /api/events`; the swap target once the catalog lives behind the API. */
export function createHttpEventRepository(endpoint = '/api/events', fetcher: typeof fetch = fetch): EventRepository {
  return {
    list: async query => {
      const params = new URLSearchParams()
      if (query?.kind) params.set('kind', query.kind)
      if (query?.timing) params.set('timing', query.timing)
      const response = await fetcher(params.size ? `${endpoint}?${params}` : endpoint)
      if (!response.ok) throw new Error('이벤트 정의를 불러오지 못했습니다.')
      const body = (await response.json()) as { events: EventDefinition[] }
      return body.events
    },
  }
}

/**
 * The rules run on a loaded catalog so they stay synchronous and deterministic. Today the catalog is the static
 * fixture set; a DB/API backed app builds one with `createEventCatalog(await repository.list())`.
 */
export type EventCatalog = { list(): readonly EventDefinition[]; find(id: string): EventDefinition | undefined }
export function createEventCatalog(events: readonly EventDefinition[]): EventCatalog {
  const byId = new Map(events.map(event => [event.id, event]))
  return { list: () => events, find: id => byId.get(id) }
}
export const defaultEventCatalog: EventCatalog = createEventCatalog(EVENT_FIXTURES)
