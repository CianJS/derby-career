import type { TrustChange } from './jockey-trust'
export type CalendarDate = { year: number; month: number }
export type HorseRaceRecord = { trustChange?: TrustChange; raceRunId?: string; race: string; result: string; date: string; placing?: number; prizeMoney?: number; jockeyId?: string; jockeyName?: string; distance?: number; grade?: string; month?: number }
export function calendarDate(year = 2028, month = 4): CalendarDate {
  return { year: year + Math.floor((month - 1) / 12), month: ((month - 1) % 12 + 12) % 12 + 1 }
}
export function summarizeRecords(records: readonly HorseRaceRecord[] = []) {
  const place = (r: HorseRaceRecord) => r.placing ?? Number(r.result.match(/^(\d+)착$/)?.[1] ?? 0)
  let wins = 0
  let seconds = 0
  let thirds = 0
  let totalPrizeMoney = 0
  let best: { record: HorseRaceRecord; place: number } | null = null
  const byJockey = new Map<string, { jockeyId: string; starts: number; wins: number }>()
  const careerTimeline: { date: string; text: string }[] = []
  for (const record of records) {
    const rank = place(record)
    if (rank === 1) wins += 1
    else if (rank === 2) seconds += 1
    else if (rank === 3) thirds += 1
    totalPrizeMoney += record.prizeMoney ?? 0
    if (rank > 0 && (!best || rank < best.place)) best = { record, place: rank }
    if (record.jockeyId) {
      const relation = byJockey.get(record.jockeyId) ?? { jockeyId: record.jockeyId, starts: 0, wins: 0 }
      relation.starts += 1
      if (rank === 1) relation.wins += 1
      byJockey.set(record.jockeyId, relation)
    }
    careerTimeline.push({ date: record.date, text: `${record.race} · ${record.result}` })
  }
  return { totalStarts: records.length, wins, seconds, thirds, totalPrizeMoney, record: `${records.length}전 ${wins}승`, prize: `₩${totalPrizeMoney.toLocaleString('ko-KR')}`, best: best ? `${best.record.race} · ${best.record.result}` : '미출전', jockeyRelations: [...byJockey.values()], careerTimeline }
}
export function normalizeHorse<T extends { raceRecords?: readonly HorseRaceRecord[] }>(horse: T): T & ReturnType<typeof summarizeRecords> {
  return { ...horse, raceRecords: horse.raceRecords ?? [], ...summarizeRecords(horse.raceRecords) }
}
