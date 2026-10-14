import type { HorseRaceRecord } from '@/lib/career/records'

export type View =
  | 'home'
  | 'setup'
  | 'candidates'
  | 'careerComplete'
  | 'retirementConfirm'
  | 'training'
  | 'entry'
  | 'raceplay'
  | 'raceexperimental'
  | 'result'
  | 'stable'
  | 'horse'
  | 'horseArchive'
  | 'races'
  | 'race'
  | 'jockeys'
  | 'jockey'

export type CareerHorse = {
  id: string
  name: string
  age: string
  sex: string
  growth: string
  growthNote: string
  stats: readonly [string, number][]
  aptitude: readonly [string, string, string][]
  record: string
  best: string
  prize: string
  fatigue?: number
  bodyLoad?: number
  condition?: string
  retiredAt?: string
  raceRecords?: readonly HorseRaceRecord[]
}

export type PostRaceSnapshot = {
  raceId: string
  horseId: string
  prize: number
  before: {
    record: string
    prize: number
    fatigue: number
    bodyLoad: number
    condition: string
    month: number
    year: number
  }
  after: {
    record: string
    prize: number
    fatigue: number
    bodyLoad: number
    condition: string
    month: number
    year: number
  }
  committed: boolean
  operationId: string
  recentActivityEntry: string
}

export type LifecycleState = {
  stableName: string
  country: string
  funds: string
  activeHorse: CareerHorse | null
  archive: CareerHorse[]
  candidateSeed: string
  candidates: CareerHorse[]
  month: number
  year: number
  recentActivity: string[]
  postRace: PostRaceSnapshot | null
  lifecycleView: 'home' | 'careerComplete' | 'candidates'
  lastRetiredId?: string
}
