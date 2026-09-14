import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { projects } from './projects'

/** Append-only trail for membership and credential changes. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_project_idx').on(t.projectId, t.createdAt)],
)
