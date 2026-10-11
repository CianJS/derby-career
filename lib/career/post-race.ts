import type { Career, Values } from './model'
import type { RaceRunInput } from './race-entry'
import { BALANCE } from './balance'
import { deriveCondition } from './status'

export type StateChange = { label: string; before: string; after: string; delta?: string }
export type RaceAftermath = {
  before: { values: Values; condition: string }
  after: { values: Values; condition: string }
}

const conditionLadder = ['나쁨', '보통', '좋음']

/**
 * Single source of truth for what a race does to the horse. The result screen displays it and
 * `applyRaceResult` stores it, so both always agree. The input is the entry-time snapshot, which keeps
 * the calculation stable and independent of whether the result has already been applied.
 */
export function raceAftermath(career: Pick<Career, 'health'>, run: RaceRunInput): RaceAftermath {
  const { values, condition } = run.player.horseSnapshot
  const cost = BALANCE.race.cost[run.raceDefinitionSnapshot.distance] ?? BALANCE.race.fallbackCost
  const afterValues: Values = { ...values, fatigue: values.fatigue + cost.fatigue, bodyLoad: values.bodyLoad + cost.bodyLoad }
  const derived = deriveCondition(afterValues, career.health)
  const level = conditionLadder.indexOf(derived)
  const afterCondition = afterValues.fatigue >= BALANCE.race.tiredFatigue && level > 0 ? conditionLadder[level - 1] : derived
  return { before: { values: { ...values }, condition }, after: { values: afterValues, condition: afterCondition } }
}

export function postRaceChanges(career: Career, run: RaceRunInput): StateChange[] {
  const { before, after } = raceAftermath(career, run)
  const numeric = (label: string, from: number, to: number): StateChange => ({ label, before: String(from), after: String(to), delta: `${to > from ? '+' : ''}${to - from}` })
  return [
    numeric('피로', before.values.fatigue, after.values.fatigue),
    numeric('신체 부하', before.values.bodyLoad, after.values.bodyLoad),
    { label: '컨디션', before: before.condition, after: after.condition },
  ].filter(change => change.before !== change.after)
}
