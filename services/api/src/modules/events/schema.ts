import { z } from 'zod'
import { eventCategories, eventTimings } from '../../../../../packages/shared/src/events'
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
    mappingNotes: z.array(z.string()),
  })
  .strict()
  .superRefine((e, c) => {
    if (new Set(e.choices.map((x) => x.id)).size !== e.choices.length) {
      c.addIssue({ code: 'custom', message: 'Duplicate choice ID' })
    }
    if (
      e.enabled &&
      (e.status !== 'ready' || !e.choices.length || e.introduction !== 'candidate')
    ) {
      c.addIssue({ code: 'custom', message: 'Only mapped candidates can be enabled' })
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
    version: z.literal('event-director-v1'),
    monthlyProbability: z.number().min(0).max(1),
    pityAfterMisses: z.number().int().min(1).max(100),
    monthStartShare: z.number().min(0).max(1),
  })
  .strict()
