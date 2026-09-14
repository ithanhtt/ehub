import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { projects } from './projects'

export type ConnectionStatus = 'draft' | 'connected' | 'error' | 'expired'

/**
 * One configured instance of a connector plugin inside a project.
 *
 * A project can hold several instances of the same plugin (e.g. two TikTok Ads
 * advertiser accounts), which is why the unique key includes `name`.
 *
 * `credentials` is an AES-256-GCM envelope produced by core/crypto/secrets.ts.
 * It never leaves the server: API routes and server actions strip it before
 * anything is sent to the client.
 */
export const connections = pgTable(
  'connections',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Matches ConnectorPlugin.id in the registry, e.g. "tiktok-ads". */
    pluginId: text('plugin_id').notNull(),
    name: text('name').notNull(),
    status: text('status').$type<ConnectionStatus>().notNull().default('draft'),
    authType: text('auth_type').notNull(),
    credentials: text('credentials_enc'),
    /** Non-secret connector state: advertiser id, store domain, discovered scopes. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestStatus: text('last_test_status').$type<'ok' | 'failed'>(),
    lastTestMessage: text('last_test_message'),
    /** i18n key naming the diagnosis, resolved by the UI. See TestResult.hint. */
    lastTestHint: text('last_test_hint'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('connections_unique_name').on(t.projectId, t.pluginId, t.name),
    index('connections_project_idx').on(t.projectId),
  ],
)

/** Every call fired from the API Hub, kept for debugging and quota awareness. */
export const apiCallLogs = pgTable(
  'api_call_logs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').references(() => connections.id, { onDelete: 'set null' }),
    pluginId: text('plugin_id').notNull(),
    endpointId: text('endpoint_id').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    ok: text('ok').$type<'true' | 'false'>().notNull(),
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms').notNull().default(0),
    responseBytes: integer('response_bytes').notNull().default(0),
    /** Truncated preview so the log table stays small; the full body is not stored. */
    responsePreview: jsonb('response_preview'),
    errorMessage: text('error_message'),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('api_call_logs_project_idx').on(t.projectId, t.createdAt),
    index('api_call_logs_endpoint_idx').on(t.pluginId, t.endpointId),
  ],
)
