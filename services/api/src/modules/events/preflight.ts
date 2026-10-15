import { parse } from 'csv-parse/sync'
import { z } from 'zod'
import type {
  EventDefinition,
  EventCondition,
  EventChoice,
} from '../../../../../packages/shared/src/events'
import { categories, timings, introductions, conditionsFor, choicesFor } from './import'
import { catalogSchema, eventSchema, conditionSchema, effectSchema } from './schema'
import {
  DRAFT_BALANCE_VERSION,
  draftCatalogSchema,
  draftSourceDigest,
  eventIdPrefixes,
  type DraftCatalog,
} from './drafts'
import { digest } from '../../services/identity'
import { effectSemanticIssues, effectSemanticCodes } from './semantics'

export type InspectionIssue = {
  kind: 'error' | 'unmapped' | 'engine_gap' | 'review'
  code: string
  path: string
  detail: string
  row?: number
  id?: string
}
export const sourceFields = [
  '이벤트 ID',
  '이벤트명',
  '대분류',
  '도입',
  '등장조건',
  '발동시점',
  '선택·효과',
  '세부유형',
] as const
const subtypes = ['집중 조교', '훈련 대성공', '돌발 발견', '상태·회복', '생활·마방', '경주 준비']
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const lookup = <T>(map: Record<string, T>, key: string) =>
  Object.hasOwn(map, key) ? map[key] : undefined

// These are evidence tags for review, NOT a natural-language converter or inferred executable rule.
const conditionGaps: [string, RegExp, string][] = [
  ['APTITUDE', /적성/, '적성 등급/각질 조건 타입 없음'],
  ['GROWTH_TYPE', /성장형/, '성장형 조건 타입 없음'],
  [
    'HISTORY',
    /최근|연속|누적|통산|전적|회복을 마친|첫 승|중상에서/,
    '전적·행동·회복 이력 조건 타입 없음',
  ],
  ['JOCKEY_RELATION', /계약 기수|호흡도/, '기수 계약·호흡도 조건 타입 없음'],
  ['RACE_CONTEXT', /경주|출전|거리대|전술/, '경주 조건/출전 기록 조건 타입 없음'],
  ['CONDITION_STATE', /컨디션/, '컨디션 등급 조건 타입 없음'],
  ['INJURY_SEVERITY', /경상|중등도|중상/, 'healthy 외 부상 심각도 조건 타입 없음'],
  ['AGE', /\d+세/, '말 연령 조건 타입 없음; turn_range로 대체하지 않음'],
  ['AGGREGATE_VALUES', /5대 능력|최고\/최저|한 능력치/, '능력치 간 비교·개수·OR 조건 타입 없음'],
  ['ARCHIVE', /은퇴마/, '마방 은퇴 이력 조건 타입 없음'],
]
const effectGaps: [string, RegExp, string][] = [
  [
    'FUTURE_MODIFIER',
    /다음|영구|\d+개월간/,
    '보정은 같은 달 행동에만 적용/만료됨; 다음 행동·다음 달·지속 효과 없음',
  ],
  ['JOCKEY_RELATION', /호흡도|기수 능력/, '기수 능력/호흡도 변경 효과 타입 없음'],
  [
    'INJURY_CHANGE',
    /부상 확률|부상 심각도|중상으로|경상으로/,
    '이벤트의 부상 확률/심각도 변경 효과 타입 없음',
  ],
  ['RACE_MODIFIER', /경주 능력|주행 능력|승률/, '이벤트의 레이스 성능 보정 효과 타입 없음'],
]

function summary(issues: InspectionIssue[], rows: number, events: EventDefinition[] = []) {
  const affectedRows = (kind: InspectionIssue['kind']) =>
    new Set(
      issues
        .filter(
          (issue) => issue.kind === kind && (issue.row !== undefined || issue.id !== undefined),
        )
        .map((issue) => issue.row ?? issue.id),
    ).size
  return {
    rows,
    errors: issues.filter((issue) => issue.kind === 'error').length,
    unmapped: issues.filter((issue) => issue.kind === 'unmapped').length,
    engineGaps: issues.filter((issue) => issue.kind === 'engine_gap').length,
    reviews: issues.filter((issue) => issue.kind === 'review').length,
    unmappedRows: affectedRows('unmapped'),
    engineGapRows: affectedRows('engine_gap'),
    enabled: events.filter((event) => event.enabled).length,
    categories: Object.fromEntries(
      [...new Set(events.map((event) => event.category))].map((category) => [
        category,
        events.filter((event) => event.category === category).length,
      ]),
    ),
  }
}

/** Validate ranges as well as shape; AND-ed ranges must have a nonempty intersection. */
function inspectConditions(
  conditions: EventCondition[],
  add: (code: string, path: string, detail: string) => void,
  path: string,
) {
  const ranges = new Map<string, { min: number; max: number }>()
  for (const [index, condition] of conditions.entries()) {
    if (condition.type !== 'value_range' && condition.type !== 'turn_range') {
      continue
    }
    if (condition.min === undefined && condition.max === undefined) {
      add('EMPTY_RANGE', `${path}.${index}`, '범위 조건에 min/max가 없음')
    }
    const key = condition.type === 'turn_range' ? 'turn' : condition.key
    const previous = ranges.get(key) ?? { min: -Infinity, max: Infinity }
    const range = {
      min: Math.max(previous.min, condition.min ?? -Infinity),
      max: Math.min(previous.max, condition.max ?? Infinity),
    }
    if (range.min > range.max) {
      add('CONTRADICTORY_RANGE', `${path}.${index}`, 'min/max 또는 같은 값의 AND 범위가 충돌함')
    }
    ranges.set(key, range)
  }
}

function semanticIssues(
  event: Pick<EventDefinition, 'id' | 'timing' | 'conditions' | 'choices'>,
): InspectionIssue[] {
  const issues: InspectionIssue[] = []
  const add = (code: string, path: string, detail: string) =>
    issues.push({ kind: 'error' as const, code, path, detail, id: event.id })
  inspectConditions(event.conditions, add, 'conditions')
  for (const [index, choice] of event.choices.entries()) {
    const path = `choices.${index}`
    inspectConditions([...event.conditions, ...choice.conditions], add, `${path}.conditions`)
  }
  for (const issue of effectSemanticIssues(event)) {
    add(issue.code, issue.path, issue.detail)
  }
  return issues
}

/** General structured-catalog diagnostics never change or import the supplied definitions. */
export function inspectEventCatalog(value: unknown) {
  const parsed = catalogSchema.safeParse(value)
  const issues: InspectionIssue[] = []
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        kind: 'error',
        code: effectSemanticCodes.includes(issue.message) ? issue.message : 'SCHEMA',
        path: issue.path.join('.'),
        detail: issue.message,
      })
    }
  }
  const raw = object(value) && Array.isArray(value.events) ? value.events : []
  const ids = new Set<string>()
  for (const [index, row] of raw.entries()) {
    if (!object(row)) {
      continue
    }
    const checkTypes = (
      values: unknown,
      supported: readonly string[],
      code: string,
      path: string,
    ) => {
      if (!Array.isArray(values)) {
        return
      }
      values.forEach((item, ordinal) => {
        if (object(item) && typeof item.type === 'string' && !supported.includes(item.type)) {
          issues.push({
            kind: 'engine_gap',
            code,
            path: `${path}.${ordinal}.type`,
            detail: `지원하지 않는 타입: ${item.type}`,
            ...(typeof row.id === 'string' ? { id: row.id } : {}),
          })
        }
      })
    }
    const conditionTypes = [
      'aptitude_any',
      'growth_is',
      'health_is',
      'record_range',
      'stat_summary',
      'always',
      'healthy',
      'training_available',
      'action_is',
      'value_range',
      'turn_range',
    ]
    checkTypes(row.conditions, conditionTypes, 'CONDITION_TYPE', `events.${index}.conditions`)
    if (Array.isArray(row.choices)) {
      row.choices.forEach((choice, choiceIndex) => {
        if (!object(choice)) {
          return
        }
        checkTypes(
          choice.conditions,
          conditionTypes,
          'CONDITION_TYPE',
          `events.${index}.choices.${choiceIndex}.conditions`,
        )
        checkTypes(
          choice.effects,
          ['value_delta', 'action_modifier', 'resolved_growth_bonus'],
          'EFFECT_TYPE',
          `events.${index}.choices.${choiceIndex}.effects`,
        )
      })
    }
    if (typeof row.id === 'string') {
      if (ids.has(row.id)) {
        issues.push({
          kind: 'error',
          code: 'DUPLICATE_ID',
          path: `events.${index}.id`,
          detail: '중복 이벤트 ID',
          id: row.id,
        })
      }
      ids.add(row.id)
    }
    const event = eventSchema.safeParse(row)
    if (event.success) {
      issues.push(...semanticIssues(event.data))
      const { revision, ...definition } = event.data
      if (digest(definition) !== revision) {
        issues.push({
          kind: 'error',
          code: 'REVISION',
          path: `events.${index}.revision`,
          detail: 'revision 체크섬 불일치',
          id: event.data.id,
        })
      }
    }
  }
  return {
    inspectionVersion: 'event-preflight-v1' as const,
    summary: summary(issues, raw.length, parsed.success ? parsed.data.events : []),
    issues,
  }
}

/** Inspect condition and effect grammar independently, then emit non-executable hold records only. */
export function preflightEventDrafts(value: unknown, protectedIds: readonly string[] = []) {
  const issues: InspectionIssue[] = []
  const events: EventDefinition[] = []
  const rows = object(value) && Array.isArray(value.rows) ? value.rows : null
  if (!rows || !rows.length) {
    issues.push({
      kind: 'error',
      code: 'SOURCE_ROWS',
      path: 'rows',
      detail: '비어 있지 않은 rows 배열이 필요함',
    })
  }
  const ids = new Set<string>()
  const protectedSet = new Set(protectedIds)
  for (const [index, raw] of (rows ?? []).entries()) {
    const id = object(raw) && typeof raw['이벤트 ID'] === 'string' ? raw['이벤트 ID'] : undefined
    const rowIssues: InspectionIssue[] = []
    const add = (kind: InspectionIssue['kind'], code: string, path: string, detail: string) =>
      rowIssues.push({ kind, code, path, detail, row: index + 1, ...(id ? { id } : {}) })
    if (!object(raw)) {
      add('error', 'SOURCE_ROW', `rows.${index}`, '항목은 객체여야 함')
      issues.push(...rowIssues)
      continue
    }
    for (const field of sourceFields) {
      if (typeof raw[field] !== 'string' || !raw[field].trim()) {
        add('error', 'REQUIRED_FIELD', field, '필수 필드가 없거나 비어 있거나 문자열이 아님')
      }
    }
    const row = Object.fromEntries(
      sourceFields.map((field) => [field, typeof raw[field] === 'string' ? raw[field] : '']),
    ) as Record<string, string>
    const category = lookup(categories, row['대분류'])
    const timing = lookup(timings, row['발동시점'])
    if (!category) {
      add('error', 'CATEGORY', '대분류', '지원하지 않는 카테고리')
    }
    if (!timing) {
      add('error', 'TIMING', '발동시점', '알 수 없는 발동 시점')
    }
    if (!lookup(introductions, row['도입']) || row['도입'] !== '보류') {
      add('error', 'HOLD_REQUIRED', '도입', '신규 가져오기는 보류 항목만 허용함')
    }
    if (id && (ids.has(id) || protectedSet.has(id))) {
      add('error', 'DUPLICATE_ID', '이벤트 ID', '중복 ID 또는 기존 카탈로그와 충돌')
    }
    if (id) {
      ids.add(id)
    }
    if (category === 'common') {
      add('error', 'COMMON_PROTECTED', '대분류', '공통 350개는 이 가져오기에서 변경하지 않음')
    }
    if (category && !new RegExp(`^${eventIdPrefixes[category]}-\\d{4}$`).test(row['이벤트 ID'])) {
      add('error', 'ID_CATEGORY', '이벤트 ID', 'ID 형식/접두사와 카테고리 불일치')
    }
    if (!subtypes.includes(row['세부유형'])) {
      add('unmapped', 'SUBTYPE', '세부유형', '세부유형 실행 문법 검토 필요')
    }
    const markers = [...row['선택·효과'].matchAll(/(?:^|\/\s*)([A-Z]):/g)].map((match) => match[1])
    if (
      markers.length &&
      (markers.join(',') !== 'A,B' || !/^A:\s*\S.*?\s*\/\s*B:\s*\S.*$/s.test(row['선택·효과']))
    ) {
      add('error', 'CHOICE_LAYOUT', '선택·효과', 'A/B 선택지 누락·중복·초과')
    }
    if (raw.description !== undefined && typeof raw.description !== 'string') {
      add('error', 'DESCRIPTION', 'description', 'description은 문자열이어야 함')
    }
    const description =
      typeof raw.description === 'string' && raw.description.trim() ? raw.description : null
    if (description === null) {
      add(
        'review',
        'NARRATIVE_NOT_FETCHED',
        'description',
        '고정 서술이 입력에 없음; 본문 내용/효과와의 일치 검증은 미수행',
      )
    }
    if (category === 'hidden') {
      add(
        'review',
        'HIDDEN_DISCLOSURE',
        '대분류',
        '히든 공개 힌트/카탈로그 노출 정책 미확정. 비활성 카탈로그 조회와 게임 활성화는 별개임',
      )
    }
    let nativeConditionMapped = false
    try {
      z.array(conditionSchema).parse(conditionsFor(row))
      nativeConditionMapped = true
    } catch {
      // The independent grammar check below records the exact failure.
    }
    for (const [field, tags] of [
      ['등장조건', conditionGaps],
      ['선택·효과', effectGaps],
    ] as const) {
      if (field === '등장조건' && nativeConditionMapped) {
        continue
      }
      for (const [code, pattern, detail] of tags) {
        if (pattern.test(row[field])) {
          add(
            'engine_gap',
            `${field === '등장조건' ? 'CONDITION' : 'EFFECT'}_${code}`,
            field,
            detail,
          )
        }
      }
    }
    if (timing === 'before_race' || timing === 'after_race') {
      add(
        'engine_gap',
        'RACE_TIMING',
        '발동시점',
        '스키마에는 있으나 월간 서버 director가 경주 시점 이벤트를 실행하지 않음',
      )
    }
    let mappedConditions: EventCondition[] | undefined
    let mappedChoices: EventChoice[] | undefined
    for (const [field, mapper] of [
      [
        '등장조건',
        () => {
          mappedConditions = z.array(conditionSchema).parse(conditionsFor(row))
        },
      ],
      [
        '선택·효과',
        () => {
          const result = choicesFor(row)
          result.choices.forEach((choice) => {
            z.array(conditionSchema).parse(choice.conditions)
            z.array(effectSchema).parse(choice.effects)
          })
          mappedChoices = result.choices
        },
      ],
    ] as const) {
      try {
        mapper()
      } catch (error) {
        add(
          error instanceof z.ZodError ? 'error' : 'unmapped',
          field === '등장조건' ? 'CONDITION_GRAMMAR' : 'EFFECT_GRAMMAR',
          field,
          error instanceof Error ? error.message : '지원하지 않는 문법',
        )
      }
    }
    if (mappedConditions && mappedChoices && category && timing) {
      // This candidate is diagnostic only; no mapped rule/effect is placed in the draft packet.
      const candidate = {
        id: row['이벤트 ID'],
        timing,
        conditions: mappedConditions,
        choices: mappedChoices,
      }
      for (const issue of semanticIssues(candidate)) {
        add('engine_gap', issue.code, issue.path, issue.detail)
      }
    }
    if (rowIssues.every((issue) => issue.kind !== 'error') && category && timing) {
      const definition: Omit<EventDefinition, 'revision'> = {
        id: row['이벤트 ID'],
        name: row['이벤트명'],
        category,
        subtype: row['세부유형'],
        introduction: 'hold',
        timing,
        status: rowIssues.some((issue) => issue.kind === 'unmapped' || issue.kind === 'engine_gap')
          ? 'needs_mapping'
          : 'deferred',
        enabled: false,
        automatic: false,
        weight: 1,
        balanceVersion: DRAFT_BALANCE_VERSION,
        description,
        conditions: [],
        choices: [],
        source: { url: null, conditionText: row['등장조건'], effectText: row['선택·효과'] },
        mappingNotes: [
          '비활성 콘텐츠 검토용. 실행 조건·효과를 적용하지 않음.',
          ...rowIssues.map((issue) => `${issue.code}: ${issue.detail}`),
        ],
      }
      const event = eventSchema.safeParse({ ...definition, revision: digest(definition) })
      if (event.success) {
        events.push(event.data)
      } else {
        event.error.issues.forEach((issue) =>
          add('error', 'SCHEMA', issue.path.join('.'), issue.message),
        )
      }
    }
    issues.push(...rowIssues)
  }
  let catalog: DraftCatalog | null = null
  if (events.length && !issues.some((issue) => issue.kind === 'error')) {
    catalog = draftCatalogSchema.parse({
      schemaVersion: 1,
      importMode: 'drafts',
      sourceDigest: draftSourceDigest(events),
      events: [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    })
  }
  return {
    report: {
      inspectionVersion: 'event-preflight-v1' as const,
      sourceDigest: catalog?.sourceDigest ?? null,
      summary: {
        ...summary(issues, rows?.length ?? 0, events),
        staged: catalog?.events.length ?? 0,
        enabled: 0,
      },
      issues,
    },
    catalog,
  }
}

export function readDraftSource(text: string, format: 'json' | 'csv') {
  return format === 'csv'
    ? {
        rows: parse(text, {
          columns: true,
          bom: true,
          skip_empty_lines: true,
          relax_column_count: false,
        }),
      }
    : (JSON.parse(text) as unknown)
}
