export class DerbyApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message)
  }
}

export type ApiClientOptions = {
  baseUrl: string
  fetch?: typeof fetch
  getSessionToken?: () => string | undefined | Promise<string | undefined>
}

export function createApiTransport(options: ApiClientOptions) {
  const perform = options.fetch ?? globalThis.fetch
  const request = async <T>(
    path: string,
    body?: unknown,
    privateRequest = false,
    query?: Record<string, unknown>,
  ): Promise<T> => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        search.set(key, String(value))
      }
    }
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    if (privateRequest) {
      const token = await options.getSessionToken?.()
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
    }
    const response = await perform(
      `${options.baseUrl.replace(/\/$/, '')}${path}${search.size ? '?' + search : ''}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
      },
    )
    let result: unknown
    try {
      result = await response.json()
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error
      }
      throw new DerbyApiError(
        response.ok ? 502 : response.status,
        response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR',
        'API 응답을 읽지 못했습니다.',
      )
    }
    if (!response.ok) {
      const details =
        result &&
        typeof result === 'object' &&
        'error' in result &&
        result.error &&
        typeof result.error === 'object'
          ? result.error
          : {}
      throw new DerbyApiError(
        response.status,
        'code' in details && typeof details.code === 'string' ? details.code : 'HTTP_ERROR',
        'message' in details && typeof details.message === 'string'
          ? details.message
          : 'API 요청을 처리하지 못했습니다.',
        'requestId' in details && typeof details.requestId === 'string'
          ? details.requestId
          : undefined,
      )
    }
    return result as T
  }
  return request
}
