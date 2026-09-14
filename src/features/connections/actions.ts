'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { connections } from '@/core/db/schema/connections'
import { assertCapability } from '@/core/auth/session'
import { decryptJson, encryptJson } from '@/core/crypto/secrets'
import { requirePlugin } from '@/core/plugins/registry'
import { testConnection as runPluginTest } from '@/core/plugins/execute'
import { runConnectorAction } from '@/core/plugins/run-action'
import type { ActionFinding } from '@/core/plugins/types'
import { createId } from '@/core/utils/id'

export type ConnectionActionState = {
  ok: boolean
  message?: string
  connectionId?: string
  testMessage?: string
  testOk?: boolean
  testHint?: string
}

export type ActionActionState = {
  ok: boolean
  message?: string
  actionOk?: boolean
  actionMessage?: string
  actionHint?: string
  findings?: ActionFinding[]
}

function fail(message: string): ConnectionActionState {
  return { ok: false, message }
}

/**
 * Removes every whitespace character, not just the ends.
 *
 * Access tokens and API secrets never contain whitespace, but they are long
 * enough that copying one out of a console or a PDF often brings a line break
 * along in the middle. `trim()` cannot see that, so the corrupted value used
 * to be stored and sent, and the provider answered with a plain "token is
 * incorrect" — pointing the user at the wrong problem entirely.
 */
function normaliseSecret(value: string): string {
  return value.replace(/\s+/g, '')
}

/**
 * Collects credential values out of the submitted form.
 *
 * Secret fields left blank mean "keep what is stored", which is what makes it
 * possible to edit a connection's name without re-typing an access token.
 */
function collectCredentials(
  fields: ReturnType<typeof requirePlugin>['auth']['fields'],
  formData: FormData,
  previous: Record<string, string>,
): { credentials: Record<string, string>; missing: string[] } {
  const credentials: Record<string, string> = {}
  const missing: string[] = []

  for (const field of fields) {
    const raw = String(formData.get(`cred_${field.key}`) ?? '')
    // Free-text fields (a store domain) only get the ends trimmed; opaque
    // credentials get all whitespace stripped.
    const submitted = field.secret ? normaliseSecret(raw) : raw.trim()
    // A blank secret means "keep what is stored" — except for a transient one,
    // which was consumed on the way in and has nothing to keep.
    const value =
      submitted || (field.secret && !field.transient ? (previous[field.key] ?? '') : submitted)

    if (value) credentials[field.key] = value
    else if (field.required) missing.push(field.key)
  }

  return { credentials, missing }
}

/**
 * Lets the connector turn what was typed into what should be stored.
 *
 * Runs between collecting the form and encrypting, so a provider that has to
 * *fetch* its durable credential — trading an OAuth auth_code for a token —
 * does it as part of the same save the user submitted. Transient fields are
 * stripped here as well, so a connector that forgets to drop one cannot leave
 * a spent secret behind.
 */
async function resolveForStorage(
  plugin: ReturnType<typeof requirePlugin>,
  collected: Record<string, string>,
  previous: Record<string, string>,
): Promise<
  | { ok: true; credentials: Record<string, string>; message?: string; hint?: string; metadata?: Record<string, unknown> }
  | { ok: false; message: string; hint?: string }
> {
  const transient = new Set(plugin.auth.fields.filter((f) => f.transient).map((f) => f.key))
  const strip = (bag: Record<string, string>) =>
    Object.fromEntries(Object.entries(bag).filter(([key]) => !transient.has(key)))

  if (!plugin.resolveCredentials) {
    return { ok: true, credentials: strip(collected) }
  }

  let resolution
  try {
    resolution = await plugin.resolveCredentials({ credentials: collected, previous })
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      hint: undefined,
    }
  }

  if (!resolution.ok) {
    return { ok: false, message: resolution.message ?? 'validation', hint: resolution.hint }
  }

  return {
    ok: true,
    credentials: strip(resolution.credentials),
    message: resolution.message,
    hint: resolution.hint,
    metadata: resolution.metadata,
  }
}

export async function createConnection(
  projectId: string,
  _prev: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'connection:create')
  } catch {
    return fail('forbidden')
  }

  const pluginId = String(formData.get('pluginId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!pluginId || !name) return fail('validation')

  let plugin
  try {
    plugin = requirePlugin(pluginId)
  } catch {
    return fail('validation')
  }

  const { credentials, missing } = collectCredentials(plugin.auth.fields, formData, {})
  if (missing.length > 0) return fail('validation')

  const [duplicate] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(
        eq(connections.projectId, projectId),
        eq(connections.pluginId, pluginId),
        eq(connections.name, name),
      ),
    )
    .limit(1)
  if (duplicate) return fail('nameTaken')

  const resolved = await resolveForStorage(plugin, credentials, {})
  if (!resolved.ok) {
    return { ok: false, message: resolved.message, testHint: resolved.hint }
  }

  const id = createId('con')
  await db.insert(connections).values({
    id,
    projectId,
    pluginId,
    name,
    authType: plugin.auth.type,
    credentials: encryptJson(resolved.credentials),
    metadata: resolved.metadata ?? {},
    status: 'draft',
    createdById: ctx.user.id,
  })

  await db.insert(auditLogs).values({
    id: createId('aud'),
    projectId,
    actorId: ctx.user.id,
    action: 'connection.create',
    targetType: 'connection',
    targetId: id,
    // Credential values are never written to the audit trail; only which
    // fields were supplied.
    detail: { pluginId, name, fields: Object.keys(resolved.credentials) },
  })

  // Verify immediately: a connection that has never been tested is close to
  // useless, and doing it here saves the user a second click.
  const test = await runPluginTest(id, projectId)

  revalidatePath(`/projects/${projectId}/settings/connections`)
  revalidatePath(`/projects/${projectId}/hub`)
  return { ok: true, connectionId: id, testOk: test.ok, testMessage: test.message, testHint: test.hint }
}

export async function updateConnection(
  projectId: string,
  connectionId: string,
  _prev: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'connection:update')
  } catch {
    return fail('forbidden')
  }

  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.projectId, projectId)))
    .limit(1)
  if (!row) return fail('notFound')

  let plugin
  try {
    plugin = requirePlugin(row.pluginId)
  } catch {
    return fail('validation')
  }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return fail('validation')

  let previous: Record<string, string> = {}
  try {
    previous = row.credentials ? decryptJson(row.credentials) : {}
  } catch {
    previous = {}
  }

  const { credentials, missing } = collectCredentials(plugin.auth.fields, formData, previous)
  if (missing.length > 0) return fail('validation')

  const resolved = await resolveForStorage(plugin, credentials, previous)
  if (!resolved.ok) {
    return { ok: false, message: resolved.message, testHint: resolved.hint }
  }

  await db
    .update(connections)
    .set({
      name,
      credentials: encryptJson(resolved.credentials),
      ...(resolved.metadata
        ? { metadata: { ...((row.metadata ?? {}) as Record<string, unknown>), ...resolved.metadata } }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(connections.id, connectionId))

  await db.insert(auditLogs).values({
    id: createId('aud'),
    projectId,
    actorId: ctx.user.id,
    action: 'connection.update',
    targetType: 'connection',
    targetId: connectionId,
    detail: { name, fields: Object.keys(resolved.credentials) },
  })

  const test = await runPluginTest(connectionId, projectId)

  revalidatePath(`/projects/${projectId}/settings/connections`)
  revalidatePath(`/projects/${projectId}/hub`)
  return { ok: true, connectionId, testOk: test.ok, testMessage: test.message, testHint: test.hint }
}

export async function testConnectionAction(
  projectId: string,
  connectionId: string,
): Promise<ConnectionActionState> {
  try {
    await assertCapability(projectId, 'connection:view')
  } catch {
    return fail('forbidden')
  }

  try {
    const result = await runPluginTest(connectionId, projectId)
    revalidatePath(`/projects/${projectId}/settings/connections`)
    return { ok: true, testOk: result.ok, testMessage: result.message, testHint: result.hint }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'serverError')
  }
}

export async function deleteConnection(
  projectId: string,
  connectionId: string,
): Promise<ConnectionActionState> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'connection:delete')
  } catch {
    return fail('forbidden')
  }

  await db
    .delete(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.projectId, projectId)))

  await db.insert(auditLogs).values({
    id: createId('aud'),
    projectId,
    actorId: ctx.user.id,
    action: 'connection.delete',
    targetType: 'connection',
    targetId: connectionId,
    detail: {},
  })

  revalidatePath(`/projects/${projectId}/settings/connections`)
  revalidatePath(`/projects/${projectId}/hub`)
  return { ok: true }
}

/**
 * Runs a connector-declared repair or inspection tool.
 *
 * The permission depends on what the action does: a read-only diagnosis is
 * available to anyone who can see the connection, while anything that can
 * rewrite credentials needs the same right as editing them by hand. Reading
 * that off the action's own declaration keeps the rule with the action instead
 * of in a list here that would drift.
 */
export async function runConnectionAction(
  projectId: string,
  connectionId: string,
  actionId: string,
  input: Record<string, string>,
): Promise<ActionActionState> {
  const [row] = await db
    .select({ pluginId: connections.pluginId })
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.projectId, projectId)))
    .limit(1)
  if (!row) return { ok: false, message: 'notFound' }

  let action
  try {
    action = requirePlugin(row.pluginId).actions?.find((candidate) => candidate.id === actionId)
  } catch {
    return { ok: false, message: 'notFound' }
  }
  if (!action) return { ok: false, message: 'notFound' }

  let ctx
  try {
    ctx = await assertCapability(
      projectId,
      action.mutatesCredentials ? 'connection:update' : 'connection:view',
    )
  } catch {
    return { ok: false, message: 'forbidden' }
  }

  try {
    const result = await runConnectorAction({
      projectId,
      connectionId,
      actionId,
      input,
      actorId: ctx.user.id,
    })

    revalidatePath(`/projects/${projectId}/settings/connections`)
    revalidatePath(`/projects/${projectId}/hub`)

    return {
      ok: true,
      actionOk: result.ok,
      actionMessage: result.message,
      actionHint: result.hint,
      findings: result.findings,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'serverError' }
  }
}
