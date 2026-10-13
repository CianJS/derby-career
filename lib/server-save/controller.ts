import type { DerbyApiClient } from '../../packages/shared/src/client'
import type { components } from '../../packages/shared/src/generated/api'
import {
  validateServerSaveCommand,
  validateCareerWorkspace,
  validateHorseCatalog,
  validateCareerResponse,
  validateActionResponse,
  validateRetireCareerResponse,
} from '../../packages/shared/src/generated/save-validation.mjs'
import { assertCareer, type Career } from '../career/model'

type Models = components['schemas']
export type SaveCommand = Models['ServerSaveCommand']
type ServerCareer = Models['Career'] & { state: Career }
export type SaveWorkspace = Omit<Models['CareerWorkspace'], 'career' | 'retirements'> & {
  career: ServerCareer | null
  retirements: (Models['RetirementRecord'] & { snapshot: ServerCareer })[]
}
export type SaveSnapshot = {
  ready: boolean
  busy: boolean
  pending: boolean
  workspace: SaveWorkspace | null
  candidates: Models['HorseCatalog']['data']
  error: string | null
}
export type CommandJournal = {
  read: () => string | null
  write: (value: string) => void
  clear: () => void
}

function workspace(value: unknown): SaveWorkspace {
  if (!validateCareerWorkspace(value)) {
    throw new Error('서버 저장 응답이 계약과 다릅니다. 다시 불러와 주세요.')
  }
  if (value.career) {
    assertCareer(value.career.state)
    if (value.career.status !== 'active' || value.career.stableId !== value.stable?.id) {
      throw new Error('서버의 현재 육성 상태를 확인하지 못했습니다.')
    }
  }
  for (const record of value.retirements) {
    assertCareer(record.snapshot.state)
    if (record.snapshot.status !== 'retired' || record.snapshot.id !== record.careerId) {
      throw new Error('서버 은퇴 기록을 확인하지 못했습니다.')
    }
  }
  // Domain assertions above narrow generated arrays to the game's tuple types.
  return value as SaveWorkspace
}

/** The journal holds only a request and its UUID. All displayed game data comes from fresh GETs. */
export class ServerSaveController {
  private state: SaveSnapshot = {
    ready: false,
    busy: false,
    pending: false,
    workspace: null,
    candidates: [],
    error: null,
  }
  constructor(
    private api: DerbyApiClient,
    private journal: CommandJournal,
    private changed: (snapshot: SaveSnapshot) => void,
  ) {}
  private publish(patch: Partial<SaveSnapshot>) {
    this.state = { ...this.state, ...patch }
    this.changed(this.state)
  }
  private pendingCommand(): SaveCommand | null {
    const saved = this.journal.read()
    if (!saved) {
      return null
    }
    const value: unknown = JSON.parse(saved)
    if (!validateServerSaveCommand(value)) {
      throw new Error('서버 저장 재시도 정보를 읽지 못했습니다. 이 탭의 세션 저장을 확인해 주세요.')
    }
    return value
  }
  private async execute(command: SaveCommand) {
    let result: unknown
    switch (command.kind) {
      case 'create':
        result = await this.api.createCareer(command.body)
        break
      case 'action':
        result = await this.api.confirmAction(command.careerId, command.body)
        break
      case 'advance':
        result = await this.api.advanceMonth(command.careerId, command.body)
        break
      case 'event':
        result = await this.api.chooseEvent(command.careerId, command.historyId, command.body)
        break
      case 'retire':
        result = await this.api.retireCareer(command.careerId, command.body)
        break
    }
    const valid =
      command.kind === 'action'
        ? validateActionResponse(result)
        : command.kind === 'retire'
          ? validateRetireCareerResponse(result)
          : validateCareerResponse(result)
    if (!valid) {
      throw new Error('저장 응답을 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.')
    }
    // Receipt replay intentionally returns historical state. Never display it as current state.
  }
  private async readWorkspace() {
    const [saved, catalog] = await Promise.all([
      this.api.getCareerWorkspace({ page: 1, pageSize: 20 }),
      this.api.listHorses(),
    ])
    const current = workspace(saved)
    if (!validateHorseCatalog(catalog)) {
      throw new Error('서버 육성마 후보를 읽지 못했습니다.')
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
      candidates: catalog.data.filter((h) => h.sourceKind === 'development_fixture'),
    })
  }
  private async run(command?: SaveCommand): Promise<boolean> {
    if (this.state.busy) {
      return false
    }
    this.publish({ busy: true, error: null })
    try {
      let pending = this.pendingCommand()
      if (command) {
        if (pending) {
          throw new Error('이전 저장을 먼저 다시 확인해 주세요.')
        }
        if (!validateServerSaveCommand(command)) {
          throw new Error('실행할 수 없는 저장 요청입니다.')
        }
        this.journal.write(JSON.stringify(command))
        pending = command
      }
      this.publish({ pending: pending !== null })
      let rejected: Error | null = null
      if (pending) {
        try {
          await this.execute(pending)
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
      await this.readWorkspace()
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
      const next = workspace(
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
