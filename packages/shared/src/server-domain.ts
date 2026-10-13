import {
  startCareer,
  commitAction,
  resolveAction,
  advanceMonth,
  completeRace,
  type Career,
  type Choice,
  type AdjustActionDeltas,
} from './domain'
import { createEventCatalog } from '../../../lib/career/events/repository'

// The API persists full Notion event snapshots in DB. Keep the browser fixture Director unenrolled.
// This only selects the persistence/event authority; growth, treatment and aftermath use shared functions.
const noBrowserEvents = createEventCatalog([])
export const API_RACE_ENGINE_VERSION = 'race-sim-v2' as const
export function withoutBrowserEvents(state: Career): Career {
  const next = { ...state }
  delete next.event
  delete next.eventLog
  delete next.eventMisses
  return next
}
export const startServerCareer = (definitionId: string) =>
  withoutBrowserEvents(startCareer(definitionId))
export const resolveServerAction = (
  state: Career,
  choice: Choice,
  adjustDeltas?: AdjustActionDeltas,
) =>
  withoutBrowserEvents(
    resolveAction(commitAction(withoutBrowserEvents(state), choice), noBrowserEvents, adjustDeltas),
  )
export const advanceServerMonth = (state: Career, actionId: string) =>
  withoutBrowserEvents(advanceMonth(withoutBrowserEvents(state), actionId))
export const completeServerRace = (state: Career, runId: string, placing: number, prize: number) =>
  withoutBrowserEvents(completeRace(withoutBrowserEvents(state), runId, placing, prize))
