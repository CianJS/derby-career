import { DerbyApiError } from '../../packages/shared/src/client'
import { CatalogResponseValidationError, createCatalogClient } from './client'
import { idPattern, readQuery } from './model'
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const failure = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status)

// Non-secret diagnostics for the same-origin bridge: no upstream body, URL, tokens or stack traces.
function upstreamFailure(
  phase: 'upstream_http' | 'invalid_json' | 'response_contract' | 'network',
  status?: number,
) {
  const response = failure(
    502,
    'CATALOG_UNAVAILABLE',
    '경주 조회 서버에 연결할 수 없거나 응답을 확인하지 못했습니다.',
  )
  response.headers.set('X-Derby-Catalog-Failure', phase)
  if (status !== undefined) {
    response.headers.set('X-Derby-Catalog-Upstream-Status', String(status))
  }
  return response
}
/** Public reads only. No incoming credentials, arbitrary paths or playable data are forwarded. */
export async function handleCatalog(
  request: Request,
  path: string[],
  options: { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number },
) {
  if (
    request.method !== 'GET' ||
    path[0] !== 'v1' ||
    !['race-schedule', 'racecourses'].includes(path[1]) ||
    ![2, 3].includes(path.length)
  ) {
    return failure(404, 'NOT_FOUND', '조회 경로를 찾을 수 없습니다.')
  }
  const id = path[2]
  if (id && !idPattern.test(id)) {
    return failure(400, 'INVALID_ID', '경주 또는 경마장 ID를 확인해 주세요.')
  }
  let query
  try {
    query = readQuery(new URL(request.url).searchParams, path[1] === 'racecourses')
    if (id && new URL(request.url).search) {
      throw new Error('상세 조회에는 필터를 사용할 수 없습니다.')
    }
  } catch (error) {
    return failure(
      400,
      'INVALID_QUERY',
      error instanceof Error ? error.message : '조회 조건을 확인해 주세요.',
    )
  }
  let base: URL
  try {
    base = new URL(options.baseUrl ?? '')
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) {
      throw new Error('Invalid API configuration')
    }
  } catch {
    return failure(503, 'API_NOT_CONFIGURED', '경주 조회 서버가 아직 연결되지 않았습니다.')
  }
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 5000)
  const signal = AbortSignal.any([request.signal, timeout])
  const client = createCatalogClient(base.href.replace(/\/+$/, ''), (url, init) =>
    (options.fetch ?? globalThis.fetch)(url, { ...init, signal, redirect: 'error' }),
  )
  try {
    const data =
      path[1] === 'race-schedule'
        ? id
          ? await client.race(id)
          : await client.list(query)
        : id
          ? await client.venue(id)
          : await client.venues(query)
    return json(data)
  } catch (error) {
    if (timeout.aborted) {
      return failure(504, 'CATALOG_TIMEOUT', '경주 조회가 지연되고 있습니다.')
    }
    if (error instanceof DerbyApiError && [400, 404, 429].includes(error.status)) {
      return failure(
        error.status,
        error.code,
        error.status === 404
          ? '경주 또는 경마장 정보를 찾을 수 없습니다.'
          : '조회 조건을 확인하거나 잠시 후 다시 시도해 주세요.',
      )
    }
    if (error instanceof DerbyApiError) {
      return upstreamFailure(error.code === 'INVALID_RESPONSE' || error.code === 'HTTP_ERROR' ? 'invalid_json' : 'upstream_http', error.status)
    }
    if (error instanceof CatalogResponseValidationError) {
      return upstreamFailure('response_contract')
    }
    return upstreamFailure('network')
  }
}
