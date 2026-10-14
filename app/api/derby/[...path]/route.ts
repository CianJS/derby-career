const uuid = '[0-9a-fA-F-]{36}'
const allowedPath = new RegExp(
  `^v1/careers(?:/${uuid}(?:/(?:actions|months/advance|events|records|race-entries)|/events/${uuid}/choice|/race-runs/${uuid}(?:/log|/complete)?)?)?$`,
)

function jsonError(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (process.env.NODE_ENV === 'production') {
    return jsonError(403, 'FORBIDDEN', '개발용 세션 프록시는 프로덕션에서 사용할 수 없습니다.')
  }
  const baseUrl = process.env.DERBY_API_URL
  const token = process.env.DERBY_API_DEV_SESSION_TOKEN
  if (!baseUrl || !token) {
    return jsonError(
      503,
      'SERVER_CAREER_NOT_CONFIGURED',
      '서버 Career 모드에 DERBY_API_URL과 DERBY_API_DEV_SESSION_TOKEN이 필요합니다.',
    )
  }
  const { path } = await context.params
  const joined = path.join('/')
  if (!allowedPath.test(joined)) {
    return jsonError(404, 'NOT_FOUND', '지원하지 않는 경로입니다.')
  }
  const isWrite = request.method === 'POST'
  if (isWrite && !request.headers.get('content-type')?.startsWith('application/json')) {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 처리할 수 있습니다.')
  }
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return jsonError(403, 'FORBIDDEN', '같은 출처의 요청만 처리할 수 있습니다.')
  }
  const search = new URL(request.url).search
  let upstream: Response
  try {
    upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/${joined}${search}`, {
      method: request.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(isWrite ? { 'Content-Type': 'application/json' } : {}),
      },
      body: isWrite ? await request.text() : undefined,
      cache: 'no-store',
    })
  } catch {
    return jsonError(502, 'UPSTREAM_UNAVAILABLE', 'Career API에 연결하지 못했습니다.')
  }
  // The body is passed through as text so log responses keep their exact byte order.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export const GET = forward
export const POST = forward
