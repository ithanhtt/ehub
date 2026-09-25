import 'server-only'

import { and, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { connections } from '@/core/db/schema/connections'
import { decryptJson, encryptJson } from '@/core/crypto/secrets'
import { redactSecrets } from './http'
import { getPlugin } from './registry'
import type { ConnectionContext, CredentialResolution } from './types'

type ConnectionRow = typeof connections.$inferSelect

/**
 * A connection's context, with credentials that expire on their own renewed
 * first (see ConnectorPlugin.refreshCredentials).
 *
 * The renewal is stored before the context is handed back, so a refresh token
 * that the provider rotates on use is never spent twice. Concurrent callers
 * for one connection share one renewal: two parallel refreshes with the same
 * refresh token would have the provider revoke one of them.
 *
 * More rules, each for a way this goes wrong:
 *  · The row is read again before a refresh token is spent — another process
 *    (or a save) may have renewed it a moment ago, and the provider would
 *    refuse the old one.
 *  · A failed renewal is not tried again for FAILURE_BACKOFF_MS — an expired
 *    refresh token must not turn every page refresh into a call to the auth
 *    endpoint. Before that counts as a failure the row is read once more: a
 *    refusal of the refresh token is also what another process's renewal,
 *    finished in between, looks like; its tokens are used then. The failure's
 *    message (secrets masked) is kept (lastRefreshFailure) and logged once.
 *  · The write only lands on the row as it was read (`updatedAt` unchanged).
 *    If someone saved the connection meanwhile, their save wins and the fresh
 *    row is used as it is — a renewal never writes old tokens over new ones.
 *  · A write that throws is tried again (WRITE_ATTEMPTS). If it still fails,
 *    the provider has issued a new pair and may have revoked the old: the new
 *    one is kept in memory and used — laid over the row for as long as the row
 *    still holds the pair it replaced — and stored at the next use.
 *  · Like a save, it merges: a renewal never drops the app credentials beside
 *    the token, and writes neither values nor field names anywhere else. No
 *    token ever reaches a log.
 */
const FAILURE_BACKOFF_MS = 10 * 60_000
const WRITE_ATTEMPTS = 3

const inFlight = ((globalThis as unknown as { __adshubCredentialRefresh?: Map<string, Promise<ConnectionContext>> })
  .__adshubCredentialRefresh ??= new Map())
const failedAt = ((globalThis as unknown as { __adshubCredentialRefreshFailed?: Map<string, number> }).__adshubCredentialRefreshFailed ??= new Map())
const failures = ((globalThis as unknown as { __adshubCredentialRefreshError?: Map<string, { at: number; message: string }> })
  .__adshubCredentialRefreshError ??= new Map())

/** Renewed credentials not stored yet, per connection; `spent` is the pair they replace. */
type Held = { spent: Tokens; credentials: Record<string, string>; metadata?: Record<string, unknown> }
const held = ((globalThis as unknown as { __adshubCredentialRefreshHeld?: Map<string, Held> }).__adshubCredentialRefreshHeld ??= new Map())

type Tokens = { accessToken?: string; refreshToken?: string }
const tokensOf = (credentials: Record<string, string>): Tokens => ({ accessToken: credentials.accessToken, refreshToken: credentials.refreshToken })
const sameTokens = (a: Tokens, b: Tokens) => a.accessToken === b.accessToken && a.refreshToken === b.refreshToken
const describe = (error: unknown) => redactSecrets(error instanceof Error ? error.message : String(error))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The last renewal of a connection's credentials that failed, when it has not succeeded since: when, and why (secrets masked). */
export function lastRefreshFailure(connectionId: string): { at: number; message: string } | null {
  return failures.get(connectionId) ?? null
}

export function contextOfRow(row: ConnectionRow): ConnectionContext {
  let credentials: Record<string, string> = {}
  try {
    credentials = row.credentials ? decryptJson(row.credentials) : {}
  } catch {
    // A rotated encryption key: the connector reports the empty bag honestly.
    credentials = {}
  }
  return { credentials, metadata: row.metadata ?? {}, connectionId: row.id, projectId: row.projectId }
}

/** A context with renewed credentials held in memory laid over it, while its row still holds the pair they replaced. */
function withHeld(context: ConnectionContext): ConnectionContext {
  const kept = held.get(context.connectionId)
  if (!kept || !sameTokens(tokensOf(context.credentials), kept.spent)) return context
  return {
    ...context,
    credentials: { ...context.credentials, ...kept.credentials },
    metadata: kept.metadata ? { ...context.metadata, ...kept.metadata } : context.metadata,
  }
}

async function readRow(id: string): Promise<ConnectionRow | null> {
  const [row] = await db.select().from(connections).where(eq(connections.id, id)).limit(1)
  return row ?? null
}

/** Writes a renewal onto the row as it was read (`base`); the context now in force. */
async function storeOnce(base: ConnectionRow, context: ConnectionContext, resolution: CredentialResolution): Promise<ConnectionContext> {
  const credentials = { ...context.credentials, ...resolution.credentials }
  const metadata = resolution.metadata ? { ...context.metadata, ...resolution.metadata } : context.metadata
  const written = await db
    .update(connections)
    .set({ credentials: encryptJson(credentials), metadata, updatedAt: new Date() })
    .where(and(eq(connections.id, base.id), eq(connections.updatedAt, base.updatedAt)))
    .returning({ id: connections.id })
  if (written.length > 0) return { ...context, credentials, metadata }

  // Saved by someone else in the meantime (or by an attempt of this very write that threw after it landed).
  // If that save kept the token this renewal just spent (an edit of the name, say), the new tokens go onto it;
  // if it brought tokens of its own, theirs stand.
  const latest = await readRow(base.id)
  if (!latest) return context
  const theirs = contextOfRow(latest)
  if (!sameTokens(tokensOf(theirs.credentials), tokensOf(context.credentials))) return theirs
  const merged = { ...theirs.credentials, ...resolution.credentials }
  const mergedMetadata = resolution.metadata ? { ...theirs.metadata, ...resolution.metadata } : theirs.metadata
  const retried = await db
    .update(connections)
    .set({ credentials: encryptJson(merged), metadata: mergedMetadata, updatedAt: new Date() })
    .where(and(eq(connections.id, latest.id), eq(connections.updatedAt, latest.updatedAt)))
    .returning({ id: connections.id })
  return retried.length > 0 ? { ...theirs, credentials: merged, metadata: mergedMetadata } : theirs
}

/** storeOnce, tried again when the database throws; throws the last error after WRITE_ATTEMPTS. */
async function store(base: ConnectionRow, context: ConnectionContext, resolution: CredentialResolution): Promise<ConnectionContext> {
  let lastError: unknown
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    if (attempt > 0) await pause(250 * 4 ** (attempt - 1))
    try {
      return await storeOnce(base, context, resolution)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export function freshContext(row: ConnectionRow): Promise<ConnectionContext> {
  const plugin = getPlugin(row.pluginId)
  if (!plugin?.refreshCredentials) return Promise.resolve(contextOfRow(row))
  if (Date.now() - (failedAt.get(row.id) ?? 0) < FAILURE_BACKOFF_MS) return Promise.resolve(withHeld(contextOfRow(row)))

  const running = inFlight.get(row.id)
  if (running) return running

  const renewal = (async (): Promise<ConnectionContext> => {
    // Read again: the row in hand may predate a renewal that has just rotated the refresh token.
    // Unreadable, nothing is spent on a row that may be stale.
    const current = await readRow(row.id).catch(() => null)
    if (!current) return withHeld(contextOfRow(row))
    let context = contextOfRow(current)
    let base = current

    // A pair renewed earlier that could not be stored: stored now, before anything spends a refresh token.
    const kept = held.get(row.id)
    if (kept) {
      if (!sameTokens(tokensOf(context.credentials), kept.spent)) held.delete(row.id)
      else {
        try {
          context = await store(base, context, { ok: true, credentials: kept.credentials, metadata: kept.metadata })
          held.delete(row.id)
          base = (await readRow(row.id).catch(() => null)) ?? base
        } catch {
          return withHeld(context)
        }
      }
    }

    const resolution: CredentialResolution | null = await plugin.refreshCredentials!(context).catch((error: unknown) => ({
      ok: false,
      credentials: {},
      message: describe(error),
    }))
    if (!resolution) return context
    if (!resolution.ok) {
      // Refused — or spent a moment ago by another process, whose new pair is on the row now.
      const again = await readRow(row.id).catch(() => null)
      if (again) {
        const theirs = contextOfRow(again)
        if (!sameTokens(tokensOf(theirs.credentials), tokensOf(context.credentials))) {
          failedAt.delete(row.id)
          failures.delete(row.id)
          return theirs
        }
      }
      const message = redactSecrets(resolution.message || 'The provider did not renew the token')
      const previous = failures.get(row.id)
      failedAt.set(row.id, Date.now())
      failures.set(row.id, { at: Date.now(), message })
      if (previous?.message !== message) console.warn(`[credentials] ${plugin.id} ${row.id}: token renewal failed — ${message}`)
      return context
    }
    failedAt.delete(row.id)
    failures.delete(row.id)

    try {
      return await store(base, context, resolution)
    } catch (error) {
      // The provider issued the new pair and may have revoked the old one: kept and used, stored at the next use.
      held.set(row.id, { spent: tokensOf(context.credentials), credentials: resolution.credentials, metadata: resolution.metadata })
      console.warn(`[credentials] ${plugin.id} ${row.id}: renewed token could not be stored, kept in memory until it can — ${describe(error)}`)
      return withHeld(context)
    }
  })().finally(() => inFlight.delete(row.id))

  inFlight.set(row.id, renewal)
  return renewal
}
