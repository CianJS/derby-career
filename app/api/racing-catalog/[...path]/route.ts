import { handleCatalog } from '@/lib/race-catalog/proxy'
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  return handleCatalog(request, path, { baseUrl: process.env.DERBY_API_URL })
}
