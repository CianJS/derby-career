import { executeCareerCommand } from './career-commands'
import { CareerEventRepository } from './career-events'
import {
  readCareerRow,
  readCareerHistory,
  historyDto,
  retirementDto,
  type CareerRow,
  type CareerEventHistory,
  type RetirementRow,
} from './career-rows'
import { randomUUID } from 'node:crypto'
import type { Database, Query } from '../db'
import { conflict, notFound, ApiError } from '../errors'
import { digest } from '../services/identity'
import { modifyActionDeltas, finalizeActionRecord } from '../modules/events/resolver'
import {
  startCareer,
  canRace,
  createRaceRun,
  raceEligibility,
  simulateRace,
  summarizeRaceLog,
  raceLogDigest,
  tactics,
  type RaceDefinitionSnapshot,
  type JockeySnapshot,
  type Change,
} from '../../../../packages/shared/src/domain'
import {
  startServerCareer,
  resolveServerAction,
  advanceServerMonth,
  completeServerRace,
  API_RACE_ENGINE_VERSION,
} from '../../../../packages/shared/src/server-domain'
import type { DirectorConfig } from '../../../../packages/shared/src/events'
import type { components } from '../../../../packages/shared/src/generated/api'

type Models = components['schemas']
export const raceHealthAllowed = (health: string) =>
  [
    '정상',
    'HEALTHY',
    '경상',
    '경미',
    'MINOR',
    '중등도',
    '중등도 부상',
    'MODERATE',
    '중상',
    '중증',
    'SEVERE',
  ].includes(health) && canRace(health)

export class CareerRepository {
  private eventsRepository: CareerEventRepository
  constructor(
    private db: Database,
    director: DirectorConfig,
  ) {
    this.eventsRepository = new CareerEventRepository(director)
  }
  private async dto(tx: Query, row: CareerRow) {
    const stable = (await tx.query('SELECT funds FROM stables WHERE id=$1', [row.stable_id]))
      .rows[0]
    return {
      id: row.id,
      stableId: row.stable_id,
      ownedHorseId: row.horse_id,
      horseDefinitionId: row.definition_id,
      status: row.status,
      revision: row.revision,
      authority: 'server' as const,
      funds: Number(stable.funds),
      state: row.state,
      event: historyDto(await readCareerHistory(tx, row)),
    }
  }
  private async save(tx: Query, row: CareerRow) {
    row.turn = row.state.careerTurnIndex
    row.revision++
    await tx.query(
      'UPDATE careers SET state=$2,turn=$3,revision=$4,event_misses=$5,updated_at=now() WHERE id=$1',
      [row.id, JSON.stringify(row.state), row.turn, row.revision, row.event_misses],
    )
    await tx.query('UPDATE stables SET calendar_year=$2,calendar_month=$3 WHERE id=$1', [
      row.stable_id,
      row.state.calendarDate.year,
      row.state.calendarDate.month,
    ])
  }
  private active(row: CareerRow) {
    if (row.status !== 'active') {
      throw conflict('종료된 Career는 수정할 수 없습니다.')
    }
  }

  async create(owner: string, body: Models['CreateCareer']) {
    return executeCareerCommand(
      this.db,
      owner,
      body.careerId,
      'career.create',
      body,
      null,
      async (tx) => {
        const definition = (
          await tx.query('SELECT * FROM horse_definitions WHERE id=$1', [body.horseDefinitionId])
        ).rows[0]
        if (!definition) {
          throw notFound()
        }
        if (definition.source_kind !== 'development_fixture') {
          throw new ApiError(
            422,
            'UNSUPPORTED_CATALOG',
            '정식 후보 생성 규칙은 아직 연결되지 않았습니다.',
          )
        }
        let stable = (await tx.query('SELECT * FROM stables WHERE owner_id=$1 FOR UPDATE', [owner]))
          .rows[0]
        if (!stable) {
          stable = (
            await tx.query('INSERT INTO stables(id,owner_id) VALUES($1,$2) RETURNING *', [
              randomUUID(),
              owner,
            ])
          ).rows[0]
          for (const id of startCareer(body.horseDefinitionId).contractedJockeyIds) {
            await tx.query('INSERT INTO jockey_contracts(stable_id,jockey_id) VALUES($1,$2)', [
              stable.id,
              id,
            ])
          }
        }
        if (
          (
            await tx.query("SELECT id FROM careers WHERE stable_id=$1 AND status='active'", [
              stable.id,
            ])
          ).rows.length
        ) {
          throw conflict('마방에 이미 활성 Career가 있습니다.')
        }
        const horseId = randomUUID()
        const state = startServerCareer(body.horseDefinitionId)
        state.horse = { ...state.horse, id: horseId }
        state.calendarDate = { year: stable.calendar_year, month: stable.calendar_month }
        state.contractedJockeyIds = (
          await tx.query(
            'SELECT jockey_id FROM jockey_contracts WHERE stable_id=$1 ORDER BY jockey_id',
            [stable.id],
          )
        ).rows.map((x) => x.jockey_id)
        await tx.query(
          'INSERT INTO owned_horses(id,stable_id,definition_id,definition_snapshot) VALUES($1,$2,$3,$4)',
          [horseId, stable.id, body.horseDefinitionId, JSON.stringify(definition.payload)],
        )
        for (const id of state.contractedJockeyIds) {
          await tx.query('INSERT INTO jockey_chemistry(horse_id,jockey_id) VALUES($1,$2)', [
            horseId,
            id,
          ])
        }
        const row: CareerRow = {
          id: body.careerId,
          stable_id: stable.id,
          owner_id: owner,
          horse_id: horseId,
          definition_id: body.horseDefinitionId,
          turn: 1,
          revision: 1,
          status: 'active',
          state,
          seed: randomUUID(),
          event_misses: 0,
        }
        await tx.query(
          'INSERT INTO careers(id,stable_id,owner_id,horse_id,turn,state,seed) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [row.id, row.stable_id, owner, horseId, 1, JSON.stringify(state), row.seed],
        )
        await this.eventsRepository.createMonth(tx, row)
        await tx.query('UPDATE careers SET state=$2 WHERE id=$1', [
          row.id,
          JSON.stringify(row.state),
        ])
        return { career: await this.dto(tx, row) }
      },
    )
  }
  /** One consistent, owner-scoped read restores the UI without trusting browser saves or receipts. */
  async workspace(owner: string, page: number, pageSize: number) {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const stable = (
        await tx.query<{
          id: string
          funds: string
          calendar_year: number
          calendar_month: number
        }>('SELECT id,funds,calendar_year,calendar_month FROM stables WHERE owner_id=$1', [owner])
      ).rows[0]
      const active = (
        await tx.query<CareerRow>(
          "SELECT c.*,h.definition_id FROM careers c JOIN owned_horses h ON h.id=c.horse_id WHERE c.owner_id=$1 AND c.status='active'",
          [owner],
        )
      ).rows[0]
      const action = active
        ? (
            await tx.query<{ id: string }>(
              'SELECT id FROM monthly_actions WHERE career_id=$1 AND turn=$2',
              [active.id, active.turn],
            )
          ).rows[0]
        : undefined
      const total = Number(
        (
          await tx.query(
            'SELECT count(*) AS total FROM career_records r JOIN careers c ON c.id=r.career_id WHERE c.owner_id=$1',
            [owner],
          )
        ).rows[0].total,
      )
      const records = (
        await tx.query<RetirementRow>(
          'SELECT r.* FROM career_records r JOIN careers c ON c.id=r.career_id WHERE c.owner_id=$1 ORDER BY r.created_at DESC,r.career_id DESC LIMIT $2 OFFSET $3',
          [owner, pageSize, (page - 1) * pageSize],
        )
      ).rows
      return {
        stable: stable
          ? {
              id: stable.id,
              funds: Number(stable.funds),
              calendarDate: { year: stable.calendar_year, month: stable.calendar_month },
            }
          : null,
        career: active ? await this.dto(tx, active) : null,
        confirmedActionId: action?.id ?? null,
        retirements: records.map(retirementDto),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      }
    })
  }
  async get(owner: string, id: string) {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      return { career: await this.dto(tx, await readCareerRow(tx, owner, id)) }
    })
  }
  async retire(owner: string, id: string, body: components['schemas']['RetireCareer']) {
    return executeCareerCommand(
      this.db,
      owner,
      body.commandId,
      'career.retire',
      body,
      id,
      async (tx) => {
        const row = await readCareerRow(tx, owner, id, true)
        this.active(row)
        if (row.revision !== body.expectedRevision) {
          throw conflict('Career가 변경되었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.')
        }
        if (row.state.raceRun || (row.state.action && !row.state.action.result)) {
          throw conflict('확정된 경주 또는 행동을 완료한 뒤 은퇴해 주세요.')
        }
        // Retirement seals the current state; it never selects events, advances time or recalculates rewards.
        row.status = 'retired'
        row.revision++
        await tx.query(
          "UPDATE careers SET status='retired',revision=$2,updated_at=now() WHERE id=$1",
          [id, row.revision],
        )
        const snapshot = await this.dto(tx, row)
        const record = (
          await tx.query<RetirementRow>(
            "INSERT INTO career_records(career_id,snapshot,retirement_reason) VALUES($1,$2,'manual') RETURNING *",
            [id, JSON.stringify(snapshot)],
          )
        ).rows[0]
        return { career: snapshot, retirement: retirementDto(record) }
      },
    )
  }
  async retirement(owner: string, id: string) {
    await readCareerRow(this.db, owner, id)
    const record = (
      await this.db.query<RetirementRow>('SELECT * FROM career_records WHERE career_id=$1', [id])
    ).rows[0]
    if (!record) {
      throw notFound()
    }
    return { retirement: retirementDto(record) }
  }
  async list(owner: string, page: number, pageSize: number) {
    const result = await this.db.query(
      'SELECT id,status,turn,revision,created_at FROM careers WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',
      [owner, pageSize, (page - 1) * pageSize],
    )
    return {
      data: result.rows.map((x) => ({
        id: x.id,
        status: x.status,
        turn: x.turn,
        revision: x.revision,
        createdAt: new Date(x.created_at).toISOString(),
      })),
      page,
      pageSize,
    }
  }
  async selectEvent(owner: string, id: string, eventId: string, body: Models['ChooseEvent']) {
    return executeCareerCommand(
      this.db,
      owner,
      body.commandId,
      'event.choose',
      { eventId, ...body },
      id,
      async (tx) => {
        const row = await readCareerRow(tx, owner, id, true)
        this.active(row)
        if (row.turn !== body.expectedTurn) {
          throw conflict('육성 월이 변경되었습니다.')
        }
        const history = await readCareerHistory(tx, row)
        if (!history || history.id !== eventId) {
          throw notFound()
        }
        await this.eventsRepository.selectHistory(tx, row, history, body.choiceId)
        await this.save(tx, row)
        return { career: await this.dto(tx, row) }
      },
    )
  }
  async act(owner: string, id: string, body: Models['ConfirmAction']) {
    return executeCareerCommand(
      this.db,
      owner,
      body.actionId,
      'action.confirm',
      body,
      id,
      async (tx) => {
        const row = await readCareerRow(tx, owner, id, true)
        this.active(row)
        if (row.turn !== body.expectedTurn || row.state.action || row.state.raceRun) {
          throw conflict('이번 월 행동이 이미 확정되었거나 월이 변경되었습니다.')
        }
        const history = await readCareerHistory(tx, row)
        if (history?.state === 'pending') {
          throw conflict('이벤트 선택을 먼저 확정해 주세요.')
        }
        const before = structuredClone(row.state)
        let modifierChanges: Change[] = []
        try {
          row.state = resolveServerAction(row.state, body.choice, (deltas, action) => {
            const modified = modifyActionDeltas(
              before,
              deltas,
              action,
              history?.state === 'selected' ? history.modifiers : [],
            )
            modifierChanges = modified.changes
            return modified.deltas
          })
        } catch (error) {
          throw new ApiError(422, 'ACTION_RESTRICTED', (error as Error).message)
        }
        await this.eventsRepository.consumeModifiers(tx, row, body.choice, modifierChanges)
        await this.eventsRepository.finishResultEvent(tx, row, body.choice, before)
        row.state = finalizeActionRecord(before, row.state)
        await tx.query(
          'INSERT INTO monthly_actions(id,career_id,horse_id,turn,kind,domain_record,request_hash,result,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())',
          [
            body.actionId,
            row.id,
            row.horse_id,
            row.turn,
            row.state.action!.actionType,
            JSON.stringify(row.state.action),
            digest(body),
            JSON.stringify({
              changes: row.state.action!.result,
              statusChanges: row.state.action!.statusChanges,
            }),
          ],
        )
        await this.save(tx, row)
        return { actionId: body.actionId, career: await this.dto(tx, row) }
      },
    )
  }
  async advance(owner: string, id: string, body: Models['AdvanceMonth']) {
    return executeCareerCommand(
      this.db,
      owner,
      body.commandId,
      'month.advance',
      body,
      id,
      async (tx) => {
        const row = await readCareerRow(tx, owner, id, true)
        this.active(row)
        const action = (
          await tx.query('SELECT * FROM monthly_actions WHERE id=$1 AND career_id=$2 AND turn=$3', [
            body.actionId,
            id,
            body.expectedTurn,
          ])
        ).rows[0]
        if (
          !action ||
          row.turn !== body.expectedTurn ||
          !row.state.action?.result ||
          row.state.raceRun ||
          action.domain_record?.actionId !== row.state.action.actionId
        ) {
          throw conflict('다음 월로 진행할 수 있는 확정 행동이 없습니다.')
        }
        await this.eventsRepository.endMonth(tx, row)
        row.state = advanceServerMonth(row.state, row.state.action.actionId)
        row.turn = row.state.careerTurnIndex
        await this.eventsRepository.createMonth(tx, row)
        await this.save(tx, row)
        return { career: await this.dto(tx, row) }
      },
    )
  }
  private raceEntryRestriction(row: CareerRow, history?: CareerEventHistory) {
    if (row.status !== 'active') {
      return conflict('종료된 Career는 수정할 수 없습니다.')
    }
    if (row.state.action || row.state.raceRun) {
      return conflict('이번 월 행동이 이미 확정되었습니다.')
    }
    if (history?.state === 'pending') {
      return conflict('월간 이벤트 선택을 먼저 확정해 주세요.')
    }
    if (!raceHealthAllowed(row.state.health)) {
      return new ApiError(
        422,
        'RACE_RESTRICTED',
        '중상 또는 확인되지 않은 건강 상태에서는 출전할 수 없습니다.',
      )
    }
    return null
  }
  async raceEntryOptions(owner: string, id: string) {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const row = await readCareerRow(tx, owner, id)
      const history = await readCareerHistory(tx, row)
      const definitions = (
        await tx.query<{
          payload: RaceDefinitionSnapshot
          source_kind: components['schemas']['RaceCatalog']['data'][number]['sourceKind']
        }>(
          "SELECT payload,source_kind FROM race_definitions WHERE (payload->>'month')::integer=$1 ORDER BY id",
          [row.turn],
        )
      ).rows
      const jockeys = (
        await tx.query<{ payload: JockeySnapshot; chemistry: number }>(
          'SELECT j.payload,COALESCE(c.chemistry,0) AS chemistry FROM jockey_definitions j LEFT JOIN jockey_chemistry c ON c.jockey_id=j.id AND c.horse_id=$1 WHERE j.id=ANY($2::text[]) ORDER BY j.id',
          [row.horse_id, row.state.contractedJockeyIds],
        )
      ).rows.map(({ payload, chemistry }) => ({ ...payload, chemistry }))
      const restrictionReason =
        this.raceEntryRestriction(row, history)?.message ??
        (!definitions.length
          ? '현재 월에 출전할 수 있는 경주가 없습니다.'
          : !jockeys.length
            ? '계약 기수 중에서 선택해 주세요.'
            : null)
      return {
        career: await this.dto(tx, row),
        defaultEngineVersion: API_RACE_ENGINE_VERSION,
        restrictionReason,
        races: definitions.map(({ payload, source_kind }) => {
          const reason = restrictionReason ?? raceEligibility(row.state, payload)
          return {
            definition: payload,
            sourceKind: source_kind,
            eligible: reason === null,
            restrictionReason: reason,
          }
        }),
        jockeys,
        tactics,
      }
    })
  }
  async enterRace(owner: string, id: string, body: components['schemas']['EnterRace']) {
    return executeCareerCommand(
      this.db,
      owner,
      body.raceRunId,
      'race.enter',
      body,
      id,
      async (tx) => {
        const row = await readCareerRow(tx, owner, id, true)
        if (row.turn !== body.expectedTurn) {
          throw conflict('이번 월 행동이 이미 확정되었거나 월이 변경되었습니다.')
        }
        const restriction = this.raceEntryRestriction(row, await readCareerHistory(tx, row))
        if (restriction) {
          throw restriction
        }
        if (!row.state.contractedJockeyIds.includes(body.jockeyId)) {
          throw new ApiError(422, 'RACE_RESTRICTED', '계약 기수 중에서 선택해 주세요.')
        }
        const race = (
          await tx.query('SELECT payload FROM race_definitions WHERE id=$1', [
            body.raceDefinitionId,
          ])
        ).rows[0]?.payload
        if (!race || race.month !== row.turn) {
          throw new ApiError(422, 'RACE_RESTRICTED', '현재 월에 출전할 수 있는 경주가 아닙니다.')
        }
        const reason = raceEligibility(row.state, race)
        if (reason) {
          throw new ApiError(422, 'RACE_RESTRICTED', reason)
        }
        const jockey = (
          await tx.query<{ payload: JockeySnapshot }>(
            'SELECT payload FROM jockey_definitions WHERE id=$1',
            [body.jockeyId],
          )
        ).rows[0]?.payload
        if (!jockey) {
          throw notFound()
        }
        const chemistry =
          (
            await tx.query(
              'SELECT chemistry FROM jockey_chemistry WHERE horse_id=$1 AND jockey_id=$2',
              [row.horse_id, body.jockeyId],
            )
          ).rows[0]?.chemistry ?? 0
        await this.eventsRepository.consumeModifiers(tx, row)
        const seed = randomUUID()
        let first = true
        const run = createRaceRun(row.state, race, { ...jockey, chemistry }, body.tactic, () => {
          if (first) {
            first = false
            return body.raceRunId
          }
          return seed
        })
        const log = simulateRace(run, body.engineVersion ?? API_RACE_ENGINE_VERSION)
        run.simulation = summarizeRaceLog(log)
        row.state = { ...row.state, raceRun: run }
        await tx.query(
          "INSERT INTO monthly_actions(id,career_id,horse_id,turn,kind,request_hash) VALUES($1,$2,$3,$4,'race',$5)",
          [body.raceRunId, id, row.horse_id, row.turn, digest(body)],
        )
        await tx.query(
          'INSERT INTO race_runs(id,career_id,turn,action_id,race_definition_id,jockey_id,seed,engine_version,input,health_at_entry) VALUES($1,$2,$3,$1,$4,$5,$6,$7,$8,$9)',
          [
            body.raceRunId,
            id,
            row.turn,
            race.id,
            jockey.id,
            seed,
            log.engineVersion,
            JSON.stringify(run),
            row.state.health,
          ],
        )
        const logJson = JSON.stringify(log)
        await tx.query(
          'INSERT INTO race_simulation_logs(race_run_id,engine_version,digest,duration_ms,byte_length,log,log_json) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            body.raceRunId,
            log.engineVersion,
            raceLogDigest(log),
            log.durationMs,
            Buffer.byteLength(logJson),
            logJson,
            logJson,
          ],
        )
        await this.save(tx, row)
        return { raceRunId: body.raceRunId, career: await this.dto(tx, row) }
      },
    )
  }
  async finishRace(owner: string, id: string, runId: string, body: Models['CompleteRace']) {
    return executeCareerCommand(
      this.db,
      owner,
      body.commandId,
      'race.complete',
      { runId, ...body },
      id,
      async (tx) => {
        const row = await readCareerRow(tx, owner, id, true)
        this.active(row)
        const run = (
          await tx.query('SELECT * FROM race_runs WHERE id=$1 AND career_id=$2', [runId, id])
        ).rows[0]
        if (!run) {
          throw notFound()
        }
        const existing = (
          await tx.query('SELECT result FROM race_results WHERE race_run_id=$1', [runId])
        ).rows[0]
        if (existing) {
          return { raceRunId: runId, result: existing.result, career: await this.dto(tx, row) }
        }
        if (row.state.raceRun?.raceRunId !== runId || row.turn !== run.turn) {
          throw conflict('현재 확정 경주와 일치하지 않습니다.')
        }
        const stored = (
          await tx.query('SELECT * FROM race_simulation_logs WHERE race_run_id=$1', [runId])
        ).rows[0]
        const exactLog = stored ? JSON.parse(stored.log_json) : undefined
        if (
          !stored ||
          stored.digest !== raceLogDigest(exactLog) ||
          stored.engine_version !== run.engine_version
        ) {
          throw new ApiError(500, 'CORRUPT_LOG', '저장된 경주 로그를 확인할 수 없습니다.')
        }
        const result = exactLog.result
        row.state = completeServerRace(row.state, runId, result.placing, result.prizeMoney)
        const record = row.state.raceRecords.find((x) => x.raceRunId === runId)!
        await tx.query(
          'INSERT INTO race_results(race_run_id,career_id,finish_position,prize_money,result,career_record) VALUES($1,$2,$3,$4,$5,$6)',
          [
            runId,
            id,
            result.placing,
            result.prizeMoney,
            JSON.stringify(result),
            JSON.stringify(record),
          ],
        )
        await tx.query(
          "INSERT INTO stable_ledger(id,stable_id,race_run_id,kind,amount) VALUES($1,$2,$3,'prize',$4)",
          [randomUUID(), row.stable_id, runId, result.prizeMoney],
        )
        await tx.query('UPDATE stables SET funds=funds+$2 WHERE id=$1', [
          row.stable_id,
          result.prizeMoney,
        ])
        await tx.query(
          'UPDATE jockey_chemistry SET starts=starts+1 WHERE horse_id=$1 AND jockey_id=$2',
          [row.horse_id, run.jockey_id],
        )
        await tx.query('UPDATE monthly_actions SET resolved_at=now(),result=$2 WHERE id=$1', [
          run.action_id,
          JSON.stringify(result),
        ])
        await this.eventsRepository.endMonth(tx, row)
        row.turn = row.state.careerTurnIndex
        await this.eventsRepository.createMonth(tx, row)
        await this.save(tx, row)
        return { raceRunId: runId, result, career: await this.dto(tx, row) }
      },
    )
  }
  async actions(owner: string, id: string, page: number, pageSize: number) {
    await readCareerRow(this.db, owner, id)
    const rows = (
      await this.db.query(
        'SELECT id,turn,kind,domain_record,result,created_at,resolved_at FROM monthly_actions WHERE career_id=$1 ORDER BY turn DESC LIMIT $2 OFFSET $3',
        [id, pageSize, (page - 1) * pageSize],
      )
    ).rows
    return {
      data: rows.map((x) => ({
        id: x.id,
        turn: x.turn,
        kind: x.kind,
        record: x.domain_record,
        result: x.result,
        createdAt: new Date(x.created_at).toISOString(),
        resolvedAt: x.resolved_at ? new Date(x.resolved_at).toISOString() : null,
      })),
      page,
      pageSize,
    }
  }
  async records(owner: string, id: string, page: number, pageSize: number) {
    await readCareerRow(this.db, owner, id)
    return {
      data: (
        await this.db.query(
          'SELECT career_record FROM race_results WHERE career_id=$1 ORDER BY applied_at DESC,race_run_id DESC LIMIT $2 OFFSET $3',
          [id, pageSize, (page - 1) * pageSize],
        )
      ).rows.map((x) => x.career_record),
      page,
      pageSize,
    }
  }
  async events(owner: string, id: string, page: number, pageSize: number) {
    await readCareerRow(this.db, owner, id)
    return {
      data: (
        await this.db.query<CareerEventHistory>(
          'SELECT * FROM career_event_history WHERE career_id=$1 ORDER BY turn DESC LIMIT $2 OFFSET $3',
          [id, pageSize, (page - 1) * pageSize],
        )
      ).rows.map(historyDto),
      page,
      pageSize,
    }
  }
  async race(owner: string, id: string, runId: string, log = false) {
    await readCareerRow(this.db, owner, id)
    const run = (
      await this.db.query(
        'SELECT r.*,l.digest,l.duration_ms,l.byte_length,l.storage_version,l.log_json FROM race_runs r JOIN race_simulation_logs l ON l.race_run_id=r.id WHERE r.id=$1 AND r.career_id=$2',
        [runId, id],
      )
    ).rows[0]
    if (!run) {
      throw notFound()
    }
    return log
      ? { log: JSON.parse(run.log_json) }
      : {
          raceRun: run.input,
          healthAtEntry: run.health_at_entry,
          metadata: {
            engineVersion: run.engine_version,
            digest: run.digest,
            durationMs: run.duration_ms,
            byteLength: run.byte_length,
            storageVersion: run.storage_version,
          },
        }
  }
}
