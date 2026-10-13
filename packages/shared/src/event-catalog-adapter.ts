import { createApiClient, type EventListQuery } from './client'
// Safe first integration: public catalog only. No Career/local-save imports, migration or mutation.
export function createEventCatalogAdapter(
  baseUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const client = createApiClient({ baseUrl, fetch: fetcher })
  return {
    list: (query: EventListQuery = {}) => client.listEvents(query),
    detail: (id: string) => client.getEvent(id),
  }
}
