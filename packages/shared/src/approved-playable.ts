import data from './approved-playable.json'
import history from './approved-playable-history.json'
import type { RaceDefinitionSnapshot, OpponentProfile } from '../../../lib/career/race-entry'

export type ApprovedPlayable = Readonly<{
  sourceId: string
  definitionId: string
  revision: string
  courseId: string
  opponentProfile: OpponentProfile
  definition: RaceDefinitionSnapshot
}>

// The release file is checked against the independently verified mapping in CI.
// No browser input or candidate state can populate this registry.
const registry = Object.freeze(
  (data as ApprovedPlayable[]).map((entry) =>
    Object.freeze({ ...entry, definition: Object.freeze({ ...entry.definition }) }),
  ),
)
export const approvedPlayableDefinitions: readonly ApprovedPlayable[] = registry
export const approvedPlayableById = (id: string) =>
  registry.find((entry) => entry.definitionId === id)
const archive = Object.freeze(
  (history as ApprovedPlayable[]).map((entry) =>
    Object.freeze({ ...entry, definition: Object.freeze({ ...entry.definition }) }),
  ),
)
export const approvedPlayableByRevision = (id: string, revision: string | undefined) =>
  archive.find((entry) => entry.definitionId === id && entry.revision === revision)
