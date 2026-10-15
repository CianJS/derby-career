import { z } from 'zod'
import type { Database } from '../../db'
import { digest } from '../../services/identity'
import { importEvents, categories, timings } from './import'
import { catalogSchema } from './schema'
import { unreachableTrainingResult } from './semantics'
import type {
  EventCondition,
  EventDefinition,
  EventEffect,
  EventChoice,
} from '../../../../../packages/shared/src/events'

const stats = {
  속도: 'speed',
  스피드: 'speed',
  지구력: 'stamina',
  스태미나: 'stamina',
  파워: 'power',
  근성: 'guts',
  지능: 'intelligence',
} as const
const sourceSchema = z.object({ rows: z.array(z.record(z.string(), z.string())).length(1000) })
const statOf = (name: string) => stats[name as keyof typeof stats]
const trainingStat = (row: Record<string, string>) => {
  const names = [
    ...new Set(
      [...row['선택·효과'].matchAll(/(속도|지구력|파워|근성|지능) 훈련/g)].map((m) => statOf(m[1])),
    ),
  ]
  if (names.length !== 1) {
    throw new Error('AMBIGUOUS_TRAINING: 해당 능력/행동의 대상 확정 필요')
  }
  return names[0]
}
export function expansionConditions(row: Record<string, string>): EventCondition[] {
  let text = row['등장조건']
  // These phrases express the existing monthly UNIQUE invariant, not an extra eligibility shortcut.
  text = text.replace(
    /(?:, | · | 및 )(?:해당 월 다른 이벤트 미발생|해당 월 다른 이벤트 없음|동일 월 다른 이벤트 없음|월 시작 시 아직 이벤트 없음)$/,
    '',
  )
  const action = text.match(
    /(?: 및 | · )(해당 능력 훈련을 확정한 경우|해당 능력 훈련 확정|해당 월 휴식을 확정한 경우|휴식 확정|해당 행동 확정)$/,
  )
  const conditions: EventCondition[] = []
  if (action) {
    text = text.slice(0, action.index)
    if (action[1].includes('휴식')) {
      conditions.push({ type: 'action_is', choices: ['rest'] })
    } else {
      conditions.push({ type: 'action_is', choices: [trainingStat(row)] })
    }
  }
  text = text.replace(/ · 동일 월 다른 이벤트 없음$/, '')
  const statRange = text.match(/^(속도|지구력|파워|근성|지능|피로|신체 부하) (\d+) (이상|이하)$/)
  const aptitude = text.match(
    /^(?:거리 적성 )?(잔디|더트|단거리|마일|중거리|장거리|도주|선행|선입|추입)(?: 적성)? A 또는 B$/,
  )
  const aptitudePair = text.match(/^(도주 또는 선행|추입 또는 선입) 적성 B 이상$/)
  const growth = text.match(/^성장형 (조숙|표준|만성)$/)
  const health = text.match(/^건강 (경상|중등도 부상)$/)
  const wins = text.match(/^(?:통산|누적) (\d+)승 이상$/)
  const spread = text.match(/^5대 능력 최고\/최저 차이 (\d+) (이상|이하)$/)
  const confirmed = text.match(/^(속도|스피드|지구력|스태미나|파워|근성|지능) 훈련 확정$/)
  if (statRange) {
    conditions.push({
      type: 'value_range',
      key: statOf(statRange[1]) ?? (statRange[1] === '피로' ? 'fatigue' : 'bodyLoad'),
      [statRange[3] === '이상' ? 'min' : 'max']: Number(statRange[2]),
    })
  } else if (aptitude) {
    conditions.push({ type: 'aptitude_any', names: [aptitude[1]], grades: ['A', 'B'] })
  } else if (aptitudePair) {
    conditions.push({
      type: 'aptitude_any',
      names: aptitudePair[1].split(' 또는 '),
      grades: ['A', 'B'],
    })
  } else if (growth) {
    conditions.push({ type: 'growth_is', growth: growth[1] as '조숙' | '표준' | '만성' })
  } else if (health) {
    conditions.push({ type: 'health_is', health: [health[1]] })
  } else if (wins) {
    conditions.push({ type: 'record_range', metric: 'wins', min: Number(wins[1]) })
  } else if (text === '전적 0전') {
    conditions.push({ type: 'record_range', metric: 'starts', min: 0, max: 0 })
  } else if (spread) {
    conditions.push({
      type: 'stat_summary',
      metric: 'spread',
      [spread[2] === '이상' ? 'min' : 'max']: Number(spread[1]),
    })
  } else if (text === '5대 능력 중 3개 이상 550 이상') {
    conditions.push({ type: 'stat_summary', metric: 'count', threshold: 550, min: 3 })
  } else if (text === '한 능력치 850 이상') {
    conditions.push({ type: 'stat_summary', metric: 'count', threshold: 850, min: 1 })
  } else if (text === '현재 건강 정상 및 피로 30 이하') {
    conditions.push({ type: 'healthy' }, { type: 'value_range', key: 'fatigue', max: 30 })
  } else if (text === '건강 경상 또는 중등도 부상') {
    conditions.push({ type: 'health_is', health: ['경상', '중등도 부상'] })
  } else if (text === '건강 정상이며 이번 달 이벤트 미발생') {
    conditions.push({ type: 'healthy' })
  } else if (confirmed) {
    conditions.push({ type: 'action_is', choices: [statOf(confirmed[1])] })
  } else if (text === '휴식 행동 확정') {
    conditions.push({ type: 'action_is', choices: ['rest'] })
  } else if (text === '훈련 행동 확정') {
    conditions.push({
      type: 'action_is',
      choices: ['speed', 'stamina', 'power', 'guts', 'intelligence'],
    })
  } else {
    throw new Error(`UNSUPPORTED_CONDITION: ${text}`)
  }
  return conditions
}
function effectClause(text: string, row: Record<string, string>): EventEffect {
  const immediate = text.match(/^(?:즉시 )?(피로|신체 부하) ([+-]\d+)$/)
  if (immediate) {
    return {
      type: 'value_delta',
      key: immediate[1] === '피로' ? 'fatigue' : 'bodyLoad',
      amount: Number(immediate[2]),
    }
  }
  if (/다음/.test(text)) {
    throw new Error(`FUTURE_EFFECT: ${text}`)
  }
  const growth = text.match(
    /^(?:이번 달 )?(속도|지구력|파워|근성|지능) 훈련(?:의)? (?:주성장|성장) ([+-]\d+)(?: \(해당 훈련을 실행했을 때만\))?$/,
  )
  if (growth) {
    const stat = statOf(growth[1])
    if (row['발동시점'] !== '월 시작') {
      throw new Error(`LATE_MODIFIER: ${text}`)
    }
    return {
      type: 'action_modifier',
      action: 'training',
      training: stat,
      field: 'primaryGain',
      operation: 'add',
      value: Number(growth[2]),
    }
  }
  const modifier =
    text.match(
      /^(?:이번 달 |훈련 시 )?훈련 (피로 증가|피로|신체 부하 증가|보조성장|성장) ([+-]\d+)$/,
    ) ?? text.match(/^(신체 부하 증가) ([+-]\d+)$/)
  if (modifier && row['발동시점'] === '월 시작') {
    const field = modifier[1].startsWith('피로')
      ? 'fatigue'
      : modifier[1].startsWith('신체')
        ? 'bodyLoad'
        : modifier[1] === '보조성장'
          ? 'secondaryGain'
          : 'primaryGain'
    return {
      type: 'action_modifier',
      action: 'training',
      field,
      operation: 'add',
      value: Number(modifier[2]),
    }
  }
  throw new Error(`UNSUPPORTED_EFFECT: ${text}`)
}
export function expansionChoices(row: Record<string, string>): {
  choices: EventChoice[]
  automatic: boolean
} {
  const text = row['선택·효과']
  const pair = text.match(/^A: (.+) \/ B: (.+)$/)
  if (pair) {
    return {
      automatic: false,
      choices: pair.slice(1).map((label, index) => ({
        id: index ? 'B' : 'A',
        label,
        conditions: [],
        effects: label.split(/,\s*/).map((part) => effectClause(part, row)),
      })),
    }
  }
  const growth = text.match(
    /^(?:해당 )?(속도|지구력|파워|근성|지능) 훈련 결과 (?:주성장|성장) \+(\d+)(?:, 피로 \+(\d+) 추가)? \((?:자동|조건을 만족한 훈련 시 자동, 상한 적용)\)$/,
  )
  if (growth && row['발동시점'] === '훈련 결과') {
    const stat = statOf(growth[1])
    return {
      automatic: true,
      choices: [
        {
          id: 'auto',
          label: text,
          conditions: [{ type: 'action_is', choices: [stat] }],
          effects: [
            { type: 'value_delta', key: stat, amount: Number(growth[2]) },
            ...(growth[3]
              ? [
                  {
                    type: 'value_delta' as const,
                    key: 'fatigue' as const,
                    amount: Number(growth[3]),
                  },
                ]
              : []),
          ],
        },
      ],
    }
  }
  const recovery = text.match(/^(훈련|휴식) 결과 (.+) \(자동(?:, 최소 0)?\)$/)
  if (recovery && row['발동시점'] === `${recovery[1]} 결과`) {
    const effects: EventEffect[] = recovery[2].split(/,\s*/).map((part) => {
      const m = part.match(/^(피로|신체 부하) (-\d+) 추가$/)
      if (!m) {
        throw new Error(`UNSUPPORTED_EFFECT: ${part}`)
      }
      return {
        type: 'value_delta',
        key: m[1] === '피로' ? 'fatigue' : 'bodyLoad',
        amount: Number(m[2]),
      }
    })
    return { automatic: true, choices: [{ id: 'auto', label: text, conditions: [], effects }] }
  }
  throw new Error(`UNSUPPORTED_EFFECT: ${text}`)
}
export function buildExpansion(source: unknown) {
  const { rows } = sourceSchema.parse(source)
  const ids = new Set<string>()
  const counts = { COM: 350, GEN: 350, SPC: 150, ACC: 100, HID: 50 }
  for (const row of rows) {
    const id = row['이벤트 ID']
    if (!/^(COM|GEN|SPC|ACC|HID)-\d{4}$/.test(id) || ids.has(id)) {
      throw new Error(`Invalid/duplicate ID: ${id}`)
    }
    ids.add(id)
    for (const field of [
      '이벤트명',
      '대분류',
      '도입',
      '등장조건',
      '발동시점',
      '선택·효과',
      '세부유형',
    ]) {
      if (!row[field]?.trim()) {
        throw new Error(`Missing ${field}: ${id}`)
      }
    }
    const prefix = id.slice(0, 3) as keyof typeof counts
    const limit = { COM: 350, GEN: 350, SPC: 150, ACC: 100, HID: 50 }[prefix]
    if (Number(id.slice(4)) < 1 || Number(id.slice(4)) > limit) {
      throw new Error(`Out of catalog ID range: ${id}`)
    }
    if (--counts[prefix] < 0) {
      throw new Error('Unexpected category count')
    }
    const category = categories[row['대분류'] as keyof typeof categories]
    if (
      category !==
      ({ COM: 'common', GEN: 'normal', SPC: 'special', ACC: 'accident', HID: 'hidden' } as const)[
        prefix
      ]
    ) {
      throw new Error(`Category mismatch: ${id}`)
    }
  }
  if (Object.values(counts).some((n) => n !== 0)) {
    throw new Error('All 1000 IDs are required')
  }
  const events: EventDefinition[] = rows
    .filter((row) => !row['이벤트 ID'].startsWith('COM-'))
    .sort((a, b) => a['이벤트 ID'].localeCompare(b['이벤트 ID']))
    .map((row) => {
      if (row['도입'] !== '보류') {
        throw new Error(`Expansion is not reviewed: ${row['이벤트 ID']}`)
      }
      const notes: string[] = []
      let conditions: EventCondition[] = []
      let choices: EventChoice[] = []
      let automatic = false
      try {
        conditions = expansionConditions(row)
      } catch (error) {
        notes.push((error as Error).message)
      }
      try {
        ;({ choices, automatic } = expansionChoices(row))
      } catch (error) {
        notes.push((error as Error).message)
      }
      if (!timings[row['발동시점']]) {
        throw new Error(`Invalid timing: ${row['이벤트 ID']}`)
      }
      if (['before_race', 'after_race'].includes(timings[row['발동시점']])) {
        notes.push('UNSUPPORTED_TIMING: race hooks not implemented')
      }
      if (row['대분류'] === '히든' && conditions.filter((c) => c.type !== 'always').length < 2) {
        notes.push('HIDDEN_COMPOUND: complete compound conditions required')
      }
      if (
        choices.length &&
        unreachableTrainingResult({ timing: timings[row['발동시점']], conditions, choices })
      ) {
        notes.push(
          'UNREACHABLE_TRAINING_RESULT: injured horses cannot train in the shared action model',
        )
      }
      const converted = notes.length === 0
      const definition: Omit<EventDefinition, 'revision'> = {
        id: row['이벤트 ID'],
        name: row['이벤트명'],
        category: categories[row['대분류'] as keyof typeof categories],
        subtype: row['세부유형'],
        introduction: 'hold',
        timing: timings[row['발동시점']],
        status: converted ? 'ready' : 'needs_mapping',
        enabled: false,
        weight: 1,
        balanceVersion: 'notion-expansion-v1',
        description: null,
        conditions,
        choices,
        automatic,
        source: { url: null, conditionText: row['등장조건'], effectText: row['선택·효과'] },
        mappingNotes: notes,
        review: {
          sourceDigest: digest(
            Object.fromEntries(
              [
                '이벤트 ID',
                '이벤트명',
                '대분류',
                '도입',
                '등장조건',
                '발동시점',
                '선택·효과',
                '세부유형',
                '사건그룹 ID',
              ].map((k) => [k, row[k]]),
            ),
          ),
          converted,
          executable: converted,
          contentReviewed: false,
          balanceReviewed: false,
          groupId: row['사건그룹 ID'] || null,
          representativeId: null,
        },
      }
      return { ...definition, revision: digest(definition) }
    })
  return catalogSchema.parse({ schemaVersion: 1, events })
}
/** Re-running a source import preserves already reviewed definitions; raw source changes need review. */
export async function importExpansion(db: Database, source: unknown) {
  return importEvents(db, buildExpansion(source), { expansionOnly: true })
}
export const approvalSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            id: z.string(),
            revision: z.string().regex(/^[a-f0-9]{64}$/),
            contentReviewed: z.literal(true),
            balanceReviewed: z.literal(true),
            groupReviewed: z.literal(true),
            representativeId: z.string().nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
export async function activateExpansion(db: Database, value: unknown) {
  const approval = approvalSchema.parse(value)
  if (new Set(approval.events.map((e) => e.id)).size !== approval.events.length) {
    throw new Error('Duplicate approval ID')
  }
  const events: EventDefinition[] = []
  for (const entry of approval.events) {
    const event = (
      await db.query(
        'SELECT r.definition FROM event_definitions e JOIN event_revisions r ON r.event_id=e.id AND r.revision=e.current_revision WHERE e.id=$1',
        [entry.id],
      )
    ).rows[0]?.definition as EventDefinition | undefined
    if (
      !event?.review ||
      event.category === 'common' ||
      event.revision !== entry.revision ||
      !event.review.converted ||
      !event.review.executable
    ) {
      throw new Error(`Unmapped or stale approval: ${entry.id}`)
    }
    if (entry.representativeId && entry.representativeId !== entry.id) {
      throw new Error(
        'Representative remapping needs a separate reviewed migration; no automatic consolidation',
      )
    }
    const { revision: _revision, ...definition } = event
    definition.review = {
      ...event.review,
      contentReviewed: true,
      balanceReviewed: true,
      representativeId: entry.representativeId,
    }
    definition.enabled = true
    events.push({ ...definition, revision: digest(definition) })
  }
  return importEvents(
    db,
    { schemaVersion: 1, events },
    { expectedRevisions: Object.fromEntries(approval.events.map((e) => [e.id, e.revision])) },
  )
}
