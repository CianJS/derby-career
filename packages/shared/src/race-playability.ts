import type { components } from './generated/api'

type RaceSchedule = components['schemas']['RaceSchedule']
type Playability = components['schemas']['ReferenceRacePlayability']

/** Reference facts are not game rules. No mapping/activation is inferred from a source ID. */
export function referenceRacePlayability(race: RaceSchedule): Playability {
  const reasons: Playability['reasons'] = [
    'mapping_not_approved',
    'opponents_not_approved',
    'recurrence_not_approved',
    'win_conditions_not_approved',
  ]
  if (race.verificationStatus !== 'verified') {
    reasons.push('source_not_verified')
  }
  if (race.duplicateGroup) {
    reasons.push('duplicate_review')
  }
  if (race.scheduleStatus === 'not_run') {
    reasons.push('not_run')
  }
  if (!race.raceDate) {
    reasons.push('date_unconfirmed')
  }
  if (!race.courseId) {
    reasons.push('course_unassigned')
  }
  if (!race.ageCondition) {
    reasons.push('age_unconfirmed')
  }
  if (race.sexCondition) {
    reasons.push('sex_rule_unsupported')
  }
  if (!race.originalEligibility) {
    reasons.push('eligibility_unconfirmed')
  }
  if (race.surface !== 'turf') {
    reasons.push('surface_unsupported')
  }
  if (race.grade !== 'Listed') {
    reasons.push('grade_unsupported')
  }
  if (race.distanceMeters === null) {
    reasons.push('distance_unconfirmed')
  }
  if (race.maxRunners === null) {
    reasons.push('runners_unconfirmed')
  }
  if (race.entryFee === null || race.gamePrizeMoney === null) {
    reasons.push('game_economy_unapproved')
  }
  return {
    sourceRaceId: race.id,
    sourceYear: race.year,
    sourceMonth: race.raceDate ? Number(race.raceDate.slice(5, 7)) : null,
    raceDefinitionId: null,
    status: 'blocked',
    eligible: false,
    calendarPolicy: 'not_approved',
    reasons,
  }
}

export function withReferencePlayability(race: RaceSchedule): RaceSchedule {
  return { ...race, playability: referenceRacePlayability(race) }
}

/** Pure full-source report, including duplicate rows suppressed by the public list. */
export function referenceRaceReport(races: readonly RaceSchedule[]) {
  if (new Set(races.map((race) => race.id)).size !== races.length) {
    throw new Error('Duplicate reference race ID')
  }
  const rows = races.map(referenceRacePlayability)
  const reasonCounts: Record<string, number> = {}
  for (const row of rows) {
    for (const reason of row.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
    }
  }
  return {
    version: 'reference-race-playability-v1',
    referenceRows: races.length,
    publicDistinctRows: new Set(races.map((r) => r.duplicateGroup ?? r.id)).size,
    playable: 0,
    blocked: rows.length,
    countries: Object.fromEntries(
      ['KOR', 'JPN', 'USA'].map((country) => [
        country,
        races.filter((r) => r.country === country).length,
      ]),
    ),
    reasonCounts,
    rows,
  }
}
