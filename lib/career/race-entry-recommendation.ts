import type { Career } from './model'
import {
  contractedRoster,
  distanceAptitude,
  entryRestriction,
  grade,
  raceEligibility,
  racesForTurn,
  ridingFit,
  tactics,
  type RaceEntryDraft,
} from './race-entry'

const emptyDraft = (): RaceEntryDraft => ({ raceId: null, jockeyId: null, tactic: null })
function aptitudeRank(career: Career, name: string): number {
  const rank = ['A', 'B', 'C', 'D'].indexOf(grade(career.horse.aptitude, name))
  return rank < 0 ? 4 : rank
}

/** Defaults use existing eligibility, distance buckets and riding-fit rules, without simulating a race. */
export function recommendRaceEntry(career: Career, raceId?: string): RaceEntryDraft {
  if (career.raceRun) {
    return {
      raceId: career.raceRun.raceDefinitionSnapshot.id,
      jockeyId: career.raceRun.player.jockeySnapshot.id,
      tactic: career.raceRun.player.tactic,
    }
  }
  if (entryRestriction(career)) {
    return emptyDraft()
  }
  const eligible = racesForTurn(career.careerTurnIndex).filter(
    (race) => !raceEligibility(career, race),
  )
  const race = raceId
    ? eligible.find((candidate) => candidate.id === raceId)
    : eligible.reduce((best, candidate) =>
        aptitudeRank(career, distanceAptitude(candidate.distance)) <
        aptitudeRank(career, distanceAptitude(best.distance))
          ? candidate
          : best,
      )
  if (!race) {
    return emptyDraft()
  }
  // Equal scores retain catalog order so reopening the screen never rerolls a recommendation.
  let draft: RaceEntryDraft = {
    raceId: race.id,
    jockeyId: null,
    tactic: tactics.reduce((best, candidate) =>
      aptitudeRank(career, candidate) < aptitudeRank(career, best) ? candidate : best,
    ),
  }
  let bestScore = -Infinity
  const roster = contractedRoster(career)
  for (const tactic of tactics) {
    for (const jockey of roster) {
      const score = ridingFit(career, race, jockey, tactic).score ?? -Infinity
      if (
        score > bestScore ||
        (score === bestScore && aptitudeRank(career, tactic) < aptitudeRank(career, draft.tactic!))
      ) {
        bestScore = score
        draft = { raceId: race.id, jockeyId: jockey.id, tactic }
      }
    }
  }
  return draft
}

export function updateRaceEntryDraft(
  career: Career,
  current: RaceEntryDraft,
  patch: Partial<RaceEntryDraft>,
): RaceEntryDraft {
  if (career.raceRun) {
    return recommendRaceEntry(career)
  }
  if (patch.raceId !== undefined && patch.raceId !== current.raceId) {
    return patch.raceId === null ? emptyDraft() : recommendRaceEntry(career, patch.raceId)
  }
  // A manual jockey/tactic choice survives ordinary rerenders and same-race clicks.
  return { ...current, ...patch }
}
