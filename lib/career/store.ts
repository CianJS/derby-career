'use client'

import { useSyncExternalStore } from 'react'
import { advanceMonth, commitAction, completeRace, resolveAction, startCareer, type Career, type Choice } from './model'
import { clearCareer, readCareer, writeCareer } from './repository'
import { lockRaceEntryWithLog, type RaceEntryDraft } from './race-entry'
import { hasRaceLog, removeRaceLog, writeRaceLog } from './race-log-repository'
import { raceLogDigest, simulateRace, summarizeRaceLog, type RaceSimulationResult } from './race-simulation'

type Snapshot = { ready: boolean; busy: boolean; career: Career | null; error: string | null }
const initial: Snapshot = { ready: false, busy: false, career: null, error: null }
let snapshot = initial
const listeners = new Set<() => void>()
let channel: BroadcastChannel | null = null
function publish(patch: Partial<Snapshot>) { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()) }
async function locked<T>(operation: () => T): Promise<T> {
  if (!navigator.locks) throw new Error('안전한 저장을 위해 최신 브라우저의 HTTPS 환경에서 실행해 주세요.')
  return navigator.locks.request('derby-career-checkpoint-1', operation)
}
// Saves written before the simulation engine, or a cleared browser log store, are repaired here so the
// playback screen only ever reads a persisted log. Re-simulation is deterministic and checked by digest.
function ensureRaceLog(career: Career): Career {
  const run = career.raceRun
  if (!run) return career
  if (!run.simulation) {
    const log = simulateRace(run)
    writeRaceLog(log)
    const next = { ...career, raceRun: { ...run, simulation: summarizeRaceLog(log) } }
    writeCareer(next)
    return next
  }
  if (!hasRaceLog(run.raceRunId)) {
    const log = simulateRace(run, run.simulation.engineVersion)
    if (raceLogDigest(log) !== run.simulation.digest) throw new Error('저장된 경주 기록을 복원하지 못했습니다.')
    writeRaceLog(log)
  }
  return career
}
function restored(): Career | null {
  const saved = readCareer()
  if (!saved) return null
  const resolved = resolveAction(saved)
  if (resolved !== saved) writeCareer(resolved)
  return ensureRaceLog(resolved)
}
async function refresh() {
  if (snapshot.busy) return
  try { const career = await locked(restored); publish({ ready: true, career, error: null }) }
  catch (error) { publish({ ready: true, error: error instanceof Error ? error.message : '저장 데이터를 읽지 못했습니다.' }) }
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    if (typeof BroadcastChannel !== 'undefined') { channel = new BroadcastChannel('derby-career-checkpoint-1'); channel.onmessage = refresh }
    window.addEventListener('focus', refresh)
    void refresh()
  }
  return () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = null; window.removeEventListener('focus', refresh) } }
}
async function mutate(operation: (saved: Career | null) => Career | null) {
  if (snapshot.busy) return
  publish({ busy: true, error: null })
  try {
    const career = await locked(() => {
      const saved = restored()
      const next = operation(saved)
      if (next && next !== saved) writeCareer(next)
      return next
    })
    publish({ career })
    channel?.postMessage('saved')
    return true
  } catch (error) { publish({ error: error instanceof Error ? error.message : '저장에 실패했습니다. 다시 시도해 주세요.' }); return false }
  finally { publish({ busy: false }) }
}
export function useCareer() { return useSyncExternalStore(subscribe, () => snapshot, () => initial) }
export const careerStore = {
  refresh,
  completeRace: async (raceRunId: string, result: RaceSimulationResult) => {
    const done = await mutate(saved => {
      if (!saved) throw new Error('육성 기록이 없습니다.')
      return completeRace(saved, raceRunId, result.placing, result.prizeMoney)
    })
    if (done) removeRaceLog(raceRunId)
    return done
  },
  release: async () => {
    if (snapshot.busy) return false
    publish({ busy: true, error: null })
    try {
      await locked(clearCareer)
      publish({ career: null })
      return true
    } catch (error) {
      publish({ error: error instanceof Error ? error.message : '저장에 실패했습니다.' })
      return false
    } finally { publish({ busy: false }) }
  },
  lockRace: (draft: RaceEntryDraft, horseId: string, month: number) => mutate(saved => {
    if (!saved || saved.horse.id !== horseId || saved.month !== month) throw new Error('육성 상태가 변경되었습니다. 다시 불러와 주세요.')
    const { career, log } = lockRaceEntryWithLog(saved, draft)
    if (log) writeRaceLog(log)
    return career
  }),
  select: (horseId: string) => mutate(saved => { const next = startCareer(horseId); return saved ? { ...next, calendarDate: saved.calendarDate, contractedJockeyIds: saved.contractedJockeyIds } : next }),
  commit: (choice: Choice, expectedMonth: number) => mutate(saved => {
    if (!saved || saved.month !== expectedMonth || saved.action || saved.raceRun) return saved
    const committed = commitAction(saved, choice)
    // Persist the commitment before calculating growth. Recovery uses this exact seed.
    writeCareer(committed)
    publish({ career: committed })
    return resolveAction(committed)
  }),
  next: (actionId: string) => mutate(saved => saved ? advanceMonth(saved, actionId) : null),
}
