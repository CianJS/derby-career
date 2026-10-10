import { labels, statKeys, type Career } from './model'

type LifecycleHorse = { id: string; name: string; age: string; sex: string; growth: string; growthNote: string; stats: readonly [string, number][]; aptitude: readonly [string, string, string][]; record: string; best: string; prize: string; fatigue?: number; bodyLoad?: number; condition?: string }

export function applyCareer<T extends { activeHorse: LifecycleHorse | null; month: number }>(state: T, career: Career): T {
  const previous = state.activeHorse?.id === career.horse.id ? state.activeHorse : null
  return { ...state, month: career.month, activeHorse: {
    ...previous,
    id: career.horse.id, name: career.horse.name, age: `${career.age}세`, sex: previous?.sex ?? '수말',
    growth: career.horse.growth, growthNote: career.horse.description,
    stats: statKeys.map(key => [labels[key], career.values[key]] as [string, number]),
    aptitude: career.horse.aptitude.map(([name, grade]) => [name === '잔디' || name === '더트' ? '마장' : ['도주', '선행', '선입', '추입'].includes(name) ? '각질' : '거리', name, grade] as [string, string, string]),
    record: career.record, prize: career.prize, best: previous?.best ?? '미출전',
    fatigue: career.values.fatigue, bodyLoad: career.values.bodyLoad, condition: career.condition,
  } }
}
