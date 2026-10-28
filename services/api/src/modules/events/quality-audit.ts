import { z } from 'zod'
import { digest } from '../../services/identity'
import { eventSchema } from './schema'
import { effectSemanticIssues, unreachableTrainingResult } from './semantics'
import { drawEvent, planDraw } from './director'
import { resolveEventChoice } from './risk'
import { applyImmediateEffects, modifyActionDeltas } from './resolver'
import { serverEventChoiceAvailability } from '../../../../../packages/shared/src/event-availability'
import {
  startCareer,
  horses,
  commitAction,
  resolveAction,
  careerProgress,
  statKeys,
  BALANCE,
  hashSeed,
  type Career,
  type Choice,
} from '../../../../../packages/shared/src/domain'
import {
  DEFAULT_DIRECTOR_CONFIG,
  CATEGORY_WEIGHTS,
  RISK_WEIGHTS,
  type EventDefinition,
  type EventEffect,
} from '../../../../../packages/shared/src/events'
import { EVENT_FIXTURES } from '../../../../../lib/career/events/fixtures'
import { drawMonthStartEvent, drawResultEvent } from '../../../../../lib/career/events/director'
import type { EventContext } from '../../../../../packages/shared/src/event-availability'

type SourceRow = Record<string, string>
export type QualityInput = {
  common: EventDefinition[]
  expansion: EventDefinition[]
  source: { rows: SourceRow[] }
  legacySource: { rows: SourceRow[] }
}
const findingSchema = z
  .object({
    priority: z.enum(['A', 'B', 'C']),
    code: z.string(),
    evidence: z.string(),
    confidence: z.enum(['confirmed', 'manual_review']),
  })
  .strict()
type Finding = z.infer<typeof findingSchema>
const changeSchema = z
  .object({
    path: z.string(),
    before: z.number(),
    after: z.number(),
    rationale: z.string(),
    impact: z.string(),
  })
  .strict()
const textSchema = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    timing: z.string(),
    weight: z.number(),
    conditions: z.array(z.unknown()),
    choices: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          conditions: z.array(z.unknown()),
          effects: z.array(z.unknown()),
          risk: z.unknown().optional(),
        })
        .strict(),
    ),
  })
  .strict()
const rowSchema = z
  .object({
    id: z.string(),
    basedOnRevision: z.string().regex(/^[a-f0-9]{64}$/),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['hold', 'review_only']),
    enabled: z.literal(false),
    executable: z.literal(false),
    manualStoryReview: z.literal('pending'),
    findings: z.array(findingSchema),
    before: textSchema,
    after: textSchema,
    numericChanges: z.array(changeSchema),
    balanceImpact: z.string(),
    storyReviewTask: z.string(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export const reviewPacketSchema = z
  .object({
    format: z.literal('event-v2-review-only'),
    applicationAllowed: z.literal(false),
    basedOn: z.string().regex(/^[a-f0-9]{64}$/),
    rows: z.array(rowSchema),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((p, c) => {
    const { revision, ...body } = p
    if (digest(body) !== revision) {
      c.addIssue({ code: 'custom', message: 'Packet digest mismatch' })
    }
    if (new Set(p.rows.map((r) => r.id)).size !== p.rows.length) {
      c.addIssue({ code: 'custom', message: 'Duplicate ID' })
    }
    for (const r of p.rows) {
      const { revision, ...body } = r
      if (digest(body) !== revision) {
        c.addIssue({ code: 'custom', message: 'Row digest mismatch: ' + r.id })
      }
    }
  })
// Concrete story candidates remain unapproved prose, separate from executable definitions.
const STORY_CANDIDATES: Record<string, string> = {
  'COM-0001':
    '새벽 주로가 비어 있습니다. 조교사는 직선 구간에서 속도를 높이는 연습을 제안합니다. 속도 훈련을 선택하면 추가 성장과 함께 피로도 늘어납니다. 다른 행동을 하면 이번 기회는 지나갑니다.',
  'COM-0002':
    '조교사가 오르막 구간의 사용 시간을 확보했습니다. 파워 훈련을 하면 뒷다리를 집중적으로 단련할 수 있지만 신체 부하도 커집니다. 몸 상태를 살핀 뒤 이번 달 행동을 결정합니다.',
  'COM-0003':
    '일정한 호흡을 유지하며 길게 달릴 수 있는 시간이 생겼습니다. 지구력 훈련을 선택하면 성장 보너스를 얻고 피로가 추가됩니다. 쉬어야 하는 달이라면 조교를 강행하지 않습니다.',
  'COM-0005':
    '조교사가 지난 주로 움직임을 기록한 노트를 펼칩니다. 지능 훈련을 선택하면 전개를 복기하며 성장 보너스를 얻습니다. 짧은 수업에도 추가 피로가 있어 상태를 확인합니다.',
  'COM-0031':
    '마방을 정리하던 중 조교 노트를 발견했습니다. 두 훈련 기록 중 이번 달에 적용할 방향을 고릅니다. 선택한 능력에 맞는 행동을 해야 보너스를 받을 수 있으므로 적용 대상을 확인합니다.',
  'COM-0034':
    '일과가 일찍 끝났습니다. 지금 말을 쉬게 해 피로를 덜어 줄지, 이번 달 훈련의 부담을 줄이는 데 여유 시간을 쓸지 결정합니다. 즉시 회복과 훈련 시 비용 감소는 적용 시점이 다릅니다.',
  'COM-0063':
    '익숙한 발소리에 말이 안정을 찾습니다. 이번 달 훈련의 부담을 줄이는 쪽과 지금 피로를 덜어 주는 쪽 중에서 계획에 맞게 고릅니다. 같은 수치라도 적용 시점은 다를 수 있습니다.',
}
const DESIGN_CANDIDATES: Record<
  string,
  { path: string; before: number; after: number; rationale: string }[]
> = {
  'COM-0001': [
    {
      path: 'choices.0.effects.0.value',
      before: 1.45,
      after: 1.35,
      rationale:
        '집중 속도 조교의 보너스와 추가 피로를 함께 줄이는 저부담 선택안. 원본 오류 판정이 아닌 기획 대안.',
    },
    {
      path: 'choices.0.effects.1.value',
      before: 5,
      after: 3,
      rationale: '성장 배율 축소와 짝을 이루는 추가 피로 완화 후보.',
    },
  ],
  'COM-0002': [
    {
      path: 'choices.0.effects.1.value',
      before: 7,
      after: 6,
      rationale:
        '파워 기본 신체 부하 13에 사건이 7을 추가하므로 추가 부담을 1 낮추는 안. 성장 배율은 유지해 전문 조교의 구분 보존.',
    },
  ],
  'COM-0016': [
    {
      path: 'choices.0.effects.0.ratio',
      before: 0.45,
      after: 0.35,
      rationale:
        '확정 성장에 붙는 추가 보너스를 낮추는 안. 기존 0.45가 잘못됐다는 의미는 아니며 무비용 성장 누적을 완화하는 검토 후보.',
    },
  ],
}
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`
function effectText(e: EventEffect): string {
  switch (e.type) {
    case 'value_delta':
      return `${e.key} ${signed(e.amount)} (즉시)`
    case 'jockey_trust':
      return `${e.jockeyId} 신뢰도 ${signed(e.amount)} (관계별 0~100)`
    case 'resolved_growth_bonus':
      return `${e.stat} 확정 성장량의 ${e.ratio * 100}% 추가 (반올림·상한 적용)`
    case 'action_modifier':
      return `${e.training ?? e.action} ${e.field} ${e.operation === 'add' ? signed(e.value) : '×' + e.value} (이번 월 일치 행동 1회)`
  }
}
function numericReview(event: EventDefinition) {
  const changes: z.infer<typeof changeSchema>[] = []
  const choices = structuredClone(event.choices)
  const visit = (effects: EventEffect[], path: string) =>
    effects.forEach((e, i) => {
      let key: 'amount' | 'ratio' | 'value' | undefined,
        cap = 0
      if (e.type === 'value_delta') {
        key = 'amount'
        cap = statKeys.includes(e.key as (typeof statKeys)[number]) ? 20 : 15
      }
      if (e.type === 'resolved_growth_bonus') {
        key = 'ratio'
        cap = 0.5
      }
      if (e.type === 'action_modifier') {
        key = 'value'
        cap = e.operation === 'multiply' ? 1.5 : e.field.endsWith('Gain') ? 20 : 15
      }
      if (!key) {
        return
      }
      const object = e as unknown as Record<string, number | string>,
        before = object[key] as number
      if (!Number.isFinite(before) || Math.abs(before) <= cap) {
        return
      }
      const after = Math.sign(before) * cap
      object[key] = after
      changes.push({
        path: `choices.${path}.${i}.${key}`,
        before,
        after,
        rationale: `검토용 단일 효과 경고선 ${cap} 초과. 승인된 목표치 아님.`,
        impact: '단일 사건의 변동 폭 감소 후보. 선택지 간 비용·누적·상한 부근의 재평가 필요.',
      })
    })
  choices.forEach((c, i) => {
    visit(c.effects, `${i}.effects`)
    for (const [outcome, effects] of Object.entries(c.risk?.outcomes ?? {})) {
      visit(effects, `${i}.risk.outcomes.${outcome}`)
    }
  })
  for (const candidate of DESIGN_CANDIDATES[event.id] ?? []) {
    const parts = candidate.path.split('.')
    let target: unknown = { choices }
    for (const part of parts.slice(0, -1)) {
      target = (target as Record<string, unknown>)[part]
    }
    const record = target as Record<string, unknown>,
      key = parts.at(-1)!
    if (record[key] !== candidate.before) {
      throw new Error('Stale numeric design candidate: ' + event.id + ' ' + candidate.path)
    }
    record[key] = candidate.after
    changes.push({
      ...candidate,
      impact:
        '기존 Resolver의 proposedObservations와 원본 observations를 비교. 효과 단위/적용 시점은 유지하며 실제 활성 변경은 0건.',
    })
  }
  return { choices, changes }
}
function contexts() {
  const base = startCareer(horses[0].id, { starterJockeyId: 'HAN_DOYUN' })
  const rows: { label: string; context: EventContext }[] = []
  for (const turn of [1, 12, 13, 60, 61, 84]) {
    for (const health of ['정상', '경상', '중등도 부상', '중상']) {
      const career: Career = {
        ...base,
        month: turn,
        careerTurnIndex: turn,
        age: careerProgress(turn).age,
        health,
        healthRecovery: health === '정상' ? 0 : 40,
      }
      rows.push({ label: `turn:${turn}/health:${health}/start`, context: { career } })
    }
  }
  for (const choice of [...statKeys, 'rest', 'treatment'] as Choice[]) {
    const beforeAction =
      choice === 'treatment' ? { ...base, health: '경상', healthRecovery: 40 } : base
    rows.push({
      label: `result:${choice}`,
      context: { career: resolveAction(commitAction(beforeAction, choice)), choice, beforeAction },
    })
  }
  rows.push({
    label: 'stat_and_strain_bounds',
    context: {
      career: {
        ...base,
        values: {
          speed: 999,
          stamina: 1,
          power: 1000,
          guts: 0,
          intelligence: 999,
          fatigue: 85,
          bodyLoad: 80,
        },
      },
    },
  })
  return rows
}
function observations(event: EventDefinition) {
  const samples: unknown[] = []
  for (const { label, context } of contexts()) {
    for (const choice of event.choices) {
      const a = serverEventChoiceAvailability(event, choice, context)
      if (!a.available) {
        samples.push({ label, choice: choice.id, available: false, reason: a.reason })
        continue
      }
      const effects = resolveEventChoice(choice, 'event-v2-audit:' + label, event.revision).effects
      const r = applyImmediateEffects(context.career, effects)
      const action = context.career.action
      const modifiers =
        action?.result && context.beforeAction
          ? modifyActionDeltas(
              context.beforeAction,
              Object.fromEntries(action.result.map((c) => [c.key, c.after - c.before])),
              action,
              r.modifiers,
            )
          : null
      samples.push({ label, choice: choice.id, available: true, changes: r.changes, modifiers })
    }
  }
  const groups = new Map<string, { labels: string[]; observation: Record<string, unknown> }>()
  for (const sample of samples) {
    const { label, ...observation } = sample as Record<string, unknown>
    const key = digest(observation),
      prior = groups.get(key)
    if (prior) {
      prior.labels.push(String(label))
    } else {
      groups.set(key, { labels: [String(label)], observation })
    }
  }
  return { skipped: null, samples: [...groups.values()] }
}
export function distributionAudit(pool: EventDefinition[], months = 6000) {
  const base = startCareer(horses[0].id, { starterJockeyId: 'HAN_DOYUN' })
  const counts: Record<string, number> = {},
    categories: Record<string, number> = {}
  const effectDirections = { benefit: 0, cost: 0, mixed: 0, neutral: 0 },
    riskOutcomeCounts: Record<string, number> = {}
  const valueRanges: Record<string, { min: number; max: number }> = {}
  let misses = 0,
    draws = 0,
    pityMonths = 0,
    localMisses = 0,
    localDraws = 0
  const localCounts: Record<string, number> = {},
    history: { eventId: string; month: number; status: 'expired' }[] = []
  for (let i = 0; i < months; i++) {
    const turn = (i % 84) + 1,
      career = { ...base, month: turn, careerTurnIndex: turn, age: careerProgress(turn).age }
    const choice: Choice = i % 6 === 5 ? 'rest' : statKeys[i % 5]
    const after = resolveAction(commitAction(career, choice)),
      seed = `event-v2-audit:fixed-v1:${i}`
    if (misses >= DEFAULT_DIRECTOR_CONFIG.pityAfterMisses) {
      pityMonths++
    }
    const plan = planDraw(seed, misses, pool, DEFAULT_DIRECTOR_CONFIG)
    const timing = plan.deferredToResult
      ? choice === 'rest'
        ? 'rest_result'
        : 'training_result'
      : 'month_start'
    const context = plan.deferredToResult
      ? { career: after, choice, beforeAction: career }
      : { career }
    const event = plan.gatePassed
      ? drawEvent(pool, timing, context, seed, DEFAULT_DIRECTOR_CONFIG.version)
      : undefined
    if (event) {
      const available = event.choices.filter(
        (c) => serverEventChoiceAvailability(event, c, context).available,
      )
      const picked = available[hashSeed(seed + ':choice') % available.length]
      if (picked) {
        const resolved = resolveEventChoice(picked, seed, event.revision)
        if (resolved.risk) {
          riskOutcomeCounts[resolved.risk.outcome] =
            (riskOutcomeCounts[resolved.risk.outcome] ?? 0) + 1
        }
        const immediate = applyImmediateEffects(context.career, resolved.effects)
        const withEvent = plan.deferredToResult
          ? immediate.career
          : resolveAction(
              commitAction(immediate.career, choice),
              undefined,
              (deltas, action) =>
                modifyActionDeltas(immediate.career, deltas, action, immediate.modifiers).deltas,
            )
        let better = false,
          worse = false
        for (const key of [...statKeys, 'fatigue', 'bodyLoad'] as const) {
          const delta = withEvent.values[key] - after.values[key]
          const sign = key === 'fatigue' || key === 'bodyLoad' ? -delta : delta
          better ||= sign > 0
          worse ||= sign < 0
          const old = valueRanges[key]
          valueRanges[key] = {
            min: Math.min(old?.min ?? 0, delta),
            max: Math.max(old?.max ?? 0, delta),
          }
        }
        effectDirections[better ? (worse ? 'mixed' : 'benefit') : worse ? 'cost' : 'neutral']++
      }
    }
    if (event) {
      draws++
      counts[event.id] = (counts[event.id] ?? 0) + 1
      categories[event.category] = (categories[event.category] ?? 0) + 1
      misses = 0
    } else {
      misses++
    }
    const lc = {
      horseId: base.horse.id,
      month: i + 1,
      health: '정상',
      eventMisses: localMisses,
      eventLog: history.slice(-BALANCE.events.historyLimit),
    }
    const local =
      drawMonthStartEvent(lc) ??
      drawResultEvent(lc, {
        actionId: `audit-local:${i}`,
        actionType: choice === 'rest' ? 'rest' : 'training',
        trainingType: choice === 'rest' ? null : choice,
        seed: i,
      })
    if (local) {
      localDraws++
      localCounts[local.eventId] = (localCounts[local.eventId] ?? 0) + 1
      history.push({ eventId: local.eventId, month: i + 1, status: 'expired' })
      localMisses = 0
    } else {
      localMisses++
    }
  }
  return {
    seed: 'event-v2-audit:fixed-v1',
    months,
    samplingPolicy: '고정 seed로 가용 선택지 균등 선택, 5종 훈련/휴식 교대. player 최적 전략 아님.',
    effectDirections,
    valueRanges,
    riskOutcomeCounts,
    server: {
      config: DEFAULT_DIRECTOR_CONFIG,
      draws,
      pityMonths,
      eventCounts: counts,
      categoryCounts: categories,
    },
    local: { policy: BALANCE.events, draws: localDraws, eventCounts: localCounts },
    reviewTargets: {
      categoryWeights: CATEGORY_WEIGHTS,
      requestedSizeMix: { largeLoss: 15, smallLoss: 55, smallGain: 25, greatSuccess: 5 },
      existingRiskWeights: RISK_WEIGHTS,
    },
    limitations: [
      '기존 위험 확률과 손익 크기 비율은 다른 개념이다.',
      '보장 규칙 때문에 실측 등장률이 30%보다 높을 수 있다.',
      '표본 미등장은 발동 불가의 증명이 아니다.',
      '미지원 원문 조건·효과의 대체 계산 없음. 원정 상태는 이벤트 엔진에 모델링되지 않아 시뮬레이션 제외.',
    ],
  }
}
export function auditEventQuality(input: QualityInput) {
  const all = [...input.common, ...input.expansion].sort((a, b) => a.id.localeCompare(b.id, 'en'))
  if (
    input.common.length !== 350 ||
    input.expansion.length !== 650 ||
    new Set(all.map((e) => e.id)).size !== 1000
  ) {
    throw Error('Expected distinct 350 + 650 events')
  }
  const sources = new Map(input.source.rows.map((r) => [r['이벤트 ID'], r])),
    legacy = new Map(input.legacySource.rows.map((r) => [r['이벤트 ID'], r]))
  if (
    sources.size !== 1000 ||
    input.source.rows.length !== 1000 ||
    all.some((e) => !sources.has(e.id))
  ) {
    throw Error('Incomplete source coverage')
  }
  const names = new Map<string, string[]>(),
    rules = new Map<string, string[]>()
  const rule = (e: EventDefinition) =>
    digest({
      conditions: e.conditions,
      choices: e.choices.map((c) => ({
        conditions: c.conditions,
        effects: c.effects,
        risk: c.risk,
      })),
      timing: e.timing,
    })
  for (const e of all) {
    names.set(e.name, [...(names.get(e.name) ?? []), e.id])
    if (e.choices.length) {
      rules.set(rule(e), [...(rules.get(rule(e)) ?? []), e.id])
    }
  }
  const records = all.map((event) => {
    const raw = sources.get(event.id)!,
      local = EVENT_FIXTURES.find((e) => e.id === event.id),
      previous = legacy.get(event.id)
    const findings: Finding[] = []
    const add = (
      priority: Finding['priority'],
      code: string,
      evidence: string,
      confidence: Finding['confidence'] = 'confirmed',
    ) => findings.push({ priority, code, evidence, confidence })
    const parsed = eventSchema.safeParse(event),
      { revision, ...definition } = event
    if (!parsed.success) {
      add(
        'A',
        'INVALID_SCHEMA',
        parsed.error.issues.map((i) => i.path.join('.') + ':' + i.message).join('; '),
      )
    }
    if (digest(definition) !== revision) {
      add('A', 'REVISION_MISMATCH', revision)
    }
    for (const note of event.mappingNotes) {
      add('A', 'MAPPING_NOTE', note)
    }
    for (const issue of effectSemanticIssues(event)) {
      add('A', issue.code, issue.path + ': ' + issue.detail)
    }
    if (unreachableTrainingResult(event)) {
      add('A', 'UNREACHABLE_TRAINING_RESULT', '실제 canTrain 기준을 통과할 선택지 없음')
    }
    if (!event.choices.length) {
      add('A', 'NO_EXECUTABLE_CHOICE', '구조화된 선택지 없음. 원문 임의 변환 금지')
    }
    if (event.review && !event.review.executable) {
      add('A', 'ENGINE_GAP_OR_MAPPING', '현재 실행 불가; 조건·효과 승인 필요')
    }
    if (
      previous &&
      ['이벤트명', '등장조건', '선택·효과', '발동시점'].some((k) => previous[k] !== raw[k])
    ) {
      add(
        'A',
        'SOURCE_VERSION_DRIFT',
        '공통 활성 원본과 최신 확장 원본의 속성 차이. 자동 대체 금지',
      )
    }
    const numeric = numericReview(event)
    for (const c of numeric.changes) {
      add(
        'B',
        DESIGN_CANDIDATES[event.id]?.some((x) => x.path === c.path)
          ? 'BALANCE_DESIGN_CANDIDATE'
          : 'EXTREME_EFFECT',
        JSON.stringify(c),
        'manual_review',
      )
    }
    if (
      event.choices.length === 2 &&
      digest({ ...event.choices[0], id: null, label: null }) ===
        digest({ ...event.choices[1], id: null, label: null })
    ) {
      add('B', 'IDENTICAL_CHOICES', '조건·효과·위험 분기가 동일함')
    }
    if ((names.get(event.name)?.length ?? 0) > 1) {
      add('C', 'DUPLICATE_TITLE', names.get(event.name)!.join(','))
    }
    if ((rules.get(rule(event))?.length ?? 0) > 1) {
      add('C', 'REPEATED_RULES', rules.get(rule(event))!.join(','), 'manual_review')
    }
    if (!event.description?.trim()) {
      add('C', 'MISSING_STORY', '본문 부재; 제목/효과로 현실성·인과관계를 보증하지 않음')
    }
    if (!event.source.url) {
      add('C', 'SOURCE_URL_MISSING', 'source.url=null; 출처를 발명하지 않음')
    }
    if (/(?:해라|해봐|골라|가자)[.!?]?$/.test(event.description ?? '')) {
      add('C', 'REGISTER_REVIEW', '반말 후보', 'manual_review')
    }
    if (/[A-Za-z]{4,}/.test(event.description ?? '')) {
      add('C', 'FOREIGN_TEXT_REVIEW', '고유명사일 수 있어 수동 확인', 'manual_review')
    }
    if (local && local.description !== event.description) {
      add('C', 'LOCAL_SERVER_TEXT_DRIFT', `${local.description} / ${event.description}`)
    }
    if (event.choices.some((c) => !c.label.trim() || /^[AB]$/.test(c.label))) {
      add('C', 'FORMAL_CHOICE_LABEL', '행동·효과 설명이 없는 선택지')
    }
    const hold =
      event.category === 'hidden' ||
      event.status !== 'ready' ||
      (!!event.review && !event.review.executable) ||
      !parsed.success ||
      findings.some((f) => f.priority === 'A')
    const before = {
      name: event.name,
      description: event.description,
      timing: event.timing,
      weight: event.weight,
      conditions: event.conditions,
      choices: event.choices.map((c) => ({ ...c })),
    }
    const after = hold
      ? structuredClone(before)
      : {
          ...before,
          description:
            STORY_CANDIDATES[event.id] ??
            (event.description
              ? `${event.description} 적용 조건: ${event.source.conditionText}. 선택 효과와 적용 시점을 확인합니다.`
              : null),
          choices: numeric.choices.map((c) => ({
            ...c,
            label: c.risk
              ? `${c.label} (위험 분기별 수치 검토 필요)`
              : c.effects.map(effectText).join(' / ') || c.label,
            effects: c.effects,
          })),
        }
    const body = {
      id: event.id,
      basedOnRevision: event.revision,
      sourceDigest: digest(raw),
      state: hold ? ('hold' as const) : ('review_only' as const),
      enabled: false as const,
      executable: false as const,
      manualStoryReview: 'pending' as const,
      findings,
      before,
      after,
      numericChanges: hold ? [] : numeric.changes,
      balanceImpact: hold
        ? '원문/효과 설계 검토 필요. 대체 계산 없음.'
        : numeric.changes.length
          ? '단일 효과 변동 폭 축소 후보. 승인 전 실제 변경 0건.'
          : '수치 유지·조건/적용 시점 문구 후보. 실제 변경 0건.',
      storyReviewTask: `${event.name}: 현장 상황 → 선택 행동 → 실제 결과의 인과관계와 ${event.source.conditionText} 조건을 원문 담당자가 검토. ${event.category === 'hidden' ? '히든 공개/승격 금지.' : ''}`,
    }
    return {
      id: event.id,
      mode: local ? 'Local+Server' : 'Server',
      server: event,
      local: local ?? null,
      rawSource: raw,
      legacySource: previous ?? null,
      sourceDigest: digest(raw),
      localRevision: local ? digest(local) : null,
      findings,
      observations: hold
        ? { skipped: 'hold_or_unmapped_no_fallback', samples: [] }
        : observations(event),
      proposedObservations:
        !hold && numeric.changes.length
          ? observations({ ...event, choices: numeric.choices })
          : null,
      proposal: { ...body, revision: digest(body) },
    }
  })
  const basedOn = digest(input),
    body = {
      format: 'event-v2-review-only' as const,
      applicationAllowed: false as const,
      basedOn,
      rows: records.map((r) => r.proposal),
    }
  const packet = reviewPacketSchema.parse({ ...body, revision: digest(body) })
  const summary = {
    common: 350,
    expansion: 650,
    total: 1000,
    localFixtures: EVENT_FIXTURES.length,
    activeCommon: input.common.filter((e) => e.enabled).length,
    activeExpansion: input.expansion.filter((e) => e.enabled).length,
    expansionExecutable: input.expansion.filter((e) => e.review?.executable).length,
    hold: packet.rows.filter((r) => r.state === 'hold').length,
    reviewOnly: packet.rows.filter((r) => r.state === 'review_only').length,
    promotableNow: 0,
    manualStoryReviewsCompleted: 0,
    priorityCounts: Object.fromEntries(
      ['A', 'B', 'C'].map((p) => [
        p,
        records.filter((r) => r.findings.some((f) => f.priority === p)).length,
      ]),
    ),
    numericChangeCandidates: packet.rows.reduce((n, r) => n + r.numericChanges.length, 0),
  }
  return {
    report: { version: 'event-quality-audit-v2', basedOn, summary, records },
    packet,
    distribution: distributionAudit(input.common),
  }
}
