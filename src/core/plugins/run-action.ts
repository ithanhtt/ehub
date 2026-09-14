import 'server-only'

import { and, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { connections } from '@/core/db/schema/connections'
import { decryptJson, encryptJson } from '@/core/crypto/secrets'
import { createId } from '@/core/utils/id'
import { requirePlugin } from './registry'
import type { ConnectionContext, ConnectorAction, ConnectorActionResult } from './types'

export interface RunActionArgs {
  projectId: string
  connectionId: string
  actionId: string
  input: Record<string, string>
  actorId: string
}

/**
 * Runs a connector-declared action against one connection.
 *
 * The single place where an action can reach stored credentials, and the only
 * place allowed to write new ones back. Two invariants hold here:
 *
 *  · The user's input and the resulting credentials never reach the audit
 *    trail — an auth_code and an access token are both bearer secrets, and a
 *    log is exactly where they must not accumulate.
 *  · Credential updates are *merged*, not replacing the bag. An action that
 *    mints a token must not silently drop the App ID sitting next to it.
 */
export async function runConnectorAction(args: RunActionArgs): Promise<ConnectorActionResult> {
  const [connection] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, args.connectionId), eq(connections.projectId, args.projectId)))
    .limit(1)

  if (!connection) throw new Error('CONNECTION_NOT_FOUND')

  const plugin = requirePlugin(connection.pluginId)
  const action = plugin.actions?.find((candidate) => candidate.id === args.actionId)
  if (!action) throw new Error('ACTION_NOT_FOUND')

  let credentials: Record<string, string> = {}
  try {
    credentials = connection.credentials ? decryptJson(connection.credentials) : {}
  } catch {
    // A rotated encryption key leaves an unreadable envelope. Running with an
    // empty bag lets the action report that honestly instead of throwing.
    credentials = {}
  }

  const context: ConnectionContext = {
    credentials,
    metadata: connection.metadata ?? {},
    connectionId: connection.id,
    projectId: connection.projectId,
  }

  let outcome: ConnectorActionResult
  try {
    outcome = await action.run({ context, input: args.input })
  } catch (error) {
    outcome = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const hasCredentialUpdates =
    action.mutatesCredentials && outcome.credentialUpdates
      ? Object.keys(outcome.credentialUpdates).length > 0
      : false

  if (hasCredentialUpdates || outcome.metadata) {
    await db
      .update(connections)
      .set({
        ...(hasCredentialUpdates
          ? { credentials: encryptJson({ ...credentials, ...outcome.credentialUpdates }) }
          : {}),
        ...(outcome.metadata ? { metadata: { ...context.metadata, ...outcome.metadata } } : {}),
        updatedAt: new Date(),
      })
      .where(eq(connections.id, connection.id))
  }

  await db.insert(auditLogs).values({
    id: createId('aud'),
    projectId: args.projectId,
    actorId: args.actorId,
    action: `connection.action.${action.id}`,
    targetType: 'connection',
    targetId: connection.id,
    detail: {
      pluginId: plugin.id,
      ok: outcome.ok,
      // Key names only. Never the values on either side.
      inputFields: Object.keys(args.input),
      credentialsUpdated: hasCredentialUpdates ? Object.keys(outcome.credentialUpdates ?? {}) : [],
    },
  })

  // The caller is a server action returning this to the browser, so the
  // credential bag is stripped before it leaves.
  const { credentialUpdates: _dropped, ...safe } = outcome
  return safe
}
