import { inspectRaceMapping, raceMappingSchema } from './mapping'
import type { Course, RaceSchedule } from './catalog'
import {
  validateMappingRegistry,
  canonicalMappingValue,
} from '../../../../../packages/shared/src/race-mapping'
import { sapporoPilot } from '../../../../../packages/shared/src/sapporo-pilot'
import type { ApprovedPlayable } from '../../../../../packages/shared/src/approved-playable'
import type { RaceDefinitionSnapshot } from '../../../../../lib/career/race-entry'

export function assertHistoryAppendOnly(previous: unknown, current: unknown): void {
  if (!Array.isArray(previous) || !Array.isArray(current)) {
    throw new Error('Historical approvals must be arrays')
  }
  const retained = new Set(current.map((item) => canonicalMappingValue(item)))
  if (previous.some((item) => !retained.has(canonicalMappingValue(item)))) {
    throw new Error('A previously released historical approval was removed or changed')
  }
}

/** Node-only derivation; callers never accept these records from an HTTP or save payload. */
export function deriveApprovedPlayable(
  inputs: unknown,
  races: RaceSchedule[],
  courses: Course[],
  allowTestEvidence = false,
  historical = false,
): ApprovedPlayable[] {
  if (!Array.isArray(inputs) || (!historical && inputs.length > 1)) {
    throw new Error('Only the Sapporo pilot can be approved')
  }
  const outputs: ApprovedPlayable[] = []
  for (const input of inputs) {
    const reference = races.find((r) => r.id === sapporoPilot.source.id)
    const course = courses.find((c) => c.id === sapporoPilot.courseModel.id)
    if (!reference || !course) {
      throw new Error('Sapporo reference or course missing')
    }
    const parsed = raceMappingSchema.safeParse(input)
    const definition = parsed.success ? parsed.data.definition : null
    const result = inspectRaceMapping(
      input,
      reference,
      course,
      definition as RaceDefinitionSnapshot | null,
    )
    if (!result.mapping || result.reasons.length) {
      throw new Error(`Mapping rejected: ${result.reasons.join(', ')}`)
    }
    const m = result.mapping
    if (
      m.referenceId !== reference.id ||
      m.gameDefinitionId !== sapporoPilot.definition.id ||
      m.courseId !== course.id ||
      m.opponents?.profile !== 'sapporo-g3-2yo-v1'
    ) {
      throw new Error('Pilot identity or definition differs from reviewed proposal')
    }
    const registry = validateMappingRegistry([m], [{ reference, course, definition: m.definition }])
    if (registry[0].reasons.length) {
      throw new Error(`Registry rejected: ${registry[0].reasons.join(', ')}`)
    }
    if (
      !allowTestEvidence &&
      Object.values(m.decisions).some(
        (d) =>
          !d ||
          !/^https:\/\/(github\.com\/CianJS\/derby-career\/|app\.notion\.com\/)/.test(
            d.reference,
          ) ||
          /fixture|test/i.test(d.reviewer),
      )
    ) {
      throw new Error('Release approval must reference real project evidence and reviewer')
    }
    // A conversion helper alone does not approve a policy, select entrants by
    // affiliation, or provide the occurrence field. Fail closed until those
    // decisions and runtime paths are complete; historical replays still work.
    if (!historical && !allowTestEvidence) {
      throw new Error(
        'Sapporo activation blocked: currency policy, affiliation and occurrence field unresolved',
      )
    }
    outputs.push({
      sourceId: reference.id,
      definitionId: m.gameDefinitionId,
      revision: m.revision,
      courseId: course.id,
      opponentProfile: m.opponents.profile,
      definition: m.definition!,
    })
  }
  if (new Set(outputs.map((entry) => entry.revision)).size !== outputs.length) {
    throw new Error('Duplicate approval revision')
  }
  return outputs
}

/** Historical source/course snapshots are retained with their approved mapping. */
export function deriveApprovedHistory(
  inputs: unknown,
  allowTestEvidence = false,
): ApprovedPlayable[] {
  if (!Array.isArray(inputs)) {
    throw new Error('Historical approvals must be an array')
  }
  const entries = inputs.flatMap(
    (entry: { mapping: unknown; reference: RaceSchedule; course: Course }) => {
      if (!entry || !entry.reference || !entry.course) {
        throw new Error('Historical approval source snapshots are missing')
      }
      return deriveApprovedPlayable(
        [entry.mapping],
        [entry.reference],
        [entry.course],
        allowTestEvidence,
        true,
      )
    },
  )
  if (new Set(entries.map((entry) => entry.revision)).size !== entries.length) {
    throw new Error('Duplicate historical approval revision')
  }
  return entries
}
