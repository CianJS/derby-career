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
  type Career,
  type Choice,
} from './model'
import { withMonthEvent } from './events/director'
import type { EventChoiceId } from './events/types'
import { writeCareer } from './repository'
import { restoreLocalCareer } from './local-recovery'
import { writeLifecycleSave } from './lifecycle-repository'
import { startLocalCareer, retireLocalCareer } from './local-career'
import type { LifecycleSave } from './lifecycle-save'
import { BROWSER_SAVE_KEY, readBrowserSave, STORAGE_ACCESS_MESSAGE } from './browser-save'
import { lockRaceEntryWithLog, type RaceEntryDraft } from './race-entry'
import { removeRaceLog, writeRaceLog } from './race-log-repository'
import type { RaceSimulationResult } from './race-simulation'

type Snapshot = {
  ready: boolean
  busy: boolean
  pending: boolean
  career: Career | null
  error: string | null
  mode: 'local' | 'server' | null
  workspace: SaveWorkspace | null
  raceOptions: SaveSnapshot['raceOptions']
  candidates: SaveSnapshot['candidates']
  localCareerId: string | null
}
type RetirementReceipt = { mode: 'local'; lifecycle: LifecycleSave } | { mode: 'server' }
const initial: Snapshot = {
  ready: false,
  busy: false,
  pending: false,
  career: null,
  error: null,
  mode: null,
  workspace: null,
  candidates: [],
  raceOptions: null,
  localCareerId: null,
}
let snapshot = initial
const listeners = new Set<() => void>()
let channel: BroadcastChannel | null = null
let server: ServerSaveController | null = null
let modeGeneration = 0
const journalKey = 'derby-career-server-command-v1'
function configure(mode: 'local' | 'server') {
  if (snapshot.mode === mode) {
    return
  }
  server?.dispose()
  server = null
  const generation = ++modeGeneration
  if (mode === 'server') {
    server = new ServerSaveController(
      createApiClient({ baseUrl: '/api/server-save' }),
      {
        read: () => sessionStorage.getItem(journalKey),
        write: (value) => sessionStorage.setItem(journalKey, value),
        clear: () => sessionStorage.removeItem(journalKey),
      },
      (current) => {
        if (modeGeneration === generation && snapshot.mode === 'server') {
          publish({ ...current, career: current.workspace?.career?.state ?? null })
        }
      },
    )
  }
  publish({ ...initial, mode })
  void refresh()
}
async function serverCommand(command: SaveCommand) {
  const generation = modeGeneration
  const controller = server!
  const result = await controller.send(command)
  if (generation !== modeGeneration || snapshot.mode !== 'server') {
    return false
  }
  if (
    result &&
    (command.kind === 'race-entry' || command.kind === 'race-complete') &&
    snapshot.workspace?.career?.id !== command.careerId
  ) {
    return false
  }
  if (result) {
    notify()
  }
  return result
}
function notify() {
  try {
    channel?.postMessage('saved')
  } catch {
    /* Notification failure cannot undo a durable save. */
  }
}
function activeServer() {
  const career = snapshot.workspace?.career
  if (!career) {
    throw new Error('서버 육성 기록을 불러와 주세요.')
  }
  return career
}
function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((listener) => listener())
}
async function locked<T>(operation: () => T): Promise<T> {
  if (!navigator.locks) {
    throw new Error('안전한 저장을 위해 최신 브라우저의 HTTPS 환경에서 실행해 주세요.')
  }
  try {
    return await navigator.locks.request('derby-career-checkpoint-1', operation)
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'SecurityError') {
      throw new Error(STORAGE_ACCESS_MESSAGE, { cause: error })
    }
    throw error
  }
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
  const generation = modeGeneration
  try {
    const loaded = await locked(() => {
      if (modeGeneration !== generation || snapshot.mode !== 'local') {
        throw new Error('저장 방식이 변경되었습니다. 다시 불러와 주세요.')
      }
      return {
        career: restoreLocalCareer(),
        localCareerId: readBrowserSave().localCareerId ?? null,
      }
    })
    if (modeGeneration === generation) {
      publish({ ready: true, ...loaded, error: null })
    }
  } catch (error) {
    if (modeGeneration === generation) {
      publish({
        ready: true,
        error: error instanceof Error ? error.message : '저장 데이터를 읽지 못했습니다.',
      })
    }
  }
}
function storageChanged(event: StorageEvent) {
  if (snapshot.mode === 'local' && (event.key === BROWSER_SAVE_KEY || event.key === null)) {
    void refresh()
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('derby-career-checkpoint-1')
        channel.onmessage = refresh
      } catch {
        channel = null
      }
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', storageChanged)
    void refresh()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      try {
        channel?.close()
      } catch {
        /* Optional transport cleanup. */
      }
      channel = null
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', storageChanged)
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
  const generation = modeGeneration
  publish({ busy: true, error: null })
  try {
    const loaded = await locked(() => {
      if (modeGeneration !== generation || snapshot.mode !== 'local') {
        throw new Error('저장 방식이 변경되었습니다. 다시 불러와 주세요.')
      }
      const saved = restoreLocalCareer()
      if (saved && snapshot.localCareerId !== (readBrowserSave().localCareerId ?? null)) {
        throw new Error('다른 탭에서 육성마가 변경되었습니다. 다시 불러와 주세요.')
      }
      const next = operation(saved)
      if (next && next !== saved) {
        writeCareer(next)
      }
      return { career: next, localCareerId: readBrowserSave().localCareerId ?? null }
    })
    if (modeGeneration === generation) {
      publish(loaded)
    }
    notify()
    return true
  } catch (error) {
    if (modeGeneration === generation) {
      publish({
        error: error instanceof Error ? error.message : '저장에 실패했습니다. 다시 시도해 주세요.',
      })
    }
    return false
  } finally {
    if (modeGeneration === generation) {
      publish({ busy: false })
    }
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
  getSnapshot: () => snapshot,
  configure,
  refresh,
  saveLifecycle: (state: unknown) => {
    const generation = modeGeneration
    return snapshot.mode === 'local'
      ? locked(() => {
          if (snapshot.mode === 'local' && modeGeneration === generation) {
            writeLifecycleSave(state)
          }
        })
      : Promise.resolve()
  },
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
      const career = activeServer()
      if (career.state.raceRun?.raceRunId !== raceRunId) {
        return false
      }
      return serverCommand({
        kind: 'race-complete',
        careerId: career.id,
        raceRunId,
        body: { commandId: crypto.randomUUID() },
      })
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
  release: async (): Promise<RetirementReceipt | false> => {
    if (snapshot.mode === 'server') {
      try {
        const career = activeServer()
        const saved = await serverCommand({
          kind: 'retire',
          careerId: career.id,
          body: { commandId: crypto.randomUUID(), expectedRevision: career.revision },
        })
        return saved ? { mode: 'server' } : false
      } catch (error) {
        publish({
          error: error instanceof Error ? error.message : '은퇴 기록을 저장하지 못했습니다.',
        })
        return false
      }
    }
    if (snapshot.mode !== 'local' || snapshot.busy) {
      return false
    }
    const generation = modeGeneration
    publish({ busy: true, error: null })
    try {
      const lifecycle = await locked(() => {
        if (modeGeneration !== generation || snapshot.mode !== 'local') {
          throw new Error('저장 방식이 변경되었습니다. 다시 불러와 주세요.')
        }
        const career = restoreLocalCareer()
        if (!career) {
          throw new Error('은퇴할 육성 기록이 없습니다.')
        }
        if (snapshot.localCareerId !== (readBrowserSave().localCareerId ?? null)) {
          throw new Error('다른 탭에서 육성마가 변경되었습니다. 다시 불러와 주세요.')
        }
        return retireLocalCareer(career)
      })
      if (modeGeneration === generation) {
        publish({ career: null })
      }
      notify()
      return { mode: 'local', lifecycle }
    } catch (error) {
      if (modeGeneration === generation) {
        publish({ error: error instanceof Error ? error.message : '저장에 실패했습니다.' })
      }
      return false
    } finally {
      if (modeGeneration === generation) {
        publish({ busy: false })
      }
    }
  },
  lockRace: (draft: RaceEntryDraft, horseId: string, month: number) =>
    snapshot.mode === 'server'
      ? (() => {
          const career = activeServer()
          if (
            career.state.horse.id !== horseId ||
            career.state.month !== month ||
            !draft.raceId ||
            !draft.jockeyId ||
            !draft.tactic
          ) {
            return Promise.resolve(false)
          }
          return serverCommand({
            kind: 'race-entry',
            careerId: career.id,
            body: {
              raceRunId: crypto.randomUUID(),
              raceDefinitionId: draft.raceId,
              jockeyId: draft.jockeyId,
              tactic: draft.tactic,
              expectedTurn: career.state.careerTurnIndex,
              engineVersion: 'race-sim-v4',
            },
          })
        })()
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
          return withMonthEvent(startLocalCareer(horseId, saved))
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
