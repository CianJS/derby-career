import type { Database, Query } from '../db'
import type { EventCategory, EventDefinition } from '../../../../packages/shared/src/events'
import { publicEventDefinition, isEventReviewed } from '../../../../packages/shared/src/events'
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
    const filters = ['true']
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
        (await tx.query(`SELECT count(*) AS count FROM event_definitions e WHERE ${where}`, values))
          .rows[0].count,
      )
      const sort = query.sort === 'name' ? 'e.name COLLATE "C",e.id' : 'e.id'
      const direction = query.order === 'desc' ? 'DESC' : 'ASC'
      const order =
        query.sort === 'name'
          ? `e.name COLLATE "C" ${direction},e.id ${direction}`
          : `${sort} ${direction}`
      const rows = await tx.query(
        `SELECT r.definition FROM event_definitions e JOIN event_revisions r ON r.event_id=e.id AND r.revision=e.current_revision WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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
        'SELECT r.definition FROM event_definitions e JOIN event_revisions r ON r.event_id=e.id AND r.revision=e.current_revision WHERE e.id=$1',
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
