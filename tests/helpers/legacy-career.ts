import { startCareer } from '../../lib/career/model'
import { contractedJockeys } from '../../lib/career/race-entry'

/** Explicit persisted pre-starter roster for existing engine/save regression fixtures. */
export const legacyCareer = (horseId: string) =>
  startCareer(horseId, { contractedJockeyIds: contractedJockeys.map((jockey) => jockey.id) })
