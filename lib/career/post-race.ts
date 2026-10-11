import type { Career } from './model'
import type { RaceRunInput } from './race-entry'

export type StateChange = { label: string; before: string; after: string; delta?: string }

const conditionLadder = ['나쁨', '보통', '좋음']
const FATIGUE_BY_DISTANCE: Record<number, number> = { 1400: 22, 1600: 25, 2000: 30 }
const LOAD_BY_DISTANCE: Record<number, number> = { 1400: 16, 1600: 18, 2000: 22 }

// Presentation contract for the result screen only. It is not written back to the career; the domain
// layer will replace this with the real post-race calculation and keep the same return shape.
export function postRaceChanges(career: Career, run: RaceRunInput, placing: number): StateChange[] {
  const { distance } = run.raceDefinitionSnapshot
  const values = run.player.horseSnapshot.values
  const fatigueAfter = values.fatigue + (FATIGUE_BY_DISTANCE[distance] ?? 25)
  const loadAfter = values.bodyLoad + (LOAD_BY_DISTANCE[distance] ?? 18)
  const conditionBefore = run.player.horseSnapshot.condition
  const level = conditionLadder.indexOf(conditionBefore)
  const conditionAfter = level > 0 && fatigueAfter >= 40 ? conditionLadder[level - 1] : conditionBefore
  const chemistryBefore = run.player.jockeySnapshot.chemistry
  const chemistryAfter = chemistryBefore + (placing <= 3 ? 8 : 4)
  const numeric = (label: string, before: number, after: number): StateChange => ({ label, before: String(before), after: String(after), delta: `${after > before ? '+' : ''}${after - before}` })
  return [
    numeric('피로', values.fatigue, fatigueAfter),
    numeric('신체 부하', values.bodyLoad, loadAfter),
    { label: '컨디션', before: conditionBefore, after: conditionAfter },
    numeric('기수 호흡도', chemistryBefore, chemistryAfter),
  ].filter(change => change.before !== change.after)
}
