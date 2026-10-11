import type { RaceSimulationLog } from './race-simulation'

const prefix = 'derby-race-log-v1:'

export function hasRaceLog(raceRunId: string): boolean {
  return localStorage.getItem(`${prefix}${raceRunId}`) !== null
}
export function readRaceLog(raceRunId: string): RaceSimulationLog | null {
  const text = localStorage.getItem(`${prefix}${raceRunId}`)
  return text === null ? null : (JSON.parse(text) as RaceSimulationLog)
}
export function writeRaceLog(log: RaceSimulationLog): void {
  const key = `${prefix}${log.raceRunId}`
  const text = JSON.stringify(log)
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const other = localStorage.key(i)
    if (other && other.startsWith(prefix) && other !== key) localStorage.removeItem(other)
  }
  localStorage.setItem(key, text)
  if (localStorage.getItem(key) !== text) throw new Error('경주 기록을 저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.')
}
export function removeRaceLog(raceRunId: string): void {
  try { localStorage.removeItem(`${prefix}${raceRunId}`) } catch { /* the log is regenerable bookkeeping, not career data */ }
}
