import { sapporoOfficialFacts } from '../../../../../packages/shared/src/sapporo-official-facts'
import { digest, type RaceSchedule } from './catalog'

/** Read-model facts only: never write into the stored source or approve a mapping. */
export function correctedReferenceFacts(race: RaceSchedule): RaceSchedule {
  const { playability: _playability, ...source } = race
  const maximum = sapporoOfficialFacts.corrections.find(
    (correction) => correction.field === 'officialMaximumStarters',
  )
  if (
    race.id === sapporoOfficialFacts.sourceId &&
    race.maxRunners === null &&
    digest(source) === sapporoOfficialFacts.baseSourceDigest &&
    maximum?.verificationStatus === 'verified' &&
    typeof maximum.newValue === 'number'
  ) {
    return {
      ...race,
      maxRunners: maximum.newValue,
      sourceCorrection: {
        ...sapporoOfficialFacts,
        corrections: sapporoOfficialFacts.corrections.map((correction) => ({ ...correction })),
        unresolved: { ...sapporoOfficialFacts.unresolved },
      },
    }
  }
  return race
}
