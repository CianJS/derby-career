export type CalendarDate = { year: number; month: number }
export type HorseRaceRecord = { race: string; result: string; date: string; placing?: number; prizeMoney?: number; jockeyId?: string; jockeyName?: string; distance?: number; grade?: string }
export function calendarDate(year = 2028, month = 4): CalendarDate {
  return { year: year + Math.floor((month - 1) / 12), month: ((month - 1) % 12 + 12) % 12 + 1 }
}
export function summarizeRecords(records: readonly HorseRaceRecord[] = []) {
  const place = (r: HorseRaceRecord) => r.placing ?? Number(r.result.match(/^(\d+)착$/)?.[1] ?? 0)
  const wins = records.filter(r => place(r) === 1).length
  const totalPrizeMoney = records.reduce((sum, r) => sum + (r.prizeMoney ?? 0), 0)
  const best = [...records].filter(r => place(r) > 0).sort((a, b) => place(a) - place(b))[0]
  return { totalStarts: records.length, wins, seconds: records.filter(r => place(r) === 2).length, thirds: records.filter(r => place(r) === 3).length, totalPrizeMoney, record: `${records.length}전 ${wins}승`, prize: `₩${totalPrizeMoney.toLocaleString('ko-KR')}`, best: best ? `${best.race} · ${best.result}` : '미출전', jockeyRelations: [...new Set(records.flatMap(r => r.jockeyId ? [r.jockeyId] : []))].map(jockeyId => ({ jockeyId, starts: records.filter(r => r.jockeyId === jockeyId).length, wins: records.filter(r => r.jockeyId === jockeyId && place(r) === 1).length })), careerTimeline: records.map(r => ({ date: r.date, text: `${r.race} · ${r.result}` })) }
}
export function normalizeHorse<T extends { raceRecords?: readonly HorseRaceRecord[] }>(horse: T): T & ReturnType<typeof summarizeRecords> {
  return { ...horse, raceRecords: horse.raceRecords ?? [], ...summarizeRecords(horse.raceRecords) }
}
