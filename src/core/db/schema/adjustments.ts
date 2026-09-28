import { bigint, date, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { projects } from './projects'

/** The overview figures an adjustment may move (see modules/overview/data/adjustments.ts). */
export type AdjustmentMetric = 'sapoRevenue' | 'shopSales' | 'adsCost' | 'adsRevenue'

/**
 * How `amount` is spread over its days: 'total' is the whole period's, split
 * evenly across its days; 'daily' is added on each of them.
 */
export type AdjustmentSpread = 'total' | 'daily'

/**
 * An amount a platform Administrator adds to (or, negative, takes off) one of
 * a project's overview figures over a span of days — revenue from a source
 * the connectors do not read, say. The dashboard shows the figure with it
 * folded in; nothing on the page marks it apart.
 */
export const metricAdjustments = pgTable(
  'metric_adjustments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    metric: text('metric').$type<AdjustmentMetric>().notNull(),
    /** In the source's currency (đồng), signed. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    spread: text('spread').$type<AdjustmentSpread>().notNull().default('total'),
    /** Vietnam-time days, inclusive. */
    startOn: date('start_on', { mode: 'string' }).notNull(),
    endOn: date('end_on', { mode: 'string' }).notNull(),
    note: text('note'),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('metric_adjustments_project_idx').on(t.projectId, t.startOn)],
)
