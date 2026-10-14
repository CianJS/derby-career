import { parse } from 'csv-parse/sync'
import { trainings, type Stat } from '../../../../../packages/shared/src/domain'
import type {
  EventDefinition,
  EventCondition,
  EventEffect,
  EventChoice,
  EventTiming,
} from '../../../../../packages/shared/src/events'
import { catalogSchema } from './schema'
import { digest } from '../../services/identity'
import type { Database } from '../../db'
import { draftCatalogSchema, isQuarantinedEvent } from './drafts'

type Row = Record<string, string>
const stats: Record<string, Stat> = {
  속도: 'speed',
  지구력: 'stamina',
  파워: 'power',
  근성: 'guts',
  지능: 'intelligence',
}
const categories = {
  공통: 'common',
  일반: 'normal',
  특별: 'special',
  사고: 'accident',
  히든: 'hidden',
} as const
const timings: Record<string, EventTiming> = {
  '월 시작': 'month_start',
  '훈련 결과': 'training_result',
  '휴식 결과': 'rest_result',
  '치료 결과': 'treatment_result',
  '경주 전': 'before_race',
  '경주 후': 'after_race',
}
const introductions = { '공통 1차 후보': 'candidate', 후속: 'followup', 보류: 'hold' } as const
const statFrom = (s: string) => Object.entries(stats).find(([k]) => s.includes(k))?.[1]

// Text interpretation is ONLY an offline import step. Runtime executes discriminated types.
// Unknown grammar/conditions are retained but disabled, never guessed or silently skipped.
function conditionsFor(row: Row): EventCondition[] {
  const text = row['등장조건']
  const stat = statFrom(text)
  const common = new Set([
    '모든 육성마',
    '모든 육성마. 월간 행동 확정 전이며 다른 이벤트 없음',
    '모든 육성마, 해당 월 이벤트가 아직 없음',
    '월간 행동 확정 전, 모든 육성마 (조건부 훈련 보너스는 가능한 행동에만 적용)',
  ])
  if (common.has(text)) {
    return [{ type: 'always' }]
  }
  if (
    stat &&
    /^(?:이번 달 (?:속도|지구력|파워|근성|지능) 훈련 가능(?:, 중상·경상 등 부상으로 훈련 차단되지 않음)?|부상 없는 말이 (?:속도|지구력|파워|근성|지능) 훈련을 선택할 수 있는 달)$/.test(
      text,
    )
  ) {
    return [{ type: 'training_available', stat }]
  }
  if (
    stat &&
    /^(?:속도|지구력|파워|근성|지능) 훈련(?: 확정|을 이번 달 확정하고 월간 다른 이벤트가 없음)$/.test(
      text,
    )
  ) {
    return [{ type: 'action_is', choices: [stat] }]
  }
  if (text === '휴식 또는 치료 확정') {
    return [{ type: 'action_is', choices: ['rest', 'treatment'] }]
  }
  if (text === '휴식 확정' || text === '이번 달 휴식 행동을 확정한 말') {
    return [{ type: 'action_is', choices: ['rest'] }]
  }
  if (text === '치료 확정' || text === '실제 부상이 있어 이번 달 치료를 확정한 말') {
    return [{ type: 'action_is', choices: ['treatment'] }]
  }
  throw new Error('등장 조건 구조화 필요')
}
function deltas(text: string): EventEffect[] {
  const matches = [...text.matchAll(/(피로|신체 부하|부하)\s*([+-]\d+)/g)]
  return matches.map((m) => ({
    type: 'value_delta',
    key: m[1] === '피로' ? 'fatigue' : 'bodyLoad',
    amount: Number(m[2]),
  }))
}
function choiceEffects(text: string): EventEffect[] {
  const clauses = text.replace(/\.$/, '').split(/,\s*/)
  const effects: EventEffect[] = []
  let inherited: Extract<EventEffect, { type: 'action_modifier' }> | undefined
  for (const clause of clauses) {
    if (/^즉시 (피로|신체 부하) [+-]\d+$/.test(clause)) {
      effects.push(...deltas(clause))
      continue
    }
    const trainingClause =
      /^(?:이번 달 )?(?:(?:속도|지구력|파워|근성|지능) )?훈련 (?:주성장|피로 증가|(?:신체 )?부하(?: 증가)?) [+-]\d+(?: 감소)?$/
    const restClause =
      /^(?:이번 달 )?휴식(?:의)? (?:피로|신체 부하|부하) (?:회복량|회복)(?: 추가)? [+-]\d+$/
    const inheritedClause = /^(?:피로|신체 부하|부하) [+-]\d+$/
    if (
      !trainingClause.test(clause) &&
      !restClause.test(clause) &&
      !(inherited && inheritedClause.test(clause))
    ) {
      throw new Error(`지원하지 않는 선택 효과 문법: ${clause}`)
    }
    const isRest = /휴식/.test(clause)
    const isTraining = /훈련/.test(clause)
    const training = statFrom(clause)
    const number = clause.match(/([+-]\d+)(?: 감소)?$/)
    if (!number) {
      throw new Error(`선택 효과 구조화 필요: ${clause}`)
    }
    const field = /주성장/.test(clause)
      ? 'primaryGain'
      : /피로/.test(clause)
        ? 'fatigue'
        : /부하/.test(clause)
          ? 'bodyLoad'
          : undefined
    if (!field || (!isRest && !isTraining && !inherited)) {
      throw new Error(`선택 범위 구조화 필요: ${clause}`)
    }
    let value = Number(number[1])
    if ((isRest && value > 0 && /회복/.test(clause)) || /감소$/.test(clause)) {
      value = -Math.abs(value)
    }
    const effect: Extract<EventEffect, { type: 'action_modifier' }> = {
      type: 'action_modifier',
      action: isRest ? 'rest' : 'training',
      ...(training ? { training } : inherited?.training ? { training: inherited.training } : {}),
      field,
      operation: 'add',
      value,
    }
    effects.push(effect)
    inherited = effect
  }
  return effects
}
function choicesFor(row: Row): { choices: EventChoice[]; automatic: boolean } {
  const text = row['선택·효과']
  const subtype = row['세부유형']
  const choice = (id: string, label: string, effects: EventEffect[]): EventChoice => ({
    id,
    label,
    conditions: [],
    effects,
  })
  if (text.startsWith('A:')) {
    const m = text.match(/^A:\s*(.*?)\s*\/\s*B:\s*(.*)$/)
    if (!m) {
      throw new Error('선택지 구조화 필요')
    }
    const choices = [
      choice('A', m[1].replace(/\.$/, ''), choiceEffects(m[1])),
      choice('B', m[2].replace(/\.$/, ''), choiceEffects(m[2])),
    ]
    for (const c of choices) {
      if (c.effects.every((e) => e.type === 'action_modifier' && e.action === 'training')) {
        c.conditions = [{ type: 'healthy' }]
      }
    }
    return { automatic: false, choices }
  }
  if (subtype === '집중 조교') {
    const normalized = text
      .replace(/\. 미선택 시 소멸\.$/, '')
      .replace(/\.?(?: 같은 달 다른 성장 대성공과 중복 불가| 다른 성장 이벤트와 중복 불가)\.$/, '')
      .replace(/\.$/, '')
    const clauses = normalized.split(/[,;]\s*/)
    if (
      !/^(?:이번 달 )?(?:속도|지구력|파워|근성|지능) (?:훈련 )?(?:선택 시 )?주성장 ×\d+(?:\.\d+)?$/.test(
        clauses[0],
      ) ||
      clauses
        .slice(1)
        .some(
          (c) =>
            !/^(?:추가 )?(?:피로|신체 부하|부하) [+-]\d+$/.test(c) &&
            !/^보조 (?:속도|지구력|파워|근성|지능) 추가 \+\d+$/.test(c),
        )
    ) {
      throw new Error('지원하지 않는 집중 조교 효과 문법')
    }
    const stat = statFrom(row['등장조건'])
    const ratio = text.match(/주성장 ×([\d.]+)/)
    if (!stat || !ratio) {
      throw new Error('집중 조교 성장 배율 구조화 필요')
    }
    const effects: EventEffect[] = [
      {
        type: 'action_modifier',
        action: 'training',
        training: stat,
        field: 'primaryGain',
        operation: 'multiply',
        value: Number(ratio[1]),
      },
    ]
    for (const d of deltas(text) as Extract<EventEffect, { type: 'value_delta' }>[]) {
      effects.push({
        type: 'action_modifier',
        action: 'training',
        training: stat,
        field: d.key as 'fatigue' | 'bodyLoad',
        operation: 'add',
        value: d.amount,
      })
    }
    const secondary = text.match(/보조 (속도|지구력|파워|근성|지능) 추가 \+(\d+)/)
    if (secondary) {
      if (trainings[stat].secondary !== stats[secondary[1]]) {
        throw new Error('기존 보조 성장과 불일치')
      }
      effects.push({
        type: 'action_modifier',
        action: 'training',
        training: stat,
        field: 'secondaryGain',
        operation: 'add',
        value: Number(secondary[2]),
      })
    }
    return { automatic: true, choices: [choice('auto', text, effects)] }
  }
  if (subtype === '훈련 대성공') {
    const normalized = text.replace(/\. 1000 상한·성장 둔화 적용\.$/, '').replace(/\.$/, '')
    const clauses = normalized.split(/,\s*/)
    if (
      !/^(?:저장된 (?:속도|지구력|파워|근성|지능) 주성장량에 추가 ×\d+(?:\.\d+)?만큼 더함|(?:속도|지구력|파워|근성|지능) 주성장 추가 ×\d+(?:\.\d+)?|확정된 (?:속도|지구력|파워|근성|지능) 주성장량의 \d+% 추가)$/.test(
        clauses[0],
      ) ||
      clauses
        .slice(1)
        .some(
          (c) =>
            !/^(?:피로|신체 부하|부하) [+-]\d+$/.test(c) &&
            !/^추가 (?:피로|부하) 없음$/.test(c) &&
            !/^(?:보조 능력|(?:속도|지구력|파워|근성|지능) 보조성장) (?:추가 )?\+\d+$/.test(c),
        )
    ) {
      throw new Error('지원하지 않는 훈련 대성공 효과 문법')
    }
    const stat = statFrom(row['등장조건'])
    const percent = text.match(/(\d+)%/)
    const multiplier = text.match(/×([\d.]+)/)
    if (!stat || (!percent && !multiplier)) {
      throw new Error('확정 성장 보너스 구조화 필요')
    }
    const effects: EventEffect[] = [
      {
        type: 'resolved_growth_bonus',
        stat,
        ratio: percent ? Number(percent[1]) / 100 : Number(multiplier![1]),
      },
      ...deltas(text),
    ]
    const secondary = text.match(
      /(?:보조 능력|(?:속도|지구력|파워|근성|지능) 보조성장) (?:추가 )?\+(\d+)/,
    )
    if (secondary) {
      const key = trainings[stat].secondary
      if (!key) {
        throw new Error('보조 능력이 정의되지 않음')
      }
      effects.push({ type: 'value_delta', key, amount: Number(secondary[1]) })
    }
    return { automatic: true, choices: [choice('auto', text, effects)] }
  }
  if (subtype === '상태·회복') {
    const recoveryAmount = text.match(/^확정한 행동의 신체 부하 회복량에 (-\d+) 추가\.$/)
    const normalized = text
      .replace(/^(?:기본 휴식 결과에|휴식 기본 효과에|기존 치료 효과에|치료 기본 효과에) /, '')
      .replace(/ 추가(?:\(최소 0\))?\.?$/, '')
    if (
      !recoveryAmount &&
      !/^(?:피로|신체 부하) -\d+(?:, (?:피로|신체 부하) -\d+)*$/.test(normalized)
    ) {
      throw new Error('지원하지 않는 회복 효과 문법')
    }
    const effects: EventEffect[] = recoveryAmount
      ? [{ type: 'value_delta', key: 'bodyLoad', amount: Number(recoveryAmount[1]) }]
      : deltas(text)
    if (!effects.length) {
      throw new Error('회복 수치 구조화 필요')
    }
    return { automatic: true, choices: [choice('auto', text, effects)] }
  }
  throw new Error('실행 효과 구조화 필요')
}

export function convertNotionRows(rows: Row[]) {
  const ids = new Set<string>()
  const events: EventDefinition[] = rows.map((row) => {
    const id = row['이벤트 ID']
    const category = categories[row['대분류'] as keyof typeof categories]
    const timing = timings[row['발동시점']]
    const introduction = introductions[row['도입'] as keyof typeof introductions]
    if (!id || !row['이벤트명'] || !category || !timing || !introduction || ids.has(id)) {
      throw new Error(`Invalid/duplicate source row: ${id ?? '(missing ID)'}`)
    }
    ids.add(id)
    const mappingNotes: string[] = []
    let conditions: EventCondition[] = []
    let choices: EventChoice[] = []
    let automatic = false
    if (introduction === 'followup') {
      mappingNotes.push('후속 적용: 레이스 효과 배율 미확정. v1/v2를 변경하지 않음.')
    } else {
      try {
        conditions = conditionsFor(row)
        ;({ choices, automatic } = choicesFor(row))
      } catch (error) {
        mappingNotes.push((error as Error).message)
        choices = []
        automatic = false
      }
    }
    const status =
      introduction === 'followup' ? 'deferred' : mappingNotes.length ? 'needs_mapping' : 'ready'
    const description =
      row.description?.trim() ||
      row.body
        ?.split('\n')
        .find((line) => line.startsWith('> '))
        ?.slice(2) ||
      null
    const definition = {
      id,
      name: row['이벤트명'],
      category,
      subtype: row['세부유형'],
      introduction,
      timing,
      status,
      enabled: status === 'ready' && introduction === 'candidate',
      weight: 1,
      balanceVersion: 'notion-proposal-2026-10-12',
      description,
      conditions,
      choices,
      automatic,
      source: {
        url: row.url || null,
        conditionText: row['등장조건'],
        effectText: row['선택·효과'],
        ...(row.body ? { body: row.body } : {}),
      },
      mappingNotes,
    } as Omit<EventDefinition, 'revision'>
    return { ...definition, revision: digest(definition) }
  })
  return catalogSchema.parse({ schemaVersion: 1, events })
}
export function readEventSource(text: string, format: 'json' | 'csv') {
  if (format === 'csv') {
    return convertNotionRows(
      parse(text, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: false }),
    )
  }
  const data = JSON.parse(text)
  return 'rows' in data ? convertNotionRows(data.rows) : catalogSchema.parse(data)
}
export async function importEvents(
  db: Database,
  value: unknown,
  options: { draftsOnly?: boolean } = {},
) {
  const catalog = catalogSchema.parse(value)
  if (new Set(catalog.events.map((x) => x.id)).size !== catalog.events.length) {
    throw new Error('Duplicate event IDs in catalog')
  }
  for (const event of catalog.events) {
    if (options.draftsOnly && !isQuarantinedEvent(event)) {
      throw new Error(`Event is not a quarantined draft: ${event.id}`)
    }
    const { revision, ...definition } = event
    if (digest(definition) !== revision) {
      throw new Error(`Revision checksum mismatch: ${event.id}`)
    }
  }
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(182946,2)')
    if (options.draftsOnly) {
      const existing = await tx.query(
        'SELECT e.id,e.enabled,e.status,r.definition FROM event_definitions e JOIN event_revisions r ON r.event_id=e.id AND r.revision=e.current_revision WHERE e.id=ANY($1::text[])',
        [catalog.events.map((event) => event.id)],
      )
      for (const row of existing.rows) {
        if (row.enabled || row.status === 'ready' || !isQuarantinedEvent(row.definition)) {
          throw new Error(`Draft import cannot overwrite an existing reviewed event: ${row.id}`)
        }
      }
    }
    for (const event of catalog.events) {
      await tx.query(
        'INSERT INTO event_definitions(id,name,category,status,enabled,current_revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,status=EXCLUDED.status,enabled=EXCLUDED.enabled,current_revision=EXCLUDED.current_revision',
        [event.id, event.name, event.category, event.status, event.enabled, event.revision],
      )
      await tx.query(
        'INSERT INTO event_revisions(event_id,revision,definition) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [event.id, event.revision, JSON.stringify(event)],
      )
      for (const choice of event.choices) {
        await tx.query(
          'INSERT INTO event_choices(event_id,revision,choice_id,label,conditions) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [event.id, event.revision, choice.id, choice.label, JSON.stringify(choice.conditions)],
        )
        for (let i = 0; i < choice.effects.length; i++) {
          await tx.query(
            'INSERT INTO event_effects(event_id,revision,choice_id,ordinal,effect_type,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
            [
              event.id,
              event.revision,
              choice.id,
              i,
              choice.effects[i].type,
              JSON.stringify(choice.effects[i]),
            ],
          )
        }
      }
    }
  })
  return {
    imported: catalog.events.length,
    enabled: catalog.events.filter((x) => x.enabled).length,
    needsMapping: catalog.events.filter((x) => x.status === 'needs_mapping').map((x) => x.id),
    deferred: catalog.events.filter((x) => x.status === 'deferred').length,
  }
}

/** Deliberately different envelope/command: ordinary import rejects this packet. */
export async function importEventDrafts(db: Database, value: unknown) {
  const catalog = draftCatalogSchema.parse(value)
  const result = await importEvents(
    db,
    { schemaVersion: 1, events: catalog.events },
    { draftsOnly: true },
  )
  return { ...result, sourceDigest: catalog.sourceDigest }
}

// Reuse the existing offline grammar in preflight without changing the 350-event converter.
export { categories, timings, introductions, conditionsFor, choicesFor }
