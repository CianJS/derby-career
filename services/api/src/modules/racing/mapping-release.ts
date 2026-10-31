import { inspectRaceMapping } from './mapping'
import type { Course, RaceSchedule } from './catalog'
import {
  canonicalMappingValue,
  validateMappingRegistry,
} from '../../../../../packages/shared/src/race-mapping'
import { sapporoPilot } from '../../../../../packages/shared/src/sapporo-pilot'
import type { ApprovedPlayable } from '../../../../../packages/shared/src/approved-playable'

/** Node-only derivation; callers never accept these records from an HTTP or save payload. */
export function deriveApprovedPlayable(
  inputs: unknown,
  races: RaceSchedule[],
  courses: Course[],
  allowTestEvidence = false,
): ApprovedPlayable[] {
  if (!Array.isArray(inputs) || inputs.length > 1) {
    throw new Error('Only the Sapporo pilot can be approved')
  }
  const outputs: ApprovedPlayable[] = []
  for (const input of inputs) {
    const reference = races.find((r) => r.id === sapporoPilot.source.id)
    const course = courses.find((c) => c.id === sapporoPilot.courseModel.id)
    if (!reference || !course) {
      throw new Error('Sapporo reference or course missing')
    }
    const result = inspectRaceMapping(input, reference, course, sapporoPilot.definition)
    if (!result.mapping || result.reasons.length) {
      throw new Error(`Mapping rejected: ${result.reasons.join(', ')}`)
    }
    const m = result.mapping
    if (
      m.referenceId !== reference.id ||
      m.gameDefinitionId !== sapporoPilot.definition.id ||
      m.courseId !== course.id ||
      m.opponents?.profile !== 'sapporo-g3-2yo-v1' ||
      canonicalMappingValue(m.definition) !== canonicalMappingValue(sapporoPilot.definition)
    ) {
      throw new Error('Pilot identity or definition differs from reviewed proposal')
    }
    const registry = validateMappingRegistry(
      [m],
      [{ reference, course, definition: sapporoPilot.definition }],
    )
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
    outputs.push({
      sourceId: reference.id,
      definitionId: m.gameDefinitionId,
      revision: m.revision,
      courseId: course.id,
      opponentProfile: m.opponents.profile,
      definition: m.definition!,
    })
  }
  return outputs
}
