import { handleCatalog } from '@/lib/race-catalog/proxy'
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  return handleCatalog(request, path, {
    baseUrl: process.env.DERBY_API_URL,
    // Vercel issues this per-function token; never forward browser credentials.
    trustedOidcToken: process.env.VERCEL ? (request.headers.get('x-vercel-oidc-token') ?? undefined) : undefined,
  })
}
