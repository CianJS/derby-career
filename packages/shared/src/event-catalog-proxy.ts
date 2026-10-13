import { DerbyApiError, type EventListQuery } from './client'
import { createEventCatalogAdapter } from './event-catalog-adapter'
import { eventCategories } from './events'

const statuses = ['ready', 'needs_mapping', 'deferred'] as const
const sorts = ['id', 'name'] as const
const orders = ['asc', 'desc'] as const
const queryKeys = new Set(['category', 'enabled', 'status', 'sort', 'order', 'page', 'pageSize'])

class InvalidQuery extends Error {}

function readQuery(params: URLSearchParams): EventListQuery {
  const query: EventListQuery = {}
  params.forEach((value, key) => {
    if (!queryKeys.has(key) || params.getAll(key).length !== 1) {
      throw new InvalidQuery('지원하지 않거나 중복된 조회 조건입니다.')
    }
    switch (key) {
      case 'page':
      case 'pageSize': {
        const number = Number(value)
        const maximum = key === 'page' ? 100000 : 100
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > maximum) {
          throw new InvalidQuery('페이지와 페이지 크기를 확인해 주세요.')
        }
        query[key] = number
        break
      }
      case 'category': {
        const category = eventCategories.find((item) => item === value)
        if (!category) {
          throw new InvalidQuery('지원하지 않는 이벤트 분류입니다.')
        }
        query.category = category
        break
      }
      case 'enabled':
        if (value !== 'true' && value !== 'false') {
          throw new InvalidQuery('활성 여부는 true 또는 false여야 합니다.')
        }
        query.enabled = value === 'true'
        break
      case 'status': {
        const status = statuses.find((item) => item === value)
        if (!status) {
          throw new InvalidQuery('지원하지 않는 이벤트 상태입니다.')
        }
        query.status = status
        break
      }
      case 'sort': {
        const sort = sorts.find((item) => item === value)
        if (!sort) {
          throw new InvalidQuery('지원하지 않는 정렬 기준입니다.')
        }
        query.sort = sort
        break
      }
      case 'order': {
        const order = orders.find((item) => item === value)
        if (!order) {
          throw new InvalidQuery('지원하지 않는 정렬 방향입니다.')
        }
        query.order = order
        break
      }
    }
  })
  return query
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function failure(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status)
}

function readBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null
  }
  try {
    const url = new URL(value.trim())
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.href.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Public reads only. The caller supplies server configuration; browser headers are never forwarded. */
export function createEventCatalogProxy(options: {
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
}) {
  const execute = async (
    request: Request,
    read: (adapter: ReturnType<typeof createEventCatalogAdapter>) => Promise<unknown>,
  ): Promise<Response> => {
    const baseUrl = readBaseUrl(options.baseUrl)
    if (!baseUrl) {
      return failure(503, 'API_NOT_CONFIGURED', '이벤트 조회 서버가 아직 연결되지 않았습니다.')
    }
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 5000)
    const signal = AbortSignal.any([request.signal, timeout])
    const fetcher: typeof fetch = (input, init) =>
      (options.fetch ?? globalThis.fetch)(input, { ...init, signal, redirect: 'error' })
    try {
      return json(await read(createEventCatalogAdapter(baseUrl, fetcher)))
    } catch (error) {
      if (timeout.aborted) {
        return failure(
          504,
          'CATALOG_TIMEOUT',
          '이벤트 조회가 지연되고 있습니다. 다시 시도해 주세요.',
        )
      }
      if (error instanceof DerbyApiError && [400, 404, 422, 429].includes(error.status)) {
        const message =
          error.status === 404
            ? '이벤트를 찾을 수 없습니다.'
            : error.status === 429
              ? '조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
              : '이벤트 조회 조건을 확인해 주세요.'
        return failure(error.status, error.code, message)
      }
      return failure(
        502,
        'CATALOG_UNAVAILABLE',
        '이벤트를 불러오지 못했습니다. 다시 시도해 주세요.',
      )
    }
  }

  return {
    list: async (request: Request) => {
      try {
        const query = readQuery(new URL(request.url).searchParams)
        return await execute(request, (adapter) => adapter.list(query))
      } catch (error) {
        if (error instanceof InvalidQuery) {
          return failure(400, 'INVALID_QUERY', error.message)
        }
        throw error
      }
    },
    detail: async (request: Request, id: string) => {
      if (!id.trim() || id.length > 100) {
        return failure(400, 'INVALID_EVENT_ID', '이벤트 ID를 확인해 주세요.')
      }
      return execute(request, (adapter) => adapter.detail(id))
    },
  }
}
