import { createApiClient, type EventListQuery } from './client'
import { parseCatalogEvent, parseCatalogPage } from './event-catalog-validation'
// Safe first integration: public catalog only. No Career/local-save imports, migration or mutation.
export function createEventCatalogAdapter(
  baseUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const client = createApiClient({ baseUrl, fetch: fetcher })
  return {
    list: async (query: EventListQuery = {}) => parseCatalogPage(await client.listEvents(query)),
    detail: async (id: string) => parseCatalogEvent(await client.getEvent(id)),
  }
}
