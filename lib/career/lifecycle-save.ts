import { assertEconomy, type EconomyEntry } from './local-economy'
import { assertJockeyRelations } from './jockey-trust'
import type { LifecycleHorse } from './lifecycle'
import type { HorseRaceRecord } from './records'

export type LifecycleSave = {
  stableName?: string
  country?: string
  funds?: string
  fundsKRW?: number
  economyLedger?: EconomyEntry[]
  activeHorse?: LifecycleHorse | null
  archive?: LifecycleHorse[]
  candidateSeed?: string
  candidates?: LifecycleHorse[]
  month?: number
  year?: number
  recentActivity?: string[]
  lifecycleView?: 'home' | 'careerComplete' | 'candidates'
  lastRetiredId?: string
  postRace?: unknown
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const invalid = () => new Error('저장된 마방 기록이 유효하지 않습니다. 기존 기록은 유지됩니다.')
export function assertRaceRecords(value: unknown): asserts value is HorseRaceRecord[] {
  if (!Array.isArray(value)) {
    throw invalid()
  }
  const ids = new Set<string>()
  for (const record of value) {
    if (
      !object(record) ||
      !['race', 'result', 'date'].every((key) => typeof record[key] === 'string')
    ) {
      throw invalid()
    }
    for (const key of ['prizeMoney', 'placing', 'distance', 'month']) {
      if (record[key] !== undefined && !finite(record[key])) {
        throw invalid()
      }
    }
    for (const key of ['raceRunId', 'jockeyId', 'jockeyName', 'grade']) {
      if (record[key] !== undefined && typeof record[key] !== 'string') {
        throw invalid()
      }
    }
    if (typeof record.raceRunId === 'string') {
      if (ids.has(record.raceRunId)) {
        throw invalid()
      }
      ids.add(record.raceRunId)
    }
  }
}
function horse(value: unknown) {
  if (
    !object(value) ||
    !['id', 'name', 'age', 'growth'].every((key) => typeof value[key] === 'string') ||
    !Array.isArray(value.stats) ||
    value.stats.some(
      (row) =>
        !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !finite(row[1]),
    )
  ) {
    throw invalid()
  }
  if (
    value.aptitude !== undefined &&
    (!Array.isArray(value.aptitude) ||
      value.aptitude.some(
        (row) =>
          !Array.isArray(row) ||
          ![2, 3].includes(row.length) ||
          !row.every((item) => typeof item === 'string'),
      ))
  ) {
    throw invalid()
  }
  if (value.jockeyTrust !== undefined) {
    assertJockeyRelations(value.jockeyTrust)
  }
  for (const key of [
    'sex',
    'growthNote',
    'record',
    'best',
    'prize',
    'condition',
    'retiredAt',
    'health',
  ]) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw invalid()
    }
  }
  for (const key of ['fatigue', 'bodyLoad', 'healthRecovery']) {
    if (value[key] !== undefined && !finite(value[key])) {
      throw invalid()
    }
  }
  if (value.raceRecords !== undefined) {
    assertRaceRecords(value.raceRecords)
  }
}
export function assertLifecycleSave(value: unknown): asserts value is LifecycleSave {
  if (!object(value)) {
    throw invalid()
  }
  assertEconomy(value)
  for (const key of ['stableName', 'country', 'funds', 'candidateSeed', 'lastRetiredId']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw invalid()
    }
  }
  if (value.activeHorse !== undefined && value.activeHorse !== null) {
    horse(value.activeHorse)
  }
  for (const key of ['archive', 'candidates']) {
    if (value[key] !== undefined) {
      if (!Array.isArray(value[key])) {
        throw invalid()
      }
      for (const item of value[key]) {
        horse(item)
      }
    }
  }
  if (
    value.month !== undefined &&
    (!Number.isInteger(value.month) || Number(value.month) < 1 || Number(value.month) > 12)
  ) {
    throw invalid()
  }
  if (value.year !== undefined && (!Number.isInteger(value.year) || Number(value.year) < 1)) {
    throw invalid()
  }
  if (
    value.recentActivity !== undefined &&
    (!Array.isArray(value.recentActivity) ||
      value.recentActivity.some((item) => typeof item !== 'string'))
  ) {
    throw invalid()
  }
  if (
    value.lifecycleView !== undefined &&
    !['home', 'careerComplete', 'candidates'].includes(String(value.lifecycleView))
  ) {
    throw invalid()
  }
  if (value.postRace !== undefined && value.postRace !== null) {
    const p = value.postRace
    if (
      !object(p) ||
      typeof p.committed !== 'boolean' ||
      !finite(p.prize) ||
      !['raceId', 'horseId', 'operationId', 'recentActivityEntry'].every(
        (key) => typeof p[key] === 'string',
      )
    ) {
      throw invalid()
    }
    for (const key of ['before', 'after']) {
      const side = p[key]
      if (
        !object(side) ||
        !['record', 'condition'].every((name) => typeof side[name] === 'string') ||
        !['prize', 'fatigue', 'bodyLoad', 'month', 'year'].every((name) => finite(side[name]))
      ) {
        throw invalid()
      }
    }
  }
}
