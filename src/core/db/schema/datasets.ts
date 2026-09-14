import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { connections } from './connections'
import { projects } from './projects'

/**
 * Landing zone for pulled data.
 *
 * Payloads are stored raw as JSONB rather than normalised per provider. That
 * keeps ingestion decoupled from analysis: every connector writes the same
 * shape, and the reporting layer can reshape later without one migration per
 * provider. Postgres JSONB is indexable, so filters on payload fields stay
 * usable until volume justifies materialised tables.
 */
export const datasets = pgTable(
  'datasets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id').notNull(),
    endpointId: text('endpoint_id').notNull(),
    name: text('name').notNull(),
    /** The request that produced this dataset, replayed verbatim on re-sync. */
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    /** Field list inferred from the last sync, powering the schema preview in the UI. */
    fieldHints: jsonb('field_hints')
      .$type<Array<{ path: string; type: string; sample?: unknown }>>()
      .notNull()
      .default([]),
    recordCount: bigint('record_count', { mode: 'number' }).notNull().default(0),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncStatus: text('last_sync_status').$type<'ok' | 'failed' | 'running'>(),
    lastSyncMessage: text('last_sync_message'),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('datasets_unique').on(t.projectId, t.connectionId, t.endpointId, t.name)],
)

export const datasetRecords = pgTable(
  'dataset_records',
  {
    id: text('id').primaryKey(),
    datasetId: text('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Provider-side primary key, used to upsert instead of duplicating on re-sync. */
    externalId: text('external_id').notNull(),
    payload: jsonb('payload').notNull(),
    /** Business date of the row when the endpoint is a time series (reports). */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('dataset_records_unique').on(t.datasetId, t.externalId),
    index('dataset_records_occurred_idx').on(t.datasetId, t.occurredAt),
  ],
)
