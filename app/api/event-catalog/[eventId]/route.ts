import { createEventCatalogProxy } from '@/packages/shared/src/event-catalog-proxy'

export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params
  return createEventCatalogProxy({ baseUrl: process.env.DERBY_API_URL }).detail(request, eventId)
}
