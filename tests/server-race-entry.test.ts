import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RaceEntryForm } from '../components/career/race-entry-workspace'
import { startCareer } from '../lib/career/model'
import { recommendRaceEntry, updateRaceEntryDraft } from '../lib/career/race-entry-recommendation'
import { contractedRoster, racesForTurn, tactics } from '../lib/career/race-entry'
import { validateSaveCommand } from '../lib/server-save/commands'
import { validateCareerResponse } from '../packages/shared/src/generated/save-validation.mjs'
import type { components } from '../packages/shared/src/generated/api'

const career = { ...startCareer('DEV_HORSE_SERENE_STEP'), month: 3, careerTurnIndex: 3 }
const envelope: unknown = {
  career: {
    id: randomUUID(),
    stableId: randomUUID(),
    ownedHorseId: randomUUID(),
    horseDefinitionId: career.horse.id,
    authority: 'server',
    funds: 100000000,
    event: null,
    status: 'active',
    revision: 1,
    state: JSON.parse(JSON.stringify(career)),
  },
}
if (!validateCareerResponse(envelope)) {
  throw new Error('invalid test fixture')
}
const options: components['schemas']['RaceEntryOptions'] = {
  career: envelope.career,
  defaultEngineVersion: 'race-sim-v3',
  restrictionReason: null,
  races: [
    {
      sourceKind: 'catalog',
      definition: { ...racesForTurn(3)[0], id: 'SERVER_ONLY', name: '서버 전용 경주' },
      eligible: true,
      restrictionReason: null,
    },
  ],
  jockeys: [
    { ...contractedRoster(career)[0], id: 'SERVER_JOCKEY', name: '서버 계약 기수', chemistry: 42 },
  ],
  tactics: [...tactics],
}

test('recommendation and Workspace use only server entries, actual contract jockeys and chemistry', () => {
  const draft = recommendRaceEntry(career, undefined, options)
  assert.equal(draft.raceId, 'SERVER_ONLY')
  assert.equal(draft.jockeyId, 'SERVER_JOCKEY')
  const markup = renderToStaticMarkup(
    createElement(RaceEntryForm, { career, busy: false, error: null, serverOptions: options }),
  )
  assert.match(markup, /서버 전용 경주/)
  assert.match(markup, /서버 계약 기수/)
  assert.doesNotMatch(markup, /DEV_M3_MILE_1600|한도윤/)
  const manual = updateRaceEntryDraft(career, draft, { tactic: '추입' }, options)
  assert.deepEqual(
    updateRaceEntryDraft(career, manual, { raceId: 'SERVER_ONLY' }, structuredClone(options)),
    manual,
  )
})

test('server injury and eligibility restrictions block confirmation without consulting Local eligibility', () => {
  const restricted = {
    ...options,
    restrictionReason: '부상으로 출전 불가',
    races: options.races.map((row) => ({
      ...row,
      eligible: false,
      restrictionReason: '등록 조건 미충족',
    })),
  }
  assert.equal(recommendRaceEntry(career, undefined, restricted).raceId, null)
  const markup = renderToStaticMarkup(
    createElement(RaceEntryForm, { career, busy: false, error: null, serverOptions: restricted }),
  )
  assert.match(markup, /등록 조건 미충족/)
  assert.match(markup, /disabled=""/)
  assert.equal(recommendRaceEntry(career, undefined, { ...options, races: [] }).raceId, null)
})

test('journal envelope validates generated race bodies and rejects result uploads and extra metadata', () => {
  const command = {
    kind: 'race-entry',
    careerId: randomUUID(),
    body: {
      raceRunId: randomUUID(),
      raceDefinitionId: 'SERVER_ONLY',
      jockeyId: 'SERVER_JOCKEY',
      tactic: '선行',
      expectedTurn: 3,
      engineVersion: 'race-sim-v3',
    },
  }
  assert.equal(validateSaveCommand(command), false)
  command.body.tactic = '선행'
  assert.equal(validateSaveCommand(command), true)
  assert.equal(validateSaveCommand({ ...command, state: career }), false)
  assert.equal(
    validateSaveCommand({ ...command, body: { ...command.body, seed: 'client' } }),
    false,
  )
  const complete = {
    kind: 'race-complete',
    careerId: command.careerId,
    raceRunId: command.body.raceRunId,
    body: { commandId: randomUUID() },
  }
  assert.equal(validateSaveCommand(complete), true)
  assert.equal(
    validateSaveCommand({ ...complete, body: { ...complete.body, prizeMoney: 9999 } }),
    false,
  )
})
