import { randomUUID } from 'node:crypto'
import type { Query } from '../db'
import { ApiError, conflict } from '../errors'
import { digest } from '../services/identity'
import { EventRepository } from './events'
import { conditionsMatch, planDraw, drawEvent } from '../modules/events/director'
import { applyImmediateEffects } from '../modules/events/resolver'
import {
  isHealthy,
  statKeys,
  type Career,
  type Choice,
  type Change,
} from '../../../../packages/shared/src/domain'
import type {
  DirectorConfig,
  EventDefinition,
  EventTiming,
} from '../../../../packages/shared/src/events'
import { readCareerHistory, type CareerRow, type CareerEventHistory } from './career-rows'

const resultTiming = (choice: Choice): EventTiming =>
  choice === 'rest'
    ? 'rest_result'
    : choice === 'treatment'
      ? 'treatment_result'
      : 'training_result'

export class CareerEventRepository {
  constructor(private director: DirectorConfig) {}
  async selectHistory(tx: Query, row: CareerRow, history: CareerEventHistory, choiceId: string) {
    if (history.state !== 'pending') {
      if (history.choice_id !== choiceId) {
        throw conflict('이벤트 선택은 이미 확정되어 변경할 수 없습니다.')
      }
      return
    }
    const choice = history.definition_snapshot.choices.find((x) => x.id === choiceId)
    if (!choice || !conditionsMatch(choice.conditions, { career: row.state })) {
      throw new ApiError(422, 'INVALID_CHOICE', '실행할 수 없는 이벤트 선택입니다.')
    }
    const resolved = applyImmediateEffects(row.state, choice.effects)
    row.state = resolved.career
    const state = resolved.modifiers.length ? 'selected' : 'applied'
    await tx.query(
      "UPDATE career_event_history SET choice_id=$2,state=$3,modifiers=$4,result=$5,selected_at=now(),applied_at=CASE WHEN $3='applied' THEN now() ELSE NULL END WHERE id=$1",
      [
        history.id,
        choiceId,
        state,
        JSON.stringify(resolved.modifiers),
        JSON.stringify({ changes: resolved.changes }),
      ],
    )
  }

  private async emit(
    tx: Query,
    row: CareerRow,
    event: EventDefinition,
    choice?: Choice,
    beforeAction?: Career,
  ) {
    const id = randomUUID()
    await tx.query(
      "INSERT INTO career_event_history(id,career_id,turn,event_id,event_revision,state,definition_snapshot) VALUES($1,$2,$3,$4,$5,'pending',$6)",
      [id, row.id, row.turn, event.id, event.revision, JSON.stringify(event)],
    )
    if (event.automatic) {
      const c = event.choices[0]
      if (!conditionsMatch(c.conditions, { career: row.state, choice, beforeAction })) {
        throw conflict('자동 이벤트 조건이 변경되었습니다.')
      }
      const resolved = applyImmediateEffects(row.state, c.effects)
      row.state = resolved.career
      const state = resolved.modifiers.length ? 'selected' : 'applied'
      await tx.query(
        "UPDATE career_event_history SET choice_id=$2,state=$3,modifiers=$4,result=$5,selected_at=now(),applied_at=CASE WHEN $3='applied' THEN now() ELSE NULL END WHERE id=$1",
        [
          id,
          c.id,
          state,
          JSON.stringify(resolved.modifiers),
          JSON.stringify({ changes: resolved.changes }),
        ],
      )
    }
    await tx.query('UPDATE event_draws SET finished=true WHERE career_id=$1 AND turn=$2', [
      row.id,
      row.turn,
    ])
  }

  async createMonth(tx: Query, row: CareerRow) {
    const available = await EventRepository.pool(tx)
    const pool = available.filter((e) => {
      if (['before_race', 'after_race'].includes(e.timing)) {
        return false
      } // race-preparation remains deferred
      if (e.timing === 'treatment_result' && isHealthy(row.state.health)) {
        return false
      }
      if (e.timing === 'training_result' && !isHealthy(row.state.health)) {
        return false
      }
      return (
        conditionsMatch(
          e.conditions.filter((c) => c.type !== 'action_is'),
          { career: row.state },
        ) &&
        (e.timing !== 'month_start' ||
          e.choices.some((c) => conditionsMatch(c.conditions, { career: row.state })))
      )
    })
    const seed = digest({ seed: row.seed, turn: row.turn, version: this.director.version })
    const plan = planDraw(seed, row.event_misses, pool, this.director)
    await tx.query(
      'INSERT INTO event_draws(career_id,turn,seed,system_version,config,pool,gate_passed,deferred_to_result,evaluated_timings,finished) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        row.id,
        row.turn,
        seed,
        this.director.version,
        JSON.stringify(this.director),
        JSON.stringify(pool),
        plan.gatePassed,
        plan.deferredToResult,
        JSON.stringify(['month_start']),
        !plan.gatePassed,
      ],
    )
    if (plan.gatePassed && !plan.deferredToResult) {
      const event = drawEvent(
        pool,
        'month_start',
        { career: row.state },
        seed,
        this.director.version,
      )
      if (event) {
        await this.emit(tx, row, event)
      }
    }
  }

  async finishResultEvent(tx: Query, row: CareerRow, choice: Choice, before: Career) {
    if (await readCareerHistory(tx, row)) {
      return
    }
    const draw = (
      await tx.query('SELECT * FROM event_draws WHERE career_id=$1 AND turn=$2 FOR UPDATE', [
        row.id,
        row.turn,
      ])
    ).rows[0]
    const timing = resultTiming(choice)
    if (draw.finished || draw.evaluated_timings.includes(timing)) {
      return
    }
    if (draw.gate_passed) {
      const event = drawEvent(
        draw.pool,
        timing,
        { career: row.state, choice, beforeAction: before },
        draw.seed,
        draw.system_version,
      )
      if (event) {
        await this.emit(tx, row, event, choice, before)
      }
    }
    await tx.query(
      'UPDATE event_draws SET finished=true,evaluated_timings=$3 WHERE career_id=$1 AND turn=$2',
      [row.id, row.turn, JSON.stringify([...draw.evaluated_timings, timing])],
    )
  }

  async consumeModifiers(tx: Query, row: CareerRow, choice?: Choice, actionChanges: Change[] = []) {
    const history = await readCareerHistory(tx, row)
    if (history?.state === 'pending') {
      throw conflict('월간 이벤트 선택을 먼저 확정해 주세요.')
    }
    if (history?.state === 'selected') {
      const matched =
        choice &&
        history.modifiers.some(
          (e) =>
            e.type === 'action_modifier' &&
            e.action === ((statKeys as readonly string[]).includes(choice) ? 'training' : choice) &&
            (!e.training || e.training === choice),
        )
      await tx.query(
        'UPDATE career_event_history SET state=$2,result=$3,applied_at=now() WHERE id=$1',
        [
          history.id,
          matched ? 'applied' : 'expired',
          JSON.stringify({ ...(history.result as object), actionChanges }),
        ],
      )
    }
  }

  async endMonth(tx: Query, row: CareerRow) {
    const history = await readCareerHistory(tx, row)
    if (history?.state === 'pending' || history?.state === 'selected') {
      throw conflict('이벤트 실행을 완료해 주세요.')
    }
    row.event_misses = history ? 0 : row.event_misses + 1
    await tx.query('UPDATE event_draws SET finished=true WHERE career_id=$1 AND turn=$2', [
      row.id,
      row.turn,
    ])
  }
}
