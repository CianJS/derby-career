import { validateRaceReadResponse } from './race-read-validation'
import type { components } from '../../packages/shared/src/generated/api'
import {
  validateServerSaveCommand,
  validateCareerWorkspace,
  validateHorseCatalog,
  validateActionResponse,
  validateRetireCareerResponse,
  validateCareerResponse,
} from '../../packages/shared/src/generated/save-validation.mjs'

type Env = Record<string, string | undefined>
export function serverSaveEnabled(env: Env = process.env) {
  return (
    env.NODE_ENV === 'development' &&
    env.DERBY_SAVE_MODE === 'server' &&
    env.DERBY_SERVER_SAVE_LOCAL === '1'
  )
}
function localUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('로컬 API 주소가 필요합니다.')
  }
  return url
}
const reply = (status: number, message: string) =>
  Response.json(
    { error: { code: 'SERVER_SAVE_ERROR', message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
const uuid = '[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}'
function commandFor(
  path: string,
  body: unknown,
): components['schemas']['ServerSaveCommand'] | null {
  if (path === '/v1/careers') {
    const value = { kind: 'create', body }
    return validateServerSaveCommand(value) ? value : null
  }
  const match = new RegExp(
    `^/v1/careers/(${uuid})/(actions|months/advance|retirement|events/(${uuid})/choice)$`,
  ).exec(path)
  if (!match) {
    return null
  }
  const kind =
    match[2] === 'actions'
      ? 'action'
      : match[2] === 'months/advance'
        ? 'advance'
        : match[2] === 'retirement'
          ? 'retire'
          : 'event'
  const value = {
    kind,
    careerId: match[1],
    body,
    ...(kind === 'event' ? { historyId: match[3] } : {}),
  }
  return validateServerSaveCommand(value) ? value : null
}

/** Development-only bridge; the credential stays on the loopback-bound Next process. */
export async function handleServerSave(
  request: Request,
  env: Env = process.env,
  perform: typeof fetch = fetch,
) {
  if (!serverSaveEnabled(env)) {
    return reply(404, '서버 저장 모드가 활성화되지 않았습니다.')
  }
  const browserUrl = new URL(request.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(browserUrl.hostname)) {
    return reply(403, '로컬 주소에서만 서버 저장을 사용할 수 있습니다.')
  }
  // Next normalizes a loopback Request.url hostname to localhost. The actual browser origin
  // follows Host instead. Validate that header directly; never trust forwarded-host/proto.
  const host = request.headers.get('host') ?? browserUrl.host
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::[1-9]\d{0,4})?$/i.test(host)) {
    return reply(403, '로컬 주소에서만 서버 저장을 사용할 수 있습니다.')
  }
  let origin: string
  try {
    origin = new URL(`http://${host}`).origin
  } catch {
    return reply(403, '로컬 주소에서만 서버 저장을 사용할 수 있습니다.')
  }
  const prefix = '/api/server-save'
  const path = browserUrl.pathname.slice(prefix.length)
  if (!browserUrl.pathname.startsWith(prefix + '/')) {
    return reply(404, '지원하지 않는 저장 경로입니다.')
  }
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (request.headers.has('origin') && request.headers.get('origin') !== origin)
  ) {
    return reply(403, '같은 로컬 화면에서 요청해 주세요.')
  }
  let payload: unknown
  let command: components['schemas']['ServerSaveCommand'] | null = null
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== origin) {
      return reply(403, '같은 로컬 화면에서 요청해 주세요.')
    }
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
      return reply(415, 'JSON 저장 요청이 필요합니다.')
    }
    const text = await request.text()
    if (text.length > 4096) {
      return reply(413, '저장 요청이 너무 큽니다.')
    }
    try {
      payload = JSON.parse(text)
    } catch {
      return reply(400, '저장 요청을 읽지 못했습니다.')
    }
    command = commandFor(path, payload)
    if (browserUrl.search || !command) {
      return reply(400, '실행할 수 없는 저장 요청입니다.')
    }
  } else if (request.method === 'GET') {
    if (
      path !== '/v1/careers/workspace' &&
      path !== '/v1/catalog/horses' &&
      !new RegExp(`^/v1/careers/(${uuid})/race-runs/(${uuid})(/log)?$`).test(path)
    ) {
      return reply(404, '지원하지 않는 저장 경로입니다.')
    }
    if (path !== '/v1/careers/workspace' && browserUrl.search) {
      return reply(400, '지원하지 않는 조회 조건입니다.')
    }
    for (const [key, value] of browserUrl.searchParams) {
      if (
        !['page', 'pageSize'].includes(key) ||
        !/^[1-9]\d*$/.test(value) ||
        (key === 'pageSize' && Number(value) > 100)
      ) {
        return reply(400, '지원하지 않는 조회 조건입니다.')
      }
    }
  } else {
    return reply(405, '지원하지 않는 저장 요청입니다.')
  }
  try {
    const target = localUrl(env.DERBY_API_URL ?? 'http://127.0.0.1:4000')
    const token = env.DERBY_API_DEV_SESSION_TOKEN
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return reply(503, '개발용 세션을 설정한 뒤 서버 저장 모드를 다시 시작해 주세요.')
    }
    const response = await perform(new URL(path + browserUrl.search, target), {
      method: request.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: '저장 요청을 확인해 주세요.',
        401: '개발용 세션이 만료되었거나 취소되었습니다.',
        403: '로컬 API의 개발용 세션 설정을 확인해 주세요.',
        404: '서버 저장 기록을 찾지 못했습니다.',
        409: '서버 상태가 변경되었습니다. 최신 기록을 불러왔으니 다시 선택해 주세요.',
        422: '현재 서버 상태에서 실행할 수 없는 선택입니다.',
        429: '잠시 뒤 같은 요청으로 다시 확인해 주세요.',
      }
      return reply(
        messages[response.status] ? response.status : 502,
        messages[response.status] ?? '서버 저장 응답을 확인하지 못했습니다.',
      )
    }
    const result: unknown = await response.json()
    const valid =
      request.method === 'GET'
        ? path === '/v1/careers/workspace'
          ? validateCareerWorkspace(result)
          : path === '/v1/catalog/horses'
            ? validateHorseCatalog(result)
            : validateRaceReadResponse(result, path.endsWith('/log'))
        : command?.kind === 'action'
          ? validateActionResponse(result)
          : command?.kind === 'retire'
            ? validateRetireCareerResponse(result)
            : validateCareerResponse(result)
    if (!valid) {
      return reply(502, '서버 저장 응답이 계약과 다릅니다. 같은 요청으로 다시 확인해 주세요.')
    }
    return Response.json(result, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return reply(
      502,
      '로컬 API에 연결하지 못했습니다. 서버를 확인한 뒤 같은 요청으로 다시 확인해 주세요.',
    )
  }
}
