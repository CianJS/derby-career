import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { parseSaveWorkspace } from '../lib/server-save/workspace'
import {
  validateSaveResponse,
  type SaveResponseKind,
} from '../packages/shared/src/save-response-validation'
import type { components } from '../packages/shared/src/generated/api'

type Models = components['schemas']
const state = startCareer('DEV_HORSE_SERENE_STEP')
const career: Models['Career'] = {
  id: randomUUID(),
  stableId: randomUUID(),
  ownedHorseId: randomUUID(),
  horseDefinitionId: 'DEV_HORSE_SERENE_STEP',
  status: 'active',
  revision: 1,
  authority: 'server',
  funds: 42800000,
  state: { ...state, raceRun: undefined, raceRecords: [...state.raceRecords] },
  event: null,
}
const retired: Models['Career'] = { ...career, status: 'retired' }
const retirement: Models['RetirementRecord'] = {
  careerId: career.id,
  reason: 'manual',
  retiredAt: '2026-10-15T00:00:00Z',
  retiredOn: { year: 2028, month: 4 },
  snapshot: retired,
}
const responses: Record<SaveResponseKind, unknown> = {
  create: { career },
  action: { actionId: randomUUID(), career },
  advance: { career },
  event: { career },
  retire: { career: retired, retirement },
  'race-entry': { raceRunId: randomUUID(), career },
  'race-complete': {
    raceRunId: randomUUID(),
    career,
    result: {
      playerHorseId: career.state.horse.id,
      placing: 1,
      finishTime: 100,
      marginToWinner: 0,
      prizeMoney: 1000000,
    },
  },
}
const kinds: SaveResponseKind[] = [
  'create',
  'action',
  'advance',
  'event',
  'retire',
  'race-entry',
  'race-complete',
]

test('all command kinds accept their existing receipt contract and reject malformed bodies', () => {
  for (const kind of kinds) {
    assert.equal(validateSaveResponse(kind, responses[kind]), true, kind)
    for (const invalid of [null, [], {}, { career: null }, { error: { code: 'ERROR' } }]) {
      assert.equal(validateSaveResponse(kind, invalid), false, kind)
    }
  }
})

test('action, retirement and race receipts cannot be replaced with a generic Career response', () => {
  for (const kind of ['action', 'retire', 'race-entry', 'race-complete'] as const) {
    assert.equal(validateSaveResponse(kind, { career }), false, kind)
  }
})

function workspace(): Models['CareerWorkspace'] {
  return {
    stable: { id: career.stableId, funds: career.funds, calendarDate: { year: 2028, month: 4 } },
    career,
    confirmedActionId: null,
    retirements: [retirement],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  }
}

test('workspace parsing preserves the response and enforces active and immutable archive identities', () => {
  const saved = workspace()
  assert.equal(parseSaveWorkspace(saved), saved)
  assert.throws(() => parseSaveWorkspace({ ...saved, career: retired }), /현재/)
  assert.throws(
    () => parseSaveWorkspace({ ...saved, stable: { ...saved.stable, id: randomUUID() } }),
    /현재/,
  )
  assert.throws(
    () =>
      parseSaveWorkspace({ ...saved, retirements: [{ ...retirement, careerId: randomUUID() }] }),
    /은퇴/,
  )
  assert.throws(
    () => parseSaveWorkspace({ ...saved, retirements: [{ ...retirement, snapshot: career }] }),
    /은퇴/,
  )
})
