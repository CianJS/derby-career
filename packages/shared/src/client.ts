import type { components, operations } from './generated/api'
type Models = components['schemas']
export type EventListQuery = operations['listEvents']['parameters']['query']
export type PageQuery = { page?: number; pageSize?: number }
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
export function createApiClient(options: {
  baseUrl: string
  fetch?: typeof fetch
  getSessionToken?: () => string | undefined | Promise<string | undefined>
}) {
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
  const careerPath = (id: string) => `/v1/careers/${encodeURIComponent(id)}`
  return {
    listEvents: (query: EventListQuery = {}) =>
      request<Models['EventList']>('/v1/events', undefined, false, query),
    getEvent: (id: string) =>
      request<Models['EventDefinition']>(`/v1/events/${encodeURIComponent(id)}`),
    listHorses: () => request<Models['HorseCatalog']>('/v1/catalog/horses'),
    listJockeys: () => request<Models['JockeyCatalog']>('/v1/catalog/jockeys'),
    listRaces: () => request<Models['RaceCatalog']>('/v1/catalog/races'),
    listCareers: (query: PageQuery = {}) =>
      request<Models['CareerList']>('/v1/careers', undefined, true, query),
    createCareer: (body: Models['CreateCareer']) =>
      request<Models['CareerResponse']>('/v1/careers', body, true),
    getCareer: (id: string) => request<Models['CareerResponse']>(careerPath(id), undefined, true),
    confirmAction: (id: string, body: Models['ConfirmAction']) =>
      request<Models['ActionResponse']>(careerPath(id) + '/actions', body, true),
    advanceMonth: (id: string, body: Models['AdvanceMonth']) =>
      request<Models['CareerResponse']>(careerPath(id) + '/months/advance', body, true),
    chooseEvent: (id: string, historyId: string, body: Models['ChooseEvent']) =>
      request<Models['CareerResponse']>(
        careerPath(id) + `/events/${encodeURIComponent(historyId)}/choice`,
        body,
        true,
      ),
    enterRace: (id: string, body: Models['EnterRace']) =>
      request<Models['RaceEntryResponse']>(careerPath(id) + '/race-entries', body, true),
    getRaceRun: (id: string, runId: string) =>
      request<Models['RaceRunResponse']>(
        careerPath(id) + `/race-runs/${encodeURIComponent(runId)}`,
        undefined,
        true,
      ),
    getRaceLog: (id: string, runId: string) =>
      request<Models['RaceLogResponse']>(
        careerPath(id) + `/race-runs/${encodeURIComponent(runId)}/log`,
        undefined,
        true,
      ),
    completeRace: (id: string, runId: string, body: Models['CompleteRace']) =>
      request<Models['RaceCompleteResponse']>(
        careerPath(id) + `/race-runs/${encodeURIComponent(runId)}/complete`,
        body,
        true,
      ),
    listActions: (id: string, query: PageQuery = {}) =>
      request<Models['ActionList']>(careerPath(id) + '/actions', undefined, true, query),
    listRecords: (id: string, query: PageQuery = {}) =>
      request<Models['RecordList']>(careerPath(id) + '/records', undefined, true, query),
    listCareerEvents: (id: string, query: PageQuery = {}) =>
      request<Models['CareerEventList']>(careerPath(id) + '/events', undefined, true, query),
  }
}
export type DerbyApiClient = ReturnType<typeof createApiClient>
