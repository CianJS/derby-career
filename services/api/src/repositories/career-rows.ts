import { hydrateJockeyRelations } from './jockey-relations'
import type { Query } from '../db'
import { notFound } from '../errors'
import { normalizeCareerAge, type Career } from '../../../../packages/shared/src/domain'
import {
  publicEventDefinition,
  type EventDefinition,
  type EventEffect,
} from '../../../../packages/shared/src/events'
import type { components } from '../../../../packages/shared/src/generated/api'

export type CareerRow = {
  id: string
  stable_id: string
  owner_id: string
  horse_id: string
  definition_id: string
  turn: number
  revision: number
  status: string
  state: Career
  seed: string
  event_misses: number
}

export type CareerEventHistory = {
  id: string
  career_id: string
  turn: number
  event_id: string
  event_revision: string
  choice_id: string | null
  state: 'pending' | 'selected' | 'applied' | 'expired'
  definition_snapshot: EventDefinition
  modifiers: EventEffect[]
  result: unknown
}

export type RetirementRow = {
  career_id: string
  snapshot: components['schemas']['Career']
  retirement_reason: components['schemas']['RetirementRecord']['reason']
  created_at: Date
}

export const retirementDto = (record: RetirementRow) => ({
  careerId: record.career_id,
  reason: record.retirement_reason,
  retiredAt: new Date(record.created_at).toISOString(),
  retiredOn: record.snapshot.state.calendarDate,
  snapshot: record.snapshot,
})

export const historyDto = (h?: CareerEventHistory) =>
  h
    ? {
        id: h.id,
        turn: h.turn,
        eventId: h.event_id,
        revision: h.event_revision,
        choiceId: h.choice_id,
        state: h.state,
        definition: publicEventDefinition(h.definition_snapshot),
        result: h.result,
      }
    : null

export async function readCareerRow(
  tx: Query,
  owner: string,
  id: string,
  lock = false,
): Promise<CareerRow> {
  const row = (
    await tx.query<CareerRow>(
      `SELECT c.*, h.definition_id FROM careers c JOIN owned_horses h ON h.id=c.horse_id WHERE c.id=$1 AND c.owner_id=$2 ${lock ? 'FOR UPDATE OF c' : ''}`,
      [id, owner],
    )
  ).rows[0]
  if (!row) {
    throw notFound()
  }
  if (row.status === 'active') {
    row.state = normalizeCareerAge(row.state)
  }
  await hydrateJockeyRelations(tx, row)
  return row
}

export async function readCareerHistory(
  tx: Query,
  row: CareerRow,
): Promise<CareerEventHistory | undefined> {
  return (
    await tx.query<CareerEventHistory>(
      'SELECT * FROM career_event_history WHERE career_id=$1 AND turn=$2',
      [row.id, row.turn],
    )
  ).rows[0]
}
