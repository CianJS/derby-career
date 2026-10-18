import type { components, operations } from './generated/api'
import { createApiTransport, type ApiClientOptions } from './api-transport'

export { DerbyApiError } from './api-transport'
type Models = components['schemas']
export type EventListQuery = operations['listEvents']['parameters']['query']
export type PageQuery = { page?: number; pageSize?: number }
export function createApiClient(options: ApiClientOptions) {
  const request = createApiTransport(options)
  const careerPath = (id: string) => `/v1/careers/${encodeURIComponent(id)}`
  return {
    listEvents: (query: EventListQuery = {}) =>
      request<Models['EventList']>('/v1/events', undefined, false, query),
    getEvent: (id: string) =>
      request<Models['EventDefinition']>(`/v1/events/${encodeURIComponent(id)}`),
    listHorses: () => request<Models['HorseCatalog']>('/v1/catalog/horses'),
    listJockeys: () => request<Models['JockeyCatalog']>('/v1/catalog/jockeys'),
    listRaces: () => request<Models['RaceCatalog']>('/v1/catalog/races'),
    listRacecourses: (query: operations['listRacecourses']['parameters']['query'] = {}) =>
      request<Models['RacecourseList']>('/v1/racecourses', undefined, false, query),
    getRacecourse: (id: string) =>
      request<Models['RacecourseDetail']>(`/v1/racecourses/${encodeURIComponent(id)}`),
    listRaceSchedule: (query: operations['listRaceSchedule']['parameters']['query'] = {}) =>
      request<Models['RaceScheduleList']>('/v1/race-schedule', undefined, false, query),
    getRaceSchedule: (id: string) =>
      request<Models['RaceSchedule']>(`/v1/race-schedule/${encodeURIComponent(id)}`),
    listCareers: (query: PageQuery = {}) =>
      request<Models['CareerList']>('/v1/careers', undefined, true, query),
    getCareerWorkspace: (query: PageQuery = {}) =>
      request<Models['CareerWorkspace']>('/v1/careers/workspace', undefined, true, query),
    createCareer: (body: Models['CreateCareer']) =>
      request<Models['CareerResponse']>('/v1/careers', body, true),
    getCareer: (id: string) => request<Models['CareerResponse']>(careerPath(id), undefined, true),
    retireCareer: (id: string, body: Models['RetireCareer']) =>
      request<Models['RetireCareerResponse']>(careerPath(id) + '/retirement', body, true),
    getRetirement: (id: string) =>
      request<Models['RetirementResponse']>(careerPath(id) + '/retirement', undefined, true),
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
    getExpedition: (id: string) =>
      request<Models['ExpeditionResponse']>(careerPath(id) + '/expedition', undefined, true),
    startExpedition: (id: string, body: Models['StartExpedition']) =>
      request<Models['CareerResponse']>(careerPath(id) + '/expeditions', body, true),
    returnExpedition: (id: string, expeditionId: string, body: Models['ReturnExpedition']) =>
      request<Models['CareerResponse']>(
        careerPath(id) + `/expeditions/${encodeURIComponent(expeditionId)}/return`,
        body,
        true,
      ),
    getJockeyRelations: (id: string) =>
      request<Models['JockeyRelationsResponse']>(
        careerPath(id) + '/jockey-relations',
        undefined,
        true,
      ),
    getRaceEntryOptions: (id: string) =>
      request<Models['RaceEntryOptions']>(careerPath(id) + '/race-entries', undefined, true),
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
