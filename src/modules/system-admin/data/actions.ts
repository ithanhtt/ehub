'use server'

import { sql } from 'drizzle-orm'
import { assertSystemAdmin, type CurrentUser } from '@/core/auth/session'
import { db, isEmbeddedDatabase } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { runHousekeepingNow } from '@/core/housekeeping'
import { redactSecrets } from '@/core/plugins/http'
import { createId } from '@/core/utils/id'
import { clearMemo } from '@/modules/overview/data/cache'
import type {
  ConsoleOutcome,
  FullRow,
  GridPage,
  GridQuery,
  HousekeepingSummary,
  Outcome,
  RowOutcome,
  SnapshotInfo,
  TableSummary,
} from '../types'
import {
  buildDelete,
  buildUpdate,
  databaseError,
  databaseFacts,
  describeTable,
  listTables,
  readGrid,
  readRow,
  runBuilt,
  runConsole,
  secretColumnNames,
} from './db-inspect'
import { listSnapshots, writeSnapshot, type Dumpable } from './snapshots'
import { invalidateSystemSnapshot } from './system-info'

/**
 * The System and Database pages' actions — platform Administrators only.
 *
 * Every one checks the caller itself (assertSystemAdmin) before anything
 * else: a server action is a public POST endpoint whatever page it was
 * written for, and the admin layout's guard protects the page, not this.
 *
 * Everything that changes something is written to the audit trail with who
 * did it: the maintenance runs, snapshots, each row edited or deleted (table,
 * key and which columns — never values), and every statement run with writes
 * on (its text, with anything that looks like a credential redacted). Reads —
 * browsing tables, read-only queries — are not.
 *
 * On the embedded database there is one connection. The audit insert always
 * comes after a transaction has finished, never inside one.
 */

async function admin(): Promise<CurrentUser | null> {
  try {
    return await assertSystemAdmin()
  } catch {
    return null
  }
}

async function audit(actorId: string, action: string, targetType: string, targetId: string, detail: Record<string, unknown>) {
  try {
    await db.insert(auditLogs).values({ id: createId('aud'), projectId: null, actorId, action, targetType, targetId, detail })
  } catch (error) {
    // The action itself went through; a lost trail entry is logged rather than reported as its failure.
    console.warn(`[admin] audit ${action} not written: ${databaseError(error)}`)
  }
}

const forbidden = { ok: false as const, reason: 'forbidden' as const }

/* ---------------------------------------------------------- maintenance --- */

export async function runCleanupNow(): Promise<Outcome<HousekeepingSummary & { ms: number }>> {
  const user = await admin()
  if (!user) return forbidden
  const started = Date.now()
  const report = await runHousekeepingNow()
  if (!report) return { ok: false, reason: 'unavailable' }
  const ms = Date.now() - started
  await audit(user.id, 'system.housekeeping', 'system', 'housekeeping', { ...report, ms })
  invalidateSystemSnapshot()
  return { ok: true, data: { ...report, ms } }
}

/**
 * VACUUM (ANALYZE): space freed by deleted rows made reusable, and the
 * planner's statistics — which the table list's row estimates come from —
 * brought up to date. It cannot run inside a transaction, and does not:
 * db.execute sends it on its own (the pool's autocommit on Postgres).
 */
export async function vacuumDatabase(): Promise<Outcome<{ ms: number; before: number | null; after: number | null }>> {
  const user = await admin()
  if (!user) return forbidden
  const started = Date.now()
  try {
    const before = (await databaseFacts(db, !isEmbeddedDatabase)).bytes
    await db.execute(sql`VACUUM (ANALYZE)`)
    const after = (await databaseFacts(db, !isEmbeddedDatabase)).bytes
    const ms = Date.now() - started
    await audit(user.id, 'system.vacuum', 'database', isEmbeddedDatabase ? 'embedded' : 'postgres', { ms, before, after })
    invalidateSystemSnapshot()
    return { ok: true, data: { ms, before, after } }
  } catch (error) {
    return { ok: false, reason: 'failed', detail: databaseError(error) }
  }
}

export async function clearMemoryCache(): Promise<Outcome<{ entries: number }>> {
  const user = await admin()
  if (!user) return forbidden
  const entries = clearMemo()
  await audit(user.id, 'system.cache.clear', 'system', 'memo', { entries })
  return { ok: true, data: { entries } }
}

type SnapshotHolder = { __adshubSnapshotting?: Promise<SnapshotInfo> }
const snapshotHolder = globalThis as unknown as SnapshotHolder

/** One dump at a time: a second click (or a console write) waits for the one under way and gets it. */
function takeSnapshot(): Promise<SnapshotInfo> {
  if (snapshotHolder.__adshubSnapshotting) return snapshotHolder.__adshubSnapshotting
  const client = (db as unknown as { $client: Dumpable }).$client
  const running = writeSnapshot(client).finally(() => {
    snapshotHolder.__adshubSnapshotting = undefined
  })
  snapshotHolder.__adshubSnapshotting = running
  return running
}

export async function createSnapshot(): Promise<Outcome<SnapshotInfo>> {
  const user = await admin()
  if (!user) return forbidden
  if (!isEmbeddedDatabase) return { ok: false, reason: 'unavailable' }
  try {
    const snapshot = await takeSnapshot()
    await audit(user.id, 'system.snapshot', 'database', snapshot.name, { bytes: snapshot.bytes })
    invalidateSystemSnapshot()
    return { ok: true, data: snapshot }
  } catch (error) {
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : String(error) }
  }
}

/* -------------------------------------------------------------- browsing --- */

export async function loadTables(): Promise<Outcome<TableSummary[]>> {
  if (!(await admin())) return forbidden
  try {
    return { ok: true, data: await listTables(db) }
  } catch (error) {
    return { ok: false, reason: 'failed', detail: databaseError(error) }
  }
}

export async function loadGrid(table: string, query: Partial<GridQuery>): Promise<Outcome<GridPage>> {
  if (!(await admin())) return forbidden
  try {
    const meta = await describeTable(db, table)
    if (!meta) return { ok: false, reason: 'invalid', detail: 'table' }
    return { ok: true, data: await readGrid(db, meta, query) }
  } catch (error) {
    return { ok: false, reason: 'failed', detail: databaseError(error) }
  }
}

export async function loadRow(table: string, key: Record<string, string>): Promise<Outcome<FullRow>> {
  if (!(await admin())) return forbidden
  try {
    const meta = await describeTable(db, table)
    if (!meta) return { ok: false, reason: 'invalid', detail: 'table' }
    const row = await readRow(db, meta, key)
    return row ? { ok: true, data: row } : { ok: false, reason: 'invalid', detail: 'notFound' }
  } catch (error) {
    return { ok: false, reason: 'failed', detail: databaseError(error) }
  }
}

/* --------------------------------------------------------------- editing --- */

export async function saveRow(table: string, key: Record<string, string>, changes: Record<string, string | null>): Promise<RowOutcome> {
  const user = await admin()
  if (!user) return forbidden
  try {
    const meta = await describeTable(db, table)
    if (!meta) return { ok: false, reason: 'invalid', code: 'table' }
    const built = buildUpdate(meta, key, changes)
    if (!built.ok) return { ok: false, reason: 'invalid', ...built.failure }
    if ((await runBuilt(db, built)) === 0) return { ok: false, reason: 'notFound' }
    await audit(user.id, 'system.db.update', 'table', meta.name, { table: meta.name, key, columns: built.columns })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'database', detail: databaseError(error) }
  }
}

export async function removeRow(table: string, key: Record<string, string>): Promise<RowOutcome> {
  const user = await admin()
  if (!user) return forbidden
  try {
    const meta = await describeTable(db, table)
    if (!meta) return { ok: false, reason: 'invalid', code: 'table' }
    const built = buildDelete(meta, key)
    if (!built.ok) return { ok: false, reason: 'invalid', ...built.failure }
    if ((await runBuilt(db, built)) === 0) return { ok: false, reason: 'notFound' }
    await audit(user.id, 'system.db.delete', 'table', meta.name, { table: meta.name, key })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'database', detail: databaseError(error) }
  }
}

/* --------------------------------------------------------------- console --- */

/** A snapshot this recent already stands for "before this write": several writes in a row do not each push an older one out. */
const SNAPSHOT_REUSE_MS = 5 * 60_000

export async function runSql(text: string, write: boolean): Promise<ConsoleOutcome> {
  const user = await admin()
  if (!user) return { ok: false, reason: 'forbidden' }
  if (typeof text !== 'string' || text.length > 100_000) return { ok: false, reason: 'guard', code: 'empty' }
  const writes = write === true

  let secrets: string[]
  try {
    secrets = await secretColumnNames(db)
  } catch (error) {
    return { ok: false, reason: 'database', detail: databaseError(error) }
  }

  const outcome = await runConsole(db, {
    text,
    write: writes,
    postgres: !isEmbeddedDatabase,
    secretColumns: secrets,
    beforeWrite: isEmbeddedDatabase
      ? async () => {
          const [latest] = await listSnapshots()
          if (latest && Date.now() - Date.parse(latest.at) < SNAPSHOT_REUSE_MS) return latest.name
          const taken = await takeSnapshot()
          invalidateSystemSnapshot()
          return taken.name
        }
      : undefined,
  })

  if (writes && (outcome.ok ? outcome.wrote : outcome.reason === 'database')) {
    await audit(user.id, 'system.db.sql', 'database', isEmbeddedDatabase ? 'embedded' : 'postgres', {
      statement: redactSecrets(text).slice(0, 4_000),
      ok: outcome.ok,
      affected: outcome.ok ? outcome.affected : null,
      snapshot: outcome.ok ? outcome.snapshot : null,
      error: !outcome.ok && 'detail' in outcome && outcome.detail ? outcome.detail.slice(0, 500) : null,
    })
  }
  return outcome
}
