import type { components } from '../../packages/shared/src/generated/api'
import {
  validateCareerResponse,
  validateRetireCareerResponse,
  validateExpeditionHistory,
} from '../../packages/shared/src/generated/save-validation.mjs'
import { validateEventDefinition } from '../../packages/shared/src/generated/event-validation.mjs'
import { assertRaceRecords } from '../career/lifecycle-save'
import { labels } from '../career/model'

type Models = components['schemas']
export type HistoryPath = 'actions' | 'events' | 'records' | 'expeditions/history' | 'retirement'
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key))
const integer = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 1
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const uuid = (id: unknown) =>
  typeof id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
const instant = (date: unknown) =>
  typeof date === 'string' && /^\d{4}-\d\d-\d\dT/.test(date) && Number.isFinite(Date.parse(date))
const changes = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (change) =>
      object(change) &&
      keys(change, ['key', 'before', 'after']) &&
      Object.hasOwn(labels, String(change.key)) &&
      finite(change.before) &&
      finite(change.after),
  )
const statuses = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (row) =>
        object(row) &&
        keys(row, ['key', 'before', 'after']) &&
        ['health', 'condition', 'recovery'].includes(String(row.key)) &&
        typeof row.before === 'string' &&
        typeof row.after === 'string',
    ))
function action(value: unknown): boolean {
  if (
    !object(value) ||
    !keys(value, ['id', 'turn', 'kind', 'record', 'result', 'createdAt', 'resolvedAt']) ||
    !uuid(value.id) ||
    !integer(value.turn) ||
    !['training', 'rest', 'treatment', 'race'].includes(String(value.kind)) ||
    !instant(value.createdAt) ||
    (value.resolvedAt !== null && !instant(value.resolvedAt))
  ) {
    return false
  }
  if (value.record !== null) {
    const record = value.record
    if (
      !object(record) ||
      !keys(record, [
        'actionId',
        'horseId',
        'month',
        'actionType',
        'trainingType',
        'seed',
        'result',
        'statusChanges',
      ]) ||
      typeof record.actionId !== 'string' ||
      typeof record.horseId !== 'string' ||
      !integer(record.month) ||
      record.month !== value.turn ||
      record.actionType !== value.kind ||
      (record.trainingType !== null &&
        !['speed', 'stamina', 'power', 'guts', 'intelligence'].includes(
          String(record.trainingType),
        )) ||
      !finite(record.seed) ||
      (record.result !== null && !changes(record.result)) ||
      !statuses(record.statusChanges)
    ) {
      return false
    }
  }
  if (value.result !== null) {
    if (!object(value.result)) {
      return false
    }
    if (value.kind === 'race') {
      if (
        !keys(value.result, [
          'playerHorseId',
          'placing',
          'finishTime',
          'marginToWinner',
          'prizeMoney',
        ]) ||
        typeof value.result.playerHorseId !== 'string' ||
        !finite(value.result.finishTime) ||
        !finite(value.result.marginToWinner) ||
        !integer(value.result.placing) ||
        !finite(value.result.prizeMoney)
      ) {
        return false
      }
    } else if (
      !keys(value.result, ['changes', 'statusChanges']) ||
      !changes(value.result.changes) ||
      !statuses(value.result.statusChanges)
    ) {
      return false
    }
  }
  return true
}
function event(value: unknown): boolean {
  if (
    !object(value) ||
    !keys(value, [
      'id',
      'turn',
      'eventId',
      'revision',
      'choiceId',
      'state',
      'definition',
      'result',
    ]) ||
    !uuid(value.id) ||
    !integer(value.turn) ||
    typeof value.eventId !== 'string' ||
    typeof value.revision !== 'string' ||
    !['pending', 'selected', 'applied', 'expired'].includes(String(value.state)) ||
    (value.choiceId !== null && typeof value.choiceId !== 'string') ||
    !validateEventDefinition(value.definition)
  ) {
    return false
  }
  if (value.result !== null) {
    if (
      !object(value.result) ||
      !keys(value.result, ['changes', 'actionChanges', 'trustChanges', 'risk']) ||
      !changes(value.result.changes) ||
      (value.result.actionChanges !== undefined && !changes(value.result.actionChanges))
    ) {
      return false
    }
    if (
      value.result.trustChanges !== undefined &&
      (!Array.isArray(value.result.trustChanges) ||
        !value.result.trustChanges.every(
          (change) =>
            object(change) &&
            keys(change, ['jockeyId', 'before', 'after', 'delta']) &&
            typeof change.jockeyId === 'string' &&
            finite(change.before) &&
            finite(change.after) &&
            Number(change.before) >= 0 &&
            Number(change.before) <= 100 &&
            Number(change.after) >= 0 &&
            Number(change.after) <= 100 &&
            change.delta === Number(change.after) - Number(change.before),
        ))
    ) {
      return false
    }
  }
  return true
}
/** Four legacy history envelopes lack generated validators. Reuse generated nested validators,
 * and validate the fields read by the UI; no API/game rules are reimplemented here. */
export function validHistory(
  path: HistoryPath,
  value: unknown,
  careerId: string,
  page = 1,
  pageSize = 20,
): boolean {
  if (
    !object(value) ||
    !keys(value, path === 'retirement' ? ['retirement'] : ['data', 'page', 'pageSize'])
  ) {
    return false
  }
  if (path === 'retirement') {
    const record = value.retirement
    return (
      object(record) &&
      record.careerId === careerId &&
      object(record.snapshot) &&
      record.snapshot.id === careerId &&
      record.snapshot.status === 'retired' &&
      validateCareerResponse({ career: record.snapshot }) &&
      validateRetireCareerResponse({ career: record.snapshot, retirement: record })
    )
  }
  if (
    !Array.isArray(value.data) ||
    value.page !== page ||
    value.pageSize !== pageSize ||
    value.data.length > pageSize
  ) {
    return false
  }
  if (path === 'expeditions/history') {
    return (
      validateExpeditionHistory(value) &&
      value.data.every(
        (row) =>
          row.careerId === careerId &&
          (row.status === 'active'
            ? row.endedTurn === null && row.endReason === null
            : row.endedTurn !== null && row.endedTurn >= row.startedTurn && row.endReason !== null),
      )
    )
  }
  if (path === 'actions') {
    return value.data.every(action)
  }
  if (path === 'events') {
    return value.data.every(event)
  }
  try {
    assertRaceRecords(value.data)
    return value.data.every(
      (row) =>
        row.trustChange === undefined ||
        (object(row.trustChange) &&
          finite(row.trustChange.before) &&
          finite(row.trustChange.after) &&
          finite(row.trustChange.delta) &&
          row.trustChange.delta === Number(row.trustChange.after) - Number(row.trustChange.before)),
    )
  } catch {
    return false
  }
}
export type HistoryData = {
  actions: Models['ActionHistory'][]
  events: Models['CareerEvent'][]
  records: Models['HorseRaceRecord'][]
  expeditions: Models['Expedition'][]
  retirement?: Models['RetirementRecord']
}
