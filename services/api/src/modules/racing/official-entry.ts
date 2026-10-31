import approvals from '../../../config/approved-race-mappings.json'
import type { Query } from '../../db'
import {
  canonicalMappingValue,
  validateRaceMapping,
  type RaceMapping,
} from '../../../../../packages/shared/src/race-mapping'
import {
  approvedPlayableDefinitions,
  approvedPlayableByRevision,
} from '../../../../../packages/shared/src/approved-playable'
import { digest, type Course, type RaceSchedule } from './catalog'
import type { RaceDefinitionSnapshot } from '../../../../../lib/career/race-entry'
import { referenceRacePlayability } from '../../../../../packages/shared/src/race-playability'
import { raceOccurrenceForTurn, type RaceRunInput } from '../../../../../lib/career/race-entry'
import { ApiError } from '../../errors'

export async function assertHistoricalOfficialRun(tx: Query, run: RaceRunInput) {
  if (run.raceDefinitionSnapshot.id !== sapporoPilotId) {
    return
  }
  const approved = approvedPlayableByRevision(run.raceDefinitionSnapshot.id, run.mappingRevision)
  const row =
    approved &&
    (
      await tx.query<{ snapshot: unknown; source_race_id: string }>(
        'SELECT snapshot,source_race_id FROM official_race_mapping_history WHERE race_definition_id=$1 AND revision=$2',
        [approved.definitionId, approved.revision],
      )
    ).rows[0]
  const definition = approved && raceOccurrenceForTurn(approved.definition, run.month)
  if (
    !approved ||
    !row ||
    row.source_race_id !== approved.sourceId ||
    canonicalMappingValue(row.snapshot) !== canonicalMappingValue(approved) ||
    !definition ||
    canonicalMappingValue(run.raceDefinitionSnapshot) !== canonicalMappingValue(definition) ||
    run.opponentProfile !== approved.opponentProfile
  ) {
    throw new ApiError(500, 'CORRUPT_RACE_MAPPING', '저장된 경주 승인 이력을 확인할 수 없습니다.')
  }
}
const sapporoPilotId = 'JPN_SAPPORO_NISAI_G3'

/** Called inside the authoritative transaction, not from a browser-supplied mapping. */
export async function resolveOfficialEntry(tx: Query, sourceId: string, lock = false) {
  const manifest = approvedPlayableDefinitions.find((item) => item.sourceId === sourceId)
  if (!manifest) {
    return null
  }
  const historical = approvedPlayableByRevision(manifest.definitionId, manifest.revision)
  const savedHistory =
    historical &&
    (
      await tx.query<{ snapshot: unknown; source_race_id: string }>(
        'SELECT snapshot,source_race_id FROM official_race_mapping_history WHERE race_definition_id=$1 AND revision=$2' +
          (lock ? ' FOR SHARE' : ''),
        [manifest.definitionId, manifest.revision],
      )
    ).rows[0]
  if (
    !historical ||
    !savedHistory ||
    savedHistory.source_race_id !== manifest.sourceId ||
    canonicalMappingValue(savedHistory.snapshot) !== canonicalMappingValue(historical) ||
    canonicalMappingValue(historical) !== canonicalMappingValue(manifest)
  ) {
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
