export function verifyPublicCatalog(
  baseUrl: string,
  fetcher?: (url: URL, init?: RequestInit) => Promise<Response>,
): Promise<{
  races: number
  countries: { KOR: number; JPN: number; USA: number }
  racecourses: number
  privateApi: string
}>
