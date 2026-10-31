import approvals from '../../../config/approved-race-mappings.json'
import type { Query } from '../../db'
import {
  canonicalMappingValue,
  validateRaceMapping,
  type RaceMapping,
} from '../../../../../packages/shared/src/race-mapping'
import { approvedPlayableDefinitions } from '../../../../../packages/shared/src/approved-playable'
import { digest, type Course, type RaceSchedule } from './catalog'
import type { RaceDefinitionSnapshot } from '../../../../../lib/career/race-entry'
import { referenceRacePlayability } from '../../../../../packages/shared/src/race-playability'

/** Called inside the authoritative transaction, not from a browser-supplied mapping. */
export async function resolveOfficialEntry(tx: Query, sourceId: string, lock = false) {
  const manifest = approvedPlayableDefinitions.find((item) => item.sourceId === sourceId)
  if (!manifest) {
    return null
  }
  const suffix = lock ? ' FOR SHARE' : ''
  const reference = (
    await tx.query<{ payload: RaceSchedule }>(
      'SELECT payload FROM race_schedules WHERE id=$1' + suffix,
      [sourceId],
    )
  ).rows[0]?.payload
  const course = (
    await tx.query<{ payload: Course }>(
      'SELECT payload FROM racecourse_courses WHERE id=$1' + suffix,
      [manifest.courseId],
    )
  ).rows[0]?.payload
  const definition = (
    await tx.query<{
      payload: RaceDefinitionSnapshot
      country_code: string | null
      source_kind: string
    }>('SELECT payload,country_code,source_kind FROM race_definitions WHERE id=$1' + suffix, [
      manifest.definitionId,
    ])
  ).rows[0]
  const revision = (
    await tx.query<{ revision: string; source_race_id: string }>(
      'SELECT revision,source_race_id FROM official_race_mapping_revisions WHERE race_definition_id=$1' +
        suffix,
      [manifest.definitionId],
    )
  ).rows[0]
  if (
    !reference ||
    !course ||
    !definition ||
    definition.country_code !== 'JPN' ||
    definition.source_kind !== 'catalog' ||
    revision?.source_race_id !== sourceId ||
    revision.revision !== manifest.revision ||
    canonicalMappingValue(definition.payload) !== canonicalMappingValue(manifest.definition)
  ) {
    return null
  }
  try {
    const mappings = approvals as RaceMapping[]
    const mapping = mappings.find((item) => item.referenceId === sourceId)
    if (
      mappings.length !== 1 ||
      !mapping ||
      mapping.gameDefinitionId !== manifest.definitionId ||
      mapping.courseId !== manifest.courseId ||
      mapping.revision !== manifest.revision ||
      mapping.opponents?.profile !== manifest.opponentProfile ||
      canonicalMappingValue(mapping.definition) !== canonicalMappingValue(manifest.definition) ||
      validateRaceMapping(mapping, { reference, course, definition: definition.payload }).length !==
        0
    ) {
      return null
    }
    const { revision: mappingRevision, ...body } = mapping
    const { playability: _playability, ...source } = reference
    if (
      digest(source) !== mapping.sourceDigest ||
      digest(course) !== mapping.courseDigest ||
      digest(definition.payload) !== mapping.definitionDigest ||
      digest(body) !== mappingRevision
    ) {
      return null
    }
  } catch {
    return null
  }
  return { manifest, definition: definition.payload, reference }
}

export function officialReferencePlayability(
  entry: NonNullable<Awaited<ReturnType<typeof resolveOfficialEntry>>>,
) {
  return {
    ...referenceRacePlayability(entry.reference),
    raceDefinitionId: entry.manifest.definitionId,
    status: 'playable' as const,
    eligible: true as const,
    calendarPolicy: 'repeat_season_month' as const,
    reasons: [],
  }
}
