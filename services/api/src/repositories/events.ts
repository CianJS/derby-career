import type { Database, Query } from '../db'
import type { EventCategory, EventDefinition } from '../../../../packages/shared/src/events'
import { publicEventDefinition, isEventReviewed } from '../../../../packages/shared/src/events'

// This boundary applies before user filters and pagination, including direct ID lookups.
const publicFilter = `e.enabled AND e.status='ready' AND e.category<>'hidden'
  AND r.definition->>'enabled'='true' AND r.definition->>'status'='ready'
  AND r.definition->>'category'<>'hidden'
  AND ((NOT (r.definition ? 'review') AND e.category='common'
    AND e.id !~ '^(GEN|SPC|ACC|HID)-' AND r.definition->>'introduction'='candidate')
    OR (r.definition->'review'->>'converted'='true'
      AND r.definition->'review'->>'executable'='true'
      AND r.definition->'review'->>'contentReviewed'='true'
      AND r.definition->'review'->>'balanceReviewed'='true'))`
const currentDefinition =
  'event_definitions e JOIN event_revisions r ON r.event_id=e.id AND r.revision=e.current_revision'
export type EventQuery = {
  page: number
  pageSize: number
  sort: 'id' | 'name'
  order: 'asc' | 'desc'
  category?: EventCategory
  enabled?: boolean
  status?: EventDefinition['status']
}
export class EventRepository {
  constructor(private db: Database) {}
  async list(query: EventQuery) {
    const values: unknown[] = []
    const filters = [publicFilter]
    for (const key of ['category', 'enabled', 'status'] as const) {
      if (query[key] !== undefined) {
        values.push(query[key])
        filters.push(`e.${key}=$${values.length}`)
      }
    }
    const where = filters.join(' AND ')
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const total = Number(
        (
          await tx.query(
            `SELECT count(*) AS count FROM ${currentDefinition} WHERE ${where}`,
            values,
          )
        ).rows[0].count,
      )
      const sort = query.sort === 'name' ? 'e.name COLLATE "C",e.id' : 'e.id'
      const direction = query.order === 'desc' ? 'DESC' : 'ASC'
      const order =
        query.sort === 'name'
          ? `e.name COLLATE "C" ${direction},e.id ${direction}`
          : `${sort} ${direction}`
      const rows = await tx.query(
        `SELECT r.definition FROM ${currentDefinition} WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      )
      return {
        data: rows.rows.map((x) => publicEventDefinition(x.definition as EventDefinition)),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      }
    })
  }
  async get(id: string): Promise<EventDefinition | undefined> {
    const event = (
      await this.db.query(
        `SELECT r.definition FROM ${currentDefinition} WHERE ${publicFilter} AND e.id=$1`,
        [id],
      )
    ).rows[0]?.definition as EventDefinition | undefined
    return event ? publicEventDefinition(event) : undefined
  }
  static async pool(tx: Query): Promise<EventDefinition[]> {
    return (
      await tx.query(
        "SELECT r.definition FROM event_definitions e JOIN event_revisions r ON r.event_id=e.id AND r.revision=e.current_revision WHERE e.enabled AND e.status='ready' ORDER BY e.id",
      )
    ).rows
      .map((x) => x.definition as EventDefinition)
      .filter((event) => event.enabled && isEventReviewed(event))
  }
}
