import { createApiClient, DerbyApiError } from '@/packages/shared/src/client'
import type { components } from '@/packages/shared/src/generated/api'
import type { Career, Choice } from './model'
import type { CareerEvent, EventChoiceId, EventStatus } from './events/types'
import type { RaceEntryDraft } from './race-entry'
import { hasRaceLog, writeRaceLog } from './race-log-repository'
import type { RaceSimulationLog, RaceSimulationResult } from './race-simulation'

type ServerCareer = components['schemas']['Career']

/** Opt-in: set NEXT_PUBLIC_CAREER_BACKEND=server to use the Career API instead of browser saves. */
export const isServerCareerMode = () => process.env.NEXT_PUBLIC_CAREER_BACKEND === 'server'

const pointerKey = 'derby-server-career-id'
const api = createApiClient({ baseUrl: '/api/derby' })
const eventStatus: Record<NonNullable<ServerCareer['event']>['state'], EventStatus> = {
  pending: 'offered',
  selected: 'chosen',
  applied: 'applied',
  expired: 'expired',
}

let careerId: string | null = null
let eventHistoryId: string | null = null

const readPointer = () => careerId ?? (careerId = localStorage.getItem(pointerKey))
function writePointer(id: string) {
  careerId = id
  localStorage.setItem(pointerKey, id)
}
function clearPointer() {
  careerId = null
  eventHistoryId = null
  localStorage.removeItem(pointerKey)
}
function requireId(): string {
  const id = readPointer()
  if (!id) throw new Error('육성 기록이 없습니다.')
  return id
}

/** The server state is produced by the same shared model code, so it is the browser Career minus browser-only event data. */
function adapt(server: ServerCareer): Career {
  eventHistoryId = server.event?.id ?? null
  const career = server.state as unknown as Career
  const event = server.event
  if (!event) return career
  const choice: EventChoiceId | undefined =
    event.choiceId === 'A' || event.choiceId === 'B' ? event.choiceId : undefined
  const mapped: CareerEvent = {
    eventId: event.eventId,
    month: server.state.month,
    seed: 0,
    status: eventStatus[event.state],
    ...(choice ? { choice } : {}),
  }
  return { ...career, event: mapped }
}

async function fetchRaceLog(id: string, raceRunId: string) {
  const { log } = await api.getRaceLog(id, raceRunId)
  writeRaceLog(log as unknown as RaceSimulationLog)
}
async function withRaceLog(id: string, server: ServerCareer): Promise<Career> {
  const career = adapt(server)
  const runId = career.raceRun?.raceRunId
  if (runId && !hasRaceLog(runId)) await fetchRaceLog(id, runId)
  return career
}

export const serverCareer = {
  async load(): Promise<Career | null> {
    const id = readPointer()
    if (!id) return null
    try {
      return await withRaceLog(id, (await api.getCareer(id)).career)
    } catch (error) {
      if (error instanceof DerbyApiError && error.status === 404) {
        clearPointer()
        return null
      }
      throw error
    }
  },
  async create(horseId: string): Promise<Career> {
    const { career } = await api.createCareer({
      careerId: crypto.randomUUID(),
      horseDefinitionId: horseId,
    })
    writePointer(career.id)
    return adapt(career)
  },
  async commit(career: Career, choice: Choice): Promise<Career> {
    const response = await api.confirmAction(requireId(), {
      actionId: crypto.randomUUID(),
      choice,
      expectedTurn: career.careerTurnIndex,
    })
    return adapt(response.career)
  },
  async next(career: Career, actionId: string): Promise<Career> {
    const response = await api.advanceMonth(requireId(), {
      commandId: crypto.randomUUID(),
      actionId,
      expectedTurn: career.careerTurnIndex,
    })
    return adapt(response.career)
  },
  async chooseEvent(career: Career, choice: EventChoiceId): Promise<Career> {
    if (!eventHistoryId) throw new Error('선택할 이벤트가 없습니다. 다시 불러와 주세요.')
    const response = await api.chooseEvent(requireId(), eventHistoryId, {
      commandId: crypto.randomUUID(),
      choiceId: choice,
      expectedTurn: career.careerTurnIndex,
    })
    return adapt(response.career)
  },
  async lockRace(career: Career, draft: RaceEntryDraft): Promise<Career> {
    if (!draft.raceId || !draft.jockeyId || !draft.tactic) {
      throw new Error('경주, 기수, 작전을 모두 선택해 주세요.')
    }
    const id = requireId()
    const raceRunId = crypto.randomUUID()
    const response = await api.enterRace(id, {
      raceRunId,
      raceDefinitionId: draft.raceId,
      jockeyId: draft.jockeyId,
      tactic: draft.tactic,
      expectedTurn: career.careerTurnIndex,
      engineVersion: 'race-sim-v2',
    })
    await fetchRaceLog(id, response.raceRunId)
    return adapt(response.career)
  },
  async completeRace(raceRunId: string): Promise<{ career: Career; result: RaceSimulationResult }> {
    const response = await api.completeRace(requireId(), raceRunId, {
      commandId: crypto.randomUUID(),
    })
    return { career: adapt(response.career), result: response.result }
  },
  release() {
    clearPointer()
  },
}
