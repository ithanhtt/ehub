import 'server-only'

import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { connections } from '@/core/db/schema/connections'
import { decryptJson } from '@/core/crypto/secrets'
import { getPlugin } from '@/core/plugins/registry'

export type ConnectionView = {
  id: string
  pluginId: string
  pluginName: string
  pluginColor: string
  name: string
  status: 'draft' | 'connected' | 'error' | 'expired'
  authType: string
  endpointCount: number
  lastTestedAt: Date | null
  lastTestStatus: 'ok' | 'failed' | null
  lastTestMessage: string | null
  lastTestHint: string | null
  metadata: Record<string, unknown>
  /** Non-secret credential values, plus a "filled" marker for the secret ones. */
  fieldState: Array<{ key: string; filled: boolean; value?: string; secret: boolean }>
  createdAt: Date
  /** True when the plugin was removed from the registry but the row remains. */
  orphaned: boolean
}

/**
 * Reads connections for display.
 *
 * Secret values are deliberately never returned — only whether each one is
 * populated. That keeps the edit form honest ("stored, enter a new value to
 * replace") without a decrypted token ever reaching a browser.
 */
export async function listConnections(projectId: string): Promise<ConnectionView[]> {
  const rows = await db
    .select()
    .from(connections)
    .where(eq(connections.projectId, projectId))
    .orderBy(desc(connections.createdAt))

  return rows.map(toView)
}

export async function getConnectionView(
  projectId: string,
  connectionId: string,
): Promise<ConnectionView | null> {
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.projectId, projectId)))
    .limit(1)

  return row ? toView(row) : null
}

function toView(row: typeof connections.$inferSelect): ConnectionView {
  const plugin = getPlugin(row.pluginId)

  let stored: Record<string, string> = {}
  if (row.credentials) {
    try {
      stored = decryptJson(row.credentials)
    } catch {
      // A key rotation makes old envelopes unreadable. Surface it as an empty
      // credential set rather than crashing the whole settings page.
      stored = {}
    }
  }

  const fieldState = (plugin?.auth.fields ?? []).map((field) => ({
    key: field.key,
    secret: Boolean(field.secret),
    // A transient field is consumed on save and never stored, so it must
    // always render empty rather than claiming a value is being kept.
    filled: field.transient ? false : Boolean(stored[field.key]),
    value: field.secret ? undefined : stored[field.key],
  }))

  return {
    id: row.id,
    pluginId: row.pluginId,
    pluginName: plugin?.name ?? row.pluginId,
    pluginColor: plugin?.color ?? '#6b7280',
    name: row.name,
    status: row.status,
    authType: row.authType,
    endpointCount: plugin?.endpoints.length ?? 0,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    lastTestHint: row.lastTestHint,
    metadata: row.metadata ?? {},
    fieldState,
    createdAt: row.createdAt,
    orphaned: !plugin,
  }
}

/** Connections usable by the Hub: the plugin still exists and credentials are present. */
export async function listUsableConnections(projectId: string): Promise<ConnectionView[]> {
  const all = await listConnections(projectId)
  return all.filter((c) => !c.orphaned && c.status !== 'draft')
}
