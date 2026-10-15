import { z } from 'zod'
import { eventCategories, eventTimings } from '../../../../../packages/shared/src/events'
import { effectSemanticIssues, unreachableTrainingResult } from './semantics'
const stat = z.enum(['speed', 'stamina', 'power', 'guts', 'intelligence'])
const choice = z.enum(['speed', 'stamina', 'power', 'guts', 'intelligence', 'rest', 'treatment'])
const valueKey = z.enum([
  'speed',
  'stamina',
  'power',
  'guts',
  'intelligence',
  'fatigue',
  'bodyLoad',
])
export const conditionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('aptitude_any'),
      names: z.array(z.string()).min(1),
      grades: z.array(z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).min(1),
    })
    .strict(),
  z.object({ type: z.literal('growth_is'), growth: z.enum(['조숙', '표준', '만성']) }).strict(),
  z
    .object({
      type: z.literal('health_is'),
      health: z.array(z.enum(['정상', '경상', '중등도 부상', '중상'])).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('record_range'),
      metric: z.enum(['starts', 'wins']),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('stat_summary'),
      metric: z.enum(['spread', 'count']),
      threshold: z.number().int().min(0).max(1000).optional(),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ type: z.literal('always') }).strict(),
  z.object({ type: z.literal('healthy') }).strict(),
  z.object({ type: z.literal('training_available'), stat }).strict(),
  z.object({ type: z.literal('action_is'), choices: z.array(choice).min(1) }).strict(),
  z
    .object({
      type: z.literal('value_range'),
      key: valueKey,
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('turn_range'),
      min: z.number().int().positive().optional(),
      max: z.number().int().positive().optional(),
    })
    .strict(),
])
export const effectSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('value_delta'),
      key: valueKey,
      amount: z.number().int().min(-1000).max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal('action_modifier'),
      action: z.enum(['training', 'rest', 'treatment']),
      training: stat.optional(),
      field: z.enum(['primaryGain', 'secondaryGain', 'fatigue', 'bodyLoad']),
      operation: z.enum(['add', 'multiply']),
      value: z.number().finite().min(-1000).max(1000),
    })
    .strict()
    .superRefine((v, c) => {
      if ((v.field.endsWith('Gain') || v.training) && v.action !== 'training') {
        c.addIssue({ code: 'custom', message: 'Growth modifiers require training' })
      }
      if (v.operation === 'multiply' && v.value < 0) {
        c.addIssue({ code: 'custom', message: 'Negative multiplier' })
      }
    }),
  z
    .object({ type: z.literal('resolved_growth_bonus'), stat, ratio: z.number().min(0).max(2) })
    .strict(),
])
export const eventSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(300),
    category: z.enum(eventCategories),
    subtype: z.string(),
    introduction: z.enum(['candidate', 'followup', 'hold']),
    timing: z.enum(eventTimings),
    status: z.enum(['ready', 'needs_mapping', 'deferred']),
    enabled: z.boolean(),
    weight: z.number().positive().max(100000),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    balanceVersion: z.string(),
    description: z.string().nullable(),
    conditions: z.array(conditionSchema),
    choices: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string(),
            conditions: z.array(conditionSchema),
            effects: z.array(effectSchema),
            risk: z
              .object({
                version: z.literal('event-risk-v1'),
                outcomes: z
                  .object({
                    great_success: z.array(effectSchema),
                    success: z.array(effectSchema),
                    failure: z.array(effectSchema),
                    disaster: z.array(effectSchema),
                  })
                  .strict(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(2),
    automatic: z.boolean(),
    source: z
      .object({
        url: z.string().url().nullable(),
        conditionText: z.string(),
        effectText: z.string(),
        body: z.string().optional(),
      })
      .strict(),
    review: z
      .object({
        sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
        converted: z.boolean(),
        executable: z.boolean(),
        contentReviewed: z.boolean(),
        balanceReviewed: z.boolean(),
        groupId: z.string().nullable(),
        representativeId: z.string().nullable(),
      })
      .strict()
      .optional(),
    mappingNotes: z.array(z.string()),
  })
  .strict()
  .superRefine((e, c) => {
    for (const issue of effectSemanticIssues(e)) {
      c.addIssue({ code: 'custom', path: issue.path.split('.'), message: issue.code })
    }
    if ((e.enabled || e.review?.executable) && unreachableTrainingResult(e)) {
      c.addIssue({ code: 'custom', message: 'UNREACHABLE_TRAINING_RESULT' })
    }
    for (const condition of [
      ...e.conditions,
      ...e.choices.flatMap((choice) => choice.conditions),
    ]) {
      if (
        'min' in condition &&
        'max' in condition &&
        condition.min !== undefined &&
        condition.max !== undefined &&
        condition.min > condition.max
      ) {
        c.addIssue({ code: 'custom', message: 'Reversed condition range' })
      }
      if (
        condition.type === 'stat_summary' &&
        condition.metric === 'count' &&
        (condition.threshold === undefined || (condition.min ?? 0) > 5 || (condition.max ?? 0) > 5)
      ) {
        c.addIssue({
          code: 'custom',
          message: 'Stat count needs a threshold and range within five stats',
        })
      }
    }
    if (new Set(e.choices.map((x) => x.id)).size !== e.choices.length) {
      c.addIssue({ code: 'custom', message: 'Duplicate choice ID' })
    }
    if (
      e.enabled &&
      (e.status !== 'ready' ||
        !e.choices.length ||
        (e.review
          ? !(
              e.review.converted &&
              e.review.executable &&
              e.review.contentReviewed &&
              e.review.balanceReviewed
            )
          : e.category !== 'common' ||
            /^(GEN|SPC|ACC|HID)-/.test(e.id) ||
            e.introduction !== 'candidate'))
    ) {
      c.addIssue({ code: 'custom', message: 'Only mapped candidates can be enabled' })
    }
    if (
      e.category === 'hidden' &&
      e.enabled &&
      e.conditions.filter((c) => c.type !== 'always').length < 2
    ) {
      c.addIssue({ code: 'custom', message: 'Hidden events require explicit compound conditions' })
    }
    if (e.choices.some((choice) => choice.risk && (choice.effects.length || e.automatic))) {
      c.addIssue({
        code: 'custom',
        message: 'Risk requires explicit player choice and four exclusive outcome effects',
      })
    }
    if (e.automatic && e.choices.length !== 1) {
      c.addIssue({ code: 'custom', message: 'Automatic events need one choice' })
    }
  })
export const catalogSchema = z
  .object({ schemaVersion: z.literal(1), events: z.array(eventSchema) })
  .strict()
export const directorConfigSchema = z
  .object({
    version: z.enum(['event-director-v1', 'event-director-v2']),
    monthlyProbability: z.number().min(0).max(1),
    pityAfterMisses: z.number().int().min(1).max(100),
    monthStartShare: z.number().min(0).max(1),
  })
  .strict()
