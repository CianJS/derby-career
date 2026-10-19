import { createEventCatalogProxy } from '@/packages/shared/src/event-catalog-proxy'

export async function GET(request: Request) {
  return createEventCatalogProxy({ baseUrl: process.env.DERBY_API_URL }).list(request)
}
