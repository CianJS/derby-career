import { validateSaveCommand, type SaveCommand } from './commands'
export type { SaveCommand } from './commands'
import type { DerbyApiClient } from '../../packages/shared/src/client'
import type { components } from '../../packages/shared/src/generated/api'
import {
  validateRaceEntryOptions,
  validateHorseCatalog,
} from '../../packages/shared/src/generated/save-validation.mjs'
import { executeSaveCommand } from './execute-command'
import { parseSaveWorkspace, type SaveWorkspace } from './workspace'
export type { SaveWorkspace } from './workspace'
export type SaveSnapshot = {
  ready: boolean
  busy: boolean
  pending: boolean
  workspace: SaveWorkspace | null
  candidates: Models['HorseCatalog']['data']
  error: string | null
  raceOptions: Models['RaceEntryOptions'] | null
}
export type CommandJournal = {
  read: () => string | null
  write: (value: string) => void
  clear: () => void
}

type Models = components['schemas']

/** The journal holds only a request and its UUID. All displayed game data comes from fresh GETs. */
export class ServerSaveController {
  private state: SaveSnapshot = {
    ready: false,
    busy: false,
    pending: false,
    workspace: null,
    candidates: [],
    error: null,
    raceOptions: null,
  }
  constructor(
    private api: DerbyApiClient,
    private journal: CommandJournal,
    private changed: (snapshot: SaveSnapshot) => void,
  ) {}
  private disposed = false
  dispose() {
    this.disposed = true
  }
  private publish(patch: Partial<SaveSnapshot>) {
    if (this.disposed) {
      return
    }
    this.state = { ...this.state, ...patch }
    this.changed(this.state)
  }
  private pendingCommand(): SaveCommand | null {
    const saved = this.journal.read()
    if (!saved) {
      return null
    }
    const value: unknown = JSON.parse(saved)
    if (!validateSaveCommand(value)) {
      throw new Error('서버 저장 재시도 정보를 읽지 못했습니다. 이 탭의 세션 저장을 확인해 주세요.')
    }
    return value
  }
  private async readWorkspace() {
    const [saved, catalog] = await Promise.all([
      this.api.getCareerWorkspace({ page: 1, pageSize: 20 }),
      this.api.listHorses(),
    ])
    const current = parseSaveWorkspace(saved)
    if (!validateHorseCatalog(catalog)) {
      throw new Error('서버 육성마 후보를 읽지 못했습니다.')
    }
    let raceOptions: Models['RaceEntryOptions'] | null = null
    if (current.career) {
      const options = await this.api.getRaceEntryOptions(current.career.id)
      if (
        !validateRaceEntryOptions(options) ||
        options.career.id !== current.career.id ||
        options.career.revision !== current.career.revision
      ) {
        throw new Error('출전 조건이 변경되었습니다. 최신 서버 기록을 다시 불러와 주세요.')
      }
      raceOptions = options
    }
    if (this.disposed) {
      return
    }
    const previous = this.state.workspace
    if (previous?.stable?.id && previous.stable.id === current.stable?.id) {
      // Retirement snapshots are immutable. Keep already loaded archive pages on focus refresh;
      // dropping them could make a selected older horse display another horse's snapshot.
      const known = new Set(current.retirements.map((r) => r.careerId))
      current.retirements.push(...previous.retirements.filter((r) => !known.has(r.careerId)))
      if (previous.pagination.total === current.pagination.total) {
        current.pagination.page = previous.pagination.page
      }
    }
    this.publish({
      workspace: current,
      raceOptions,
      candidates: catalog.data.filter((h) => h.sourceKind === 'development_fixture'),
    })
  }
  private async run(command?: SaveCommand): Promise<boolean> {
    if (this.disposed || this.state.busy) {
      return false
    }
    this.publish({ busy: true, error: null })
    try {
      let pending = this.pendingCommand()
      if (command) {
        if (pending) {
          throw new Error('이전 저장을 먼저 다시 확인해 주세요.')
        }
        if (!validateSaveCommand(command)) {
          throw new Error('실행할 수 없는 저장 요청입니다.')
        }
        this.journal.write(JSON.stringify(command))
        pending = command
      }
      this.publish({ pending: pending !== null })
      let rejected: Error | null = null
      if (pending) {
        try {
          await executeSaveCommand(this.api, pending)
        } catch (error) {
          // Check the public error shape: clients can cross ESM/CJS module or browser boundaries.
          if (
            !error ||
            typeof error !== 'object' ||
            !('status' in error) ||
            typeof error.status !== 'number' ||
            ![400, 404, 409, 422].includes(error.status) ||
            !('code' in error) ||
            typeof error.code !== 'string' ||
            !('message' in error) ||
            typeof error.message !== 'string'
          ) {
            throw error
          }
          rejected = new Error(error.message)
        }
      }
      if (this.disposed) {
        return false
      }
      await this.readWorkspace()
      if (this.disposed) {
        return false
      }
      this.journal.clear()
      this.publish({ pending: false, error: rejected?.message ?? null })
      return rejected === null
    } catch (error) {
      let pending = true
      try {
        pending = this.journal.read() !== null
      } catch {
        // An unavailable journal must block writes until it is readable again.
      }
      this.publish({
        pending,
        error: error instanceof Error ? error.message : '서버 저장에 연결하지 못했습니다.',
      })
      return false
    } finally {
      this.publish({ ready: true, busy: false })
    }
  }
  refresh = () => this.run()
  send = (command: SaveCommand) => this.run(command)
  async loadMore() {
    const previous = this.state.workspace
    if (
      !previous ||
      this.state.busy ||
      this.state.pending ||
      previous.pagination.page >= previous.pagination.totalPages
    ) {
      return
    }
    this.publish({ busy: true, error: null })
    try {
      const next = parseSaveWorkspace(
        await this.api.getCareerWorkspace({ page: previous.pagination.page + 1, pageSize: 20 }),
      )
      if (previous.pagination.total !== next.pagination.total) {
        await this.readWorkspace()
        return
      }
      const known = new Set(previous.retirements.map((r) => r.careerId))
      this.publish({
        workspace: {
          ...next,
          retirements: [
            ...previous.retirements,
            ...next.retirements.filter((r) => !known.has(r.careerId)),
          ],
        },
      })
    } catch (error) {
      this.publish({
        error: error instanceof Error ? error.message : '은퇴 기록을 읽지 못했습니다.',
      })
    } finally {
      this.publish({ busy: false })
    }
  }
}
