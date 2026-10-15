import { z } from 'zod'
import type { EventDefinition } from '../../../../../packages/shared/src/events'
import { eventSchema } from './schema'
import { digest } from '../../services/identity'

export const DRAFT_BALANCE_VERSION = 'notion-draft-review-v1'
export const eventIdPrefixes = {
  common: 'COM',
  normal: 'GEN',
  special: 'SPC',
  accident: 'ACC',
  hidden: 'HID',
} as const

export function isQuarantinedEvent(value: unknown): boolean {
  const parsed = eventSchema.safeParse(value)
  if (!parsed.success) {
    return false
  }
  const event = parsed.data
  return (
    event.category !== 'common' &&
    new RegExp(`^${eventIdPrefixes[event.category]}-\\d{4}$`).test(event.id) &&
    event.introduction === 'hold' &&
    !event.enabled &&
    event.status !== 'ready' &&
    event.balanceVersion === DRAFT_BALANCE_VERSION &&
    !event.automatic &&
    !event.conditions.length &&
    !event.choices.length &&
    event.source.url === null &&
    event.source.body === undefined
  )
}

/** Only game properties contribute; private page URLs/body and row ordering do not. */
export function draftSourceDigest(events: EventDefinition[]) {
  return digest(
    [...events]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((event) => ({
        id: event.id,
        name: event.name,
        category: event.category,
        subtype: event.subtype,
        introduction: event.introduction,
        timing: event.timing,
        description: event.description,
        conditionText: event.source.conditionText,
        effectText: event.source.effectText,
      })),
  )
}

export const draftCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    importMode: z.literal('drafts'),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    events: z.array(eventSchema).min(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (new Set(catalog.events.map((event) => event.id)).size !== catalog.events.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate draft IDs' })
    }
    for (const [index, event] of catalog.events.entries()) {
      if (!isQuarantinedEvent(event)) {
        context.addIssue({
          code: 'custom',
          path: ['events', index],
          message: 'Drafts must be quarantined, non-common and contain no executable mapping',
        })
      }
    }
    if (draftSourceDigest(catalog.events) !== catalog.sourceDigest) {
      context.addIssue({
        code: 'custom',
        path: ['sourceDigest'],
        message: 'Draft source checksum mismatch',
      })
    }
  })
export type DraftCatalog = z.infer<typeof draftCatalogSchema>
