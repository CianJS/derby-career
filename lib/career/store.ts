'use client'

import { useSyncExternalStore } from 'react'
import { createApiClient } from '../../packages/shared/src/client'
import {
  ServerSaveController,
  type SaveCommand,
  type SaveSnapshot,
  type SaveWorkspace,
} from '../server-save/controller'
import {
  advanceMonth,
  chooseEvent,
  commitAction,
  completeRace,
  resolveAction,
  startCareer,
  type Career,
  type Choice,
} from './model'
import { withMonthEvent } from './events/director'
import type { EventChoiceId } from './events/types'
import { clearCareer, readCareer, writeCareer } from './repository'
import { lockRaceEntryWithLog, type RaceEntryDraft } from './race-entry'
import { hasRaceLog, removeRaceLog, writeRaceLog } from './race-log-repository'
import {
  raceLogDigest,
  simulateRace,
  summarizeRaceLog,
  type RaceSimulationResult,
} from './race-simulation'

type Snapshot = {
  ready: boolean
  busy: boolean
  pending: boolean
  career: Career | null
  error: string | null
  mode: 'local' | 'server' | null
  workspace: SaveWorkspace | null
  candidates: SaveSnapshot['candidates']
}
const initial: Snapshot = {
  ready: false,
  busy: false,
  pending: false,
  career: null,
  error: null,
  mode: null,
  workspace: null,
  candidates: [],
}
let snapshot = initial
const listeners = new Set<() => void>()
let channel: BroadcastChannel | null = null
let server: ServerSaveController | null = null
const journalKey = 'derby-career-server-command-v1'
function configure(mode: 'local' | 'server') {
  if (snapshot.mode === mode) {
    return
  }
  if (mode === 'server') {
    server = new ServerSaveController(
      createApiClient({ baseUrl: '/api/server-save' }),
      {
        read: () => sessionStorage.getItem(journalKey),
        write: (value) => sessionStorage.setItem(journalKey, value),
        clear: () => sessionStorage.removeItem(journalKey),
      },
      (current) => publish({ ...current, career: current.workspace?.career?.state ?? null }),
    )
  }
  publish({ ...initial, mode })
  void refresh()
}
async function serverCommand(command: SaveCommand) {
  const result = await server!.send(command)
  if (result) {
    channel?.postMessage('saved')
  }
  return result
}
function activeServer() {
  const career = snapshot.workspace?.career
  if (!career) {
    throw new Error('서버 육성 기록을 불러와 주세요.')
  }
  return career
}
function unsupportedRace() {
  publish({
    error: '서버 저장의 경주 연결은 준비 중입니다. 지금은 훈련·휴식·치료를 이용해 주세요.',
  })
  return Promise.resolve(false)
}
function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((listener) => listener())
}
async function locked<T>(operation: () => T): Promise<T> {
  if (!navigator.locks) {
    throw new Error('안전한 저장을 위해 최신 브라우저의 HTTPS 환경에서 실행해 주세요.')
  }
  return navigator.locks.request('derby-career-checkpoint-1', operation)
}
// Saves written before the simulation engine, or a cleared browser log store, are repaired here so the
// playback screen only ever reads a persisted log. Re-simulation is deterministic and checked by digest.
function ensureRaceLog(career: Career): Career {
  const run = career.raceRun
  if (!run) {
    return career
  }
  if (!run.simulation) {
    const log = simulateRace(run)
    writeRaceLog(log)
    const next = { ...career, raceRun: { ...run, simulation: summarizeRaceLog(log) } }
    writeCareer(next)
    return next
  }
  if (!hasRaceLog(run.raceRunId)) {
    const log = simulateRace(run, run.simulation.engineVersion)
    if (raceLogDigest(log) !== run.simulation.digest) {
      throw new Error('저장된 경주 기록을 복원하지 못했습니다.')
    }
    writeRaceLog(log)
  }
  return career
}
function restored(): Career | null {
  const saved = readCareer()
  if (!saved) {
    return null
  }
  const resolved = withMonthEvent(resolveAction(saved))
  if (resolved !== saved) {
    writeCareer(resolved)
  }
  return ensureRaceLog(resolved)
}
async function refresh() {
  if (!snapshot.mode) {
    return
  }
  if (snapshot.mode === 'server') {
    return server!.refresh()
  }
  if (snapshot.busy) {
    return
  }
  try {
    const career = await locked(restored)
    publish({ ready: true, career, error: null })
  } catch (error) {
    publish({
      ready: true,
      error: error instanceof Error ? error.message : '저장 데이터를 읽지 못했습니다.',
    })
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('derby-career-checkpoint-1')
      channel.onmessage = refresh
    }
    window.addEventListener('focus', refresh)
    void refresh()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      channel?.close()
      channel = null
      window.removeEventListener('focus', refresh)
    }
  }
}
async function mutate(operation: (saved: Career | null) => Career | null) {
  if (snapshot.mode !== 'local') {
    return false
  }
  if (snapshot.busy) {
    return
  }
  publish({ busy: true, error: null })
  try {
    const career = await locked(() => {
      const saved = restored()
      const next = operation(saved)
      if (next && next !== saved) {
        writeCareer(next)
      }
      return next
    })
    publish({ career })
    channel?.postMessage('saved')
    return true
  } catch (error) {
    publish({
      error: error instanceof Error ? error.message : '저장에 실패했습니다. 다시 시도해 주세요.',
    })
    return false
  } finally {
    publish({ busy: false })
  }
}
export function useCareer() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => initial,
  )
}
export const careerStore = {
  configure,
  refresh,
  loadMoreRetirements: () => server?.loadMore(),
  chooseServerEvent: (choiceId: string) => {
    const career = activeServer()
    if (!career.event) {
      return Promise.resolve(false)
    }
    return serverCommand({
      kind: 'event',
      careerId: career.id,
      historyId: career.event.id,
      body: {
        commandId: crypto.randomUUID(),
        choiceId,
        expectedTurn: career.state.careerTurnIndex,
      },
    })
  },
  completeRace: async (raceRunId: string, result: RaceSimulationResult) => {
    if (snapshot.mode === 'server') {
      return unsupportedRace()
    }
    const done = await mutate((saved) => {
      if (!saved) {
        throw new Error('육성 기록이 없습니다.')
      }
      return completeRace(saved, raceRunId, result.placing, result.prizeMoney)
    })
    if (done) {
      removeRaceLog(raceRunId)
    }
    return done
  },
  release: async () => {
    if (snapshot.mode === 'server') {
      const career = activeServer()
      return serverCommand({
        kind: 'retire',
        careerId: career.id,
        body: { commandId: crypto.randomUUID(), expectedRevision: career.revision },
      })
    }
    if (snapshot.busy) {
      return false
    }
    publish({ busy: true, error: null })
    try {
      await locked(clearCareer)
      publish({ career: null })
      return true
    } catch (error) {
      publish({ error: error instanceof Error ? error.message : '저장에 실패했습니다.' })
      return false
    } finally {
      publish({ busy: false })
    }
  },
  lockRace: (draft: RaceEntryDraft, horseId: string, month: number) =>
    snapshot.mode === 'server'
      ? unsupportedRace()
      : mutate((saved) => {
          if (!saved || saved.horse.id !== horseId || saved.month !== month) {
            throw new Error('육성 상태가 변경되었습니다. 다시 불러와 주세요.')
          }
          const { career, log } = lockRaceEntryWithLog(saved, draft)
          if (log) {
            writeRaceLog(log)
          }
          return career
        }),
  select: (horseId: string) =>
    snapshot.mode === 'server'
      ? serverCommand({
          kind: 'create',
          body: { careerId: crypto.randomUUID(), horseDefinitionId: horseId },
        })
      : mutate((saved) => {
          const next = startCareer(horseId)
          return withMonthEvent(
            saved
              ? {
                  ...next,
                  calendarDate: saved.calendarDate,
                  contractedJockeyIds: saved.contractedJockeyIds,
                }
              : next,
          )
        }),
  chooseEvent: (eventId: string, choice: EventChoiceId, expectedMonth: number) =>
    mutate((saved) => {
      if (!saved || saved.month !== expectedMonth) {
        throw new Error('육성 상태가 변경되었습니다. 다시 불러와 주세요.')
      }
      return chooseEvent(saved, eventId, choice)
    }),
  commit: (choice: Choice, expectedMonth: number) => {
    if (snapshot.mode === 'server') {
      const career = activeServer()
      return serverCommand({
        kind: 'action',
        careerId: career.id,
        body: { actionId: crypto.randomUUID(), choice, expectedTurn: expectedMonth },
      })
    }
    return mutate((saved) => {
      if (!saved || saved.month !== expectedMonth || saved.action || saved.raceRun) {
        return saved
      }
      const committed = commitAction(saved, choice)
      // Persist the commitment before calculating growth. Recovery uses this exact seed.
      writeCareer(committed)
      publish({ career: committed })
      return resolveAction(committed)
    })
  },
  next: (actionId: string) => {
    if (snapshot.mode === 'server') {
      const career = activeServer()
      const confirmedActionId = snapshot.workspace?.confirmedActionId
      if (!confirmedActionId || career.state.action?.actionId !== actionId) {
        return Promise.resolve(false)
      }
      return serverCommand({
        kind: 'advance',
        careerId: career.id,
        body: {
          commandId: crypto.randomUUID(),
          actionId: confirmedActionId,
          expectedTurn: career.state.careerTurnIndex,
        },
      })
    }
    return mutate((saved) => (saved ? advanceMonth(saved, actionId) : null))
  },
}
