import type { components } from './generated/api'
import type { RaceDefinitionSnapshot } from '../../../lib/career/race-entry'
import {
  raceOccurrenceForTurn,
  raceEligibility,
  isRaceTurn,
  opponentProfileForRace,
} from '../../../lib/career/race-entry'
import { careerProgress } from '../../../lib/career/career-time'
import { canRace } from '../../../lib/career/health'
import type { Career } from '../../../lib/career/model'
import type { StableTravel } from '../../../lib/career/local-travel'
import { convertJpyRaceAmount, type RaceCurrencyPolicy } from './race-currency-policy'
import { sapporoOfficialFacts } from './sapporo-official-facts'

type Schedule = components['schemas']['RaceSchedule']
type Course = components['schemas']['Course']
const factKeys = [
  'id',
  'name',
  'year',
  'raceDate',
  'scheduleStatus',
  'country',
  'racecourseId',
  'courseId',
  'grade',
  'surface',
  'distanceMeters',
  'distanceBasis',
  'ageCondition',
  'sexCondition',
  'originalEligibility',
  'maxRunners',
  'gamePrizeMoney',
  'entryFee',
  'duplicateGroup',
  'verificationStatus',
  'sourceUrl',
] as const
export type MappingSourceFacts = Pick<Schedule, (typeof factKeys)[number]>
export const mappingDecisionFields = [
  'identity',
  'duplicate',
  'country',
  'course',
  'surface',
  'distance',
  'grade',
  'age',
  'sex',
  'wins',
  'economy',
  'opponents',
  'calendar',
] as const
export type MappingDecisionField = (typeof mappingDecisionFields)[number]
export type RaceMapping = {
  version: 1
  referenceId: string
  gameDefinitionId: string | null
  state: 'candidate' | 'verified' | 'approved'
  sourceDigest: string
  source: MappingSourceFacts
  definitionDigest: string | null
  definition: RaceDefinitionSnapshot | null
  courseId: string | null
  courseDigest: string | null
  courseSnapshot: Course | null
  eligibility: {
    minAge: number
    maxAge: number | null
    sex: 'any'
    minWins: number | null
    maxWins: number | null
  } | null
  calendar: {
    referenceYear: number
    firstGameYear: 2028
    seasonMonth: number
    policy: 'repeat_season_month'
  } | null
  economy:
    | { entryFee: number; firstPrize: number; currency: 'KRW'; basis: 'game_balance' }
    | {
        entryFee: number
        firstPrize: number
        currency: 'KRW'
        basis: 'source_conversion_v1'
        sourceRevision: string
        feeBasis: 'jra_central_special_registration'
        entryFeeJPY: number
        firstPrizeJPY: number
        policy: RaceCurrencyPolicy
      }
    | null
  opponents: { profile: 'shared-development-v1' | 'sapporo-g3-2yo-v1'; runners: number } | null
  decisions: Partial<
    Record<
      MappingDecisionField,
      { status: 'verified' | 'approved'; reference: string; reviewer: string }
    >
  >
  revision: string
}
export type MappingContext = {
  reference: Schedule
  course: Course | null
  definition: RaceDefinitionSnapshot | null
}
export function mappingSourceFacts(race: Schedule): MappingSourceFacts {
  return Object.fromEntries(factKeys.map((k) => [k, race[k]])) as MappingSourceFacts
}
/** Portable structural comparison. Cryptographic provenance is checked by the Backend audit. */
export function canonicalMappingValue(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalMappingValue).join(',') + ']'
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonicalMappingValue(v))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value)
}
/** No heuristic joins: every approved record pins the exact source and game definition. */
export function validateRaceMapping(mapping: RaceMapping, context: MappingContext): string[] {
  const reasons: string[] = []
  const fail = (code: string) => {
    if (!reasons.includes(code)) {
      reasons.push(code)
    }
  }
  const ref = context.reference,
    game = mapping.definition,
    actual = context.definition,
    course = context.course
  const hash = /^[a-f0-9]{64}$/
  if (mapping.version !== 1) {
    fail('mapping_version_unsupported')
  }
  if (!hash.test(mapping.sourceDigest) || !hash.test(mapping.revision)) {
    fail('mapping_digest_missing')
  }
  if (
    mapping.referenceId !== ref.id ||
    canonicalMappingValue(mapping.source) !== canonicalMappingValue(mappingSourceFacts(ref))
  ) {
    fail('reference_changed')
  }
  if (
    ref.verificationStatus !== 'verified' ||
    !ref.sourceUrl ||
    mapping.source.sourceUrl !== ref.sourceUrl
  ) {
    fail('source_not_verified')
  }
  if (
    ref.scheduleStatus !== 'dated' ||
    !ref.raceDate ||
    Number(ref.raceDate.slice(0, 4)) !== ref.year
  ) {
    fail('calendar_source_unconfirmed')
  }
  if (mapping.state !== 'approved') {
    fail('mapping_not_approved')
  }
  for (const field of mappingDecisionFields) {
    const decision = mapping.decisions[field]
    if (
      !decision ||
      decision.status !== 'approved' ||
      !/^https:\/\//.test(decision.reference) ||
      !decision.reviewer.trim()
    ) {
      fail('approval_required:' + field)
    }
  }
  if (
    !game ||
    !actual ||
    !mapping.gameDefinitionId ||
    !mapping.definitionDigest ||
    !hash.test(mapping.definitionDigest)
  ) {
    fail('game_definition_missing')
  } else {
    if (
      mapping.gameDefinitionId !== game.id ||
      actual.id !== game.id ||
      canonicalMappingValue(game) !== canonicalMappingValue(actual)
    ) {
      fail('game_definition_changed')
    }
    if (game.id.startsWith('DEV_')) {
      fail('development_identity_not_official')
    }
    if (game.name !== ref.name || game.countryCode !== ref.country) {
      fail('identity_mismatch')
    }
    if (game.surface !== 'Turf' || ref.surface !== 'turf') {
      fail('surface_unsupported')
    }
    if (
      !Number.isSafeInteger(game.distance) ||
      game.distance <= 0 ||
      game.distance !== ref.distanceMeters ||
      ref.distanceBasis !== 'source_meters'
    ) {
      fail('distance_unconfirmed')
    }
    if (!(
      (game.raceClass === 'Listed' && ref.grade === 'Listed') ||
      (game.raceClass === 'G3' && ref.grade === 'G3')
    )) {
      fail('grade_unsupported')
    }
    // New conversion revisions explicitly pin the corrected source; historical
    // game_balance revisions continue to use their original source facts.
    const verifiedMaximum = sapporoOfficialFacts.corrections.find(
      (item) => item.field === 'officialMaximumStarters',
    )
    const sourceMaximum =
      ref.maxRunners ??
      (mapping.economy?.basis === 'source_conversion_v1' &&
      mapping.economy.sourceRevision === sapporoOfficialFacts.version &&
      ref.id === sapporoOfficialFacts.sourceId &&
      ref.year === sapporoOfficialFacts.applicableYear &&
      mapping.sourceDigest === sapporoOfficialFacts.baseSourceDigest &&
      verifiedMaximum?.verificationStatus === 'verified' &&
      typeof verifiedMaximum.newValue === 'number'
        ? verifiedMaximum.newValue
        : null)
    if (
      !Number.isInteger(game.runners) ||
      game.runners < 2 ||
      game.runners > 18 ||
      (sourceMaximum !== null &&
        (!Number.isInteger(sourceMaximum) || sourceMaximum < 2 || game.runners > sourceMaximum))
    ) {
      fail('runners_unconfirmed')
    }
    if (
      !mapping.opponents ||
      mapping.opponents.profile !== opponentProfileForRace(game) ||
      (game.raceClass === 'G3' && mapping.opponents.profile !== 'sapporo-g3-2yo-v1') ||
      mapping.opponents.runners !== game.runners
    ) {
      fail('opponents_not_approved')
    }
    if (
      !mapping.economy ||
      mapping.economy.currency !== 'KRW' ||
      !['game_balance', 'source_conversion_v1'].includes(mapping.economy.basis) ||
      !Number.isSafeInteger(game.entryFee) ||
      game.entryFee < 0 ||
      !Number.isSafeInteger(game.prize) ||
      game.prize < 0 ||
      mapping.economy.entryFee !== game.entryFee ||
      mapping.economy.firstPrize !== game.prize
    ) {
      fail('game_economy_unapproved')
    }
    if (mapping.economy?.basis === 'source_conversion_v1') {
      const economy = mapping.economy
      const correction = (field: string) => {
        const fact = sapporoOfficialFacts.corrections.find((item) => item.field === field)
        return fact?.verificationStatus === 'verified' && typeof fact.newValue === 'number'
          ? fact.newValue
          : null
      }
      const firstStage = correction('specialRegistrationJPY.central.first')
      const secondStage = correction('specialRegistrationJPY.central.second')
      const sourcePrize = correction('officialPrizeJPY.place1')
      if (
        ref.id !== sapporoOfficialFacts.sourceId ||
        ref.year !== sapporoOfficialFacts.applicableYear ||
        mapping.sourceDigest !== sapporoOfficialFacts.baseSourceDigest ||
        ref.verificationStatus !== 'verified' ||
        economy.sourceRevision !== sapporoOfficialFacts.version ||
        economy.feeBasis !== 'jra_central_special_registration' ||
        firstStage === null ||
        secondStage === null ||
        sourcePrize === null ||
        economy.entryFeeJPY !== firstStage + secondStage ||
        economy.firstPrizeJPY !== sourcePrize ||
        ref.prizeMoney !== sourcePrize ||
        ref.prizeCurrency !== 'JPY'
      ) {
        fail('game_economy_source_unconfirmed')
      }
      try {
        const fee = convertJpyRaceAmount(economy.entryFeeJPY, economy.policy)
        const prize = convertJpyRaceAmount(economy.firstPrizeJPY, economy.policy)
        if (
          !fee ||
          !prize ||
          fee.amountKRW !== economy.entryFee ||
          prize.amountKRW !== economy.firstPrize
        ) {
          fail('game_economy_conversion_invalid')
        }
      } catch {
        fail('game_economy_conversion_invalid')
      }
    }
    // Missing source game values may be approved independently in the mapping.
    // Present source values must agree; official total purse is never a substitute.
    if (
      (ref.entryFee !== null && ref.entryFee !== game.entryFee) ||
      (ref.gamePrizeMoney !== null && ref.gamePrizeMoney !== game.prize)
    ) {
      fail('game_economy_source_unconfirmed')
    }
    const calendar = mapping.calendar
    if (
      !calendar ||
      calendar.policy !== 'repeat_season_month' ||
      calendar.firstGameYear !== 2028 ||
      calendar.referenceYear !== ref.year ||
      calendar.seasonMonth !== Number(ref.raceDate?.slice(5, 7)) ||
      calendar.seasonMonth !== game.month ||
      !Number.isInteger(game.month) ||
      game.month < 1 ||
      game.month > 12
    ) {
      fail('recurrence_not_approved')
    }
  }
  if (
    !course ||
    !mapping.courseId ||
    !mapping.courseDigest ||
    !hash.test(mapping.courseDigest) ||
    canonicalMappingValue(mapping.courseSnapshot) !== canonicalMappingValue(course) ||
    course.id !== mapping.courseId ||
    (ref.courseId !== null && ref.courseId !== mapping.courseId) ||
    course.racecourseId !== ref.racecourseId ||
    course.surface !== 'turf' ||
    course.verificationStatus !== 'verified' ||
    !course.sourceUrl ||
    !course.configuration ||
    !course.direction ||
    course.straightLength === null ||
    !game?.courseProfile.trim()
  ) {
    fail('course_unassigned_or_unverified')
  }
  const rule = mapping.eligibility
  const age = ref.ageCondition?.match(/^(\d+)세( 이상)?$/)
  if (
    !rule ||
    !age ||
    !ref.originalEligibility ||
    rule.minAge !== Number(age[1]) ||
    rule.maxAge !== (age[2] ? null : Number(age[1])) ||
    !Number.isInteger(rule.minAge) ||
    rule.minAge < 2 ||
    (rule.maxAge !== null && rule.maxAge < rule.minAge) ||
    (game?.raceClass === 'G3' &&
      (game.minAge !== rule.minAge || (game.maxAge ?? null) !== rule.maxAge))
  ) {
    fail('age_unconfirmed')
  }
  if (
    !rule ||
    rule.sex !== 'any' ||
    ref.sexCondition !== null ||
    ref.originalEligibility !== ref.ageCondition
  ) {
    fail('sex_rule_unsupported')
  }
  if (
    !rule ||
    (rule.minWins !== null && (!Number.isSafeInteger(rule.minWins) || rule.minWins < 0)) ||
    (rule.maxWins !== null &&
      (!Number.isSafeInteger(rule.maxWins) ||
        rule.maxWins < 0 ||
        (rule.minWins !== null && rule.maxWins < rule.minWins))) ||
    (rule.minWins === null ? game?.minWins !== undefined : game?.minWins !== rule.minWins) ||
    (game?.maxWins ?? null) !== rule.maxWins
  ) {
    fail('win_conditions_not_approved')
  }
  // Absence of a uniform minimum is not approval for every affiliation. The
  // current engine cannot yet establish affiliation-specific eligibility.
  if (
    rule?.minWins === null &&
    ref.id === sapporoOfficialFacts.sourceId &&
    game?.raceClass === 'G3'
  ) {
    fail('affiliation_eligibility_unsupported')
  }
  return reasons
}
/** Declarative review never activates entries. Separate release wiring and DB data are mandatory. */
export const raceMappingRegistry: Readonly<{
  version: 1
  activation: 'disabled'
  mappings: readonly RaceMapping[]
}> = Object.freeze({ version: 1, activation: 'disabled', mappings: Object.freeze([]) })
export function validateMappingRegistry(
  mappings: readonly RaceMapping[],
  contexts: readonly MappingContext[],
): { referenceId: string; gameDefinitionId: string | null; reasons: string[] }[] {
  return mappings.map((mapping) => {
    const context = contexts.find((c) => c.reference.id === mapping.referenceId)
    const reasons = context ? validateRaceMapping(mapping, context) : ['reference_missing']
    if (contexts.filter((c) => c.reference.id === mapping.referenceId).length > 1) {
      reasons.push('ambiguous_reference_context')
    }
    if (mappings.filter((m) => m.referenceId === mapping.referenceId).length !== 1) {
      reasons.push('duplicate_reference_mapping')
    }
    if (
      mapping.gameDefinitionId &&
      mappings.filter((m) => m.gameDefinitionId === mapping.gameDefinitionId).length !== 1
    ) {
      reasons.push('duplicate_game_mapping')
    }
    if (
      context?.reference.duplicateGroup &&
      contexts.some(
        (c) =>
          c.reference.id !== mapping.referenceId &&
          c.reference.duplicateGroup === context.reference.duplicateGroup &&
          mappings.some((m) => m.referenceId === c.reference.id),
      )
    ) {
      reasons.push('duplicate_source_group')
    }
    return { referenceId: mapping.referenceId, gameDefinitionId: mapping.gameDefinitionId, reasons }
  })
}
/** Shared future Local/Server entry boundary; never an HTTP approval or registration command. */
export async function previewMappedEntry(
  mapping: RaceMapping,
  context: MappingContext,
  career: Career,
  funds: number,
  travel: StableTravel,
  jockeyId: string,
): Promise<{ race: RaceDefinitionSnapshot | null; reason: string | null }> {
  const issues = validateRaceMapping(mapping, context)
  if (issues.length) {
    return { race: null, reason: issues[0] }
  }
  const { playability: _playability, ...source } = context.reference
  const { revision, ...body } = mapping
  const sha = async (value: unknown) =>
    Array.from(
      new Uint8Array(
        await globalThis.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(canonicalMappingValue(value)),
        ),
      ),
    )
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  try {
    const [sourceHash, definitionHash, courseHash, revisionHash] = await Promise.all([
      sha(source),
      sha(context.definition),
      sha(context.course),
      sha(body),
    ])
    if (
      sourceHash !== mapping.sourceDigest ||
      definitionHash !== mapping.definitionDigest ||
      courseHash !== mapping.courseDigest ||
      revisionHash !== revision
    ) {
      return { race: null, reason: 'mapping_provenance_changed' }
    }
  } catch {
    return { race: null, reason: 'mapping_provenance_unavailable' }
  }
  if (career.action || career.raceRun) {
    return { race: null, reason: 'monthly_action_locked' }
  }
  if (!career.contractedJockeyIds.includes(jockeyId)) {
    return { race: null, reason: 'jockey_not_contracted' }
  }
  if (!canRace(career.health)) {
    return { race: null, reason: 'health_restricted' }
  }
  if (career.calendarDate.year < mapping.calendar!.firstGameYear) {
    return { race: null, reason: 'game_calendar_year_restricted' }
  }
  const race = raceOccurrenceForTurn(mapping.definition!, career.careerTurnIndex)
  if (!race) {
    return { race: null, reason: 'not_current_season_month' }
  }
  if (!isRaceTurn(career.careerTurnIndex)) {
    return { race: null, reason: 'live_calendar_not_supported' }
  }

  const age = careerProgress(career.careerTurnIndex).age,
    rule = mapping.eligibility!
  if (age < rule.minAge || (rule.maxAge !== null && age > rule.maxAge)) {
    return { race: null, reason: 'age_restricted' }
  }
  return { race: structuredClone(race), reason: raceEligibility(career, race, funds, travel) }
}
