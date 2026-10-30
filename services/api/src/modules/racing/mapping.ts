import { z } from 'zod'
import { validateCourse } from '../../../../../packages/shared/src/generated/save-validation.mjs'
import { digest } from './catalog'
import type { Course, RaceSchedule } from './catalog'
import {
  referenceRaceReport,
  referenceRacePlayability,
} from '../../../../../packages/shared/src/race-playability'
import {
  mappingSourceFacts,
  mappingDecisionFields,
  validateRaceMapping,
  validateMappingRegistry,
  raceMappingRegistry,
  type RaceMapping,
} from '../../../../../packages/shared/src/race-mapping'
import { raceDefinitions } from '../../../../../packages/shared/src/domain'
import { expeditionFixtures } from '../../services/expedition-fixtures'
import { validateRaceDefinition } from './mapping-definition-validation'

const sha = z.string().regex(/^[a-f0-9]{64}$/)
const positive = z.number().int().nonnegative()
const decisions = z.partialRecord(
  z.enum(mappingDecisionFields),
  z
    .object({
      status: z.enum(['verified', 'approved']),
      reference: z.url(),
      reviewer: z.string().min(1),
    })
    .strict(),
)
export const raceMappingSchema = z
  .object({
    version: z.literal(1),
    referenceId: z.string().regex(/^[A-Z][A-Z0-9_]{1,119}$/),
    gameDefinitionId: z.string().nullable(),
    state: z.enum(['candidate', 'verified', 'approved']),
    sourceDigest: sha,
    source: z.record(z.string(), z.unknown()),
    definitionDigest: sha.nullable(),
    definition: z.record(z.string(), z.unknown()).nullable(),
    courseId: z.string().nullable(),
    courseDigest: sha.nullable(),
    courseSnapshot: z.record(z.string(), z.unknown()).nullable(),
    eligibility: z
      .object({
        minAge: z.number().int().min(2),
        maxAge: z.number().int().min(2).nullable(),
        sex: z.literal('any'),
        minWins: positive,
        maxWins: positive.nullable(),
      })
      .strict()
      .nullable(),
    calendar: z
      .object({
        referenceYear: z.number().int(),
        firstGameYear: z.literal(2028),
        seasonMonth: z.number().int().min(1).max(12),
        policy: z.literal('repeat_season_month'),
      })
      .strict()
      .nullable(),
    economy: z
      .object({
        entryFee: positive,
        firstPrize: positive,
        currency: z.literal('KRW'),
        basis: z.literal('game_balance'),
      })
      .strict()
      .nullable(),
    opponents: z
      .object({
        profile: z.enum(['shared-development-v1', 'sapporo-g3-2yo-v1']),
        runners: z.number().int().min(2).max(18),
      })
      .strict()
      .nullable(),
    decisions,
    revision: sha,
  })
  .strict()
export function inspectRaceMapping(
  input: unknown,
  reference: RaceSchedule,
  course: Course | null,
  definition: RaceMapping['definition'],
) {
  const parsed = raceMappingSchema.safeParse(input)
  if (!parsed.success) {
    return {
      mapping: null,
      reasons: ['mapping_schema_invalid'],
      details: parsed.error.issues.map((i) => i.path.join('.') + ':' + i.message),
    }
  }
  const mapping = parsed.data as unknown as RaceMapping
  if (mapping.definition && !validateRaceDefinition(mapping.definition)) {
    return { mapping: null, reasons: ['definition_schema_invalid'], details: [] as string[] }
  }
  if (mapping.courseSnapshot && !validateCourse(mapping.courseSnapshot)) {
    return { mapping: null, reasons: ['course_schema_invalid'], details: [] as string[] }
  }
  const reasons = validateRaceMapping(mapping, { reference, course, definition })
  if (mapping.courseSnapshot && digest(mapping.courseSnapshot) !== mapping.courseDigest) {
    reasons.push('course_digest_changed')
  }
  if (course && mapping.courseDigest && digest(course) !== mapping.courseDigest) {
    reasons.push('course_definition_changed')
  }

  const { revision, ...body } = mapping
  if (digest(body) !== revision) {
    reasons.push('mapping_revision_changed')
  }
  const { playability: _playability, ...source } = reference
  if (digest(source) !== mapping.sourceDigest) {
    reasons.push('source_digest_changed')
  }
  if (
    mapping.definition &&
    (digest(mapping.definition) !== mapping.definitionDigest ||
      !validateRaceDefinition(mapping.definition))
  ) {
    reasons.push('definition_digest_or_schema_changed')
  }
  return { mapping, reasons, details: [] as string[] }
}
export function buildRaceMappingReport(races: RaceSchedule[], courses: Course[]) {
  const initial = referenceRaceReport(races)
  const existing = [
    ...raceDefinitions.map((r) => ({ ...r, countryCode: r.countryCode ?? 'KOR' })),
    ...expeditionFixtures,
  ]
  const candidates = races.map((reference) => {
    const state = referenceRacePlayability(reference)
    const body = {
      version: 1 as const,
      referenceId: reference.id,
      gameDefinitionId: null,
      state: 'candidate' as const,
      sourceDigest: digest(reference),
      source: mappingSourceFacts(reference),
      definitionDigest: null,
      definition: null,
      courseId: null,
      courseDigest: null,
      courseSnapshot: null,
      eligibility: null,
      calendar: null,
      economy: null,
      opponents: null,
      decisions: {},
    }
    const mapping = { ...body, revision: digest(body) }
    const result = inspectRaceMapping(mapping, reference, null, null)
    return {
      mapping,
      reasons: state.reasons,
      validationReasons: result.reasons,
      decisionsRequired: [...mappingDecisionFields],
      verifiedSource: reference.verificationStatus === 'verified',
      matchingGameDefinitions: [] as string[],
      evidence:
        '기존 19개 DEV 정의에는 공식 source ID/승인 증거가 없어 이름·거리 유사 매칭을 수행하지 않음',
    }
  })
  const checks = validateMappingRegistry(
    raceMappingRegistry.mappings,
    races.map((reference) => ({
      reference,
      course: courses.find((c) => c.id === reference.courseId) ?? null,
      definition: null,
    })),
  )
  if (raceMappingRegistry.activation !== 'disabled' || raceMappingRegistry.mappings.length) {
    throw Error('Activation requires a separately approved runtime/data PR')
  }
  return {
    version: 'official-race-mapping-report-v1',
    activation: 'disabled',
    sourceDigest: digest(races),
    referenceRows: initial.referenceRows,
    publicDistinctRows: initial.publicDistinctRows,
    verifiedSources: races.filter((r) => r.verificationStatus === 'verified').length,
    missingSourceFacts: races.filter(
      (r) =>
        r.courseId === null ||
        r.entryFee === null ||
        r.gamePrizeMoney === null ||
        r.maxRunners === null ||
        r.ageCondition === null,
    ).length,
    blocked: races.length,
    approvedMappings: 0,
    playable: 0,
    existingGameDefinitions: existing.map((r) => ({
      id: r.id,
      digest: digest(r),
      officialReferenceId: null,
      reason: 'development_fixture_without_verified_official_identity',
    })),
    reasonCounts: initial.reasonCounts,
    registryChecks: checks,
    candidates,
  }
}
