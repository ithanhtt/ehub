import 'server-only'

import { statfs } from 'node:fs/promises'
import path from 'node:path'
import { and, desc, eq, lt, lte, sql } from 'drizzle-orm'
import { db, isEmbeddedDatabase } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { session, verification } from '@/core/db/schema/auth'
import { apiCallLogs, connections } from '@/core/db/schema/connections'
import { reasonOf, warnThrottled } from '@/core/utils/log'
import { sweepCache } from './cache-sweep'

/**
 * Keeps what the app writes from filling the disk over months of running,
 * once a day (and a few minutes after the server starts):
 *
 *   - the API Hub's call log: the last CALL_LOG_DAYS days, and at most
 *     CALL_LOG_MAX_ROWS rows per project (the newest);
 *   - the audit trail: AUDIT_DAYS days — long enough to answer "who changed
 *     this", not forever;
 *   - sign-in sessions and verification codes that have expired;
 *   - then, on the embedded database, a VACUUM so the space freed is used
 *     again rather than the files growing past it;
 *   - the provider caches under .data/cache: files of connections that no
 *     longer exist, files no store has written for CACHE_STALE_DAYS days (a
 *     shop no longer shown, an old scope — rebuilt on demand if ever needed),
 *     temporary files a crash left behind, and all but the newest few files
 *     set aside as unreadable;
 *   - and a warning in the log while free disk space runs low.
 *
 * Data the user made (projects, connections, bookings, datasets) is never
 * touched. Database snapshots, update releases and PM2's own log already keep
 * bounded histories of their own (scripts/lib.mjs, scripts/apply-update.mjs,
 * pm2-logrotate).
 *
 * Every step stands alone: one that fails is logged and the others still run.
 * Runs in the server process — the only one holding the embedded database.
 */

const CALL_LOG_DAYS = 30
const CALL_LOG_MAX_ROWS = 20_000
const AUDIT_DAYS = 365
const LOW_DISK_BYTES = 2 * 1024 ** 3

const DAY_MS = 24 * 3600_000
const FIRST_RUN_MS = 5 * 60_000
const EVERY_MS = DAY_MS

const DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data')
const CACHE_DIR = path.join(DATA_DIR, 'cache')

type Runner = { timer: NodeJS.Timeout | null; stopped: boolean; running: boolean }

/** The last run's outcome, for the System page: when, how long, what went. Kept apart from the runner, which a dev reload replaces. */
export type HousekeepingRun = { at: string; ms: number; report: HousekeepingReport }

const holder = globalThis as unknown as { __adshubHousekeeping?: Runner; __adshubHousekeepingLast?: HousekeepingRun; __adshubHousekeepingManual?: boolean }

export function housekeepingState(): { scheduled: boolean; running: boolean; last: HousekeepingRun | null } {
  const runner = holder.__adshubHousekeeping
  return {
    scheduled: Boolean(runner && !runner.stopped),
    running: Boolean(runner?.running || holder.__adshubHousekeepingManual),
    last: holder.__adshubHousekeepingLast ?? null,
  }
}

/**
 * A run asked for from the System page. Refused (null) while one is already
 * under way — the scheduled one or another click — so two never delete from
 * the same tables at once.
 */
export async function runHousekeepingNow(): Promise<HousekeepingReport | null> {
  if (holder.__adshubHousekeeping?.running || holder.__adshubHousekeepingManual) return null
  holder.__adshubHousekeepingManual = true
  try {
    return await runHousekeeping()
  } finally {
    holder.__adshubHousekeepingManual = false
  }
}

export function startHousekeeping() {
  // A dev reload starts it again: the one already running is stopped first.
  const previous = holder.__adshubHousekeeping
  if (previous) {
    previous.stopped = true
    if (previous.timer) clearTimeout(previous.timer)
  }
  const runner: Runner = { timer: null, stopped: false, running: false }
  holder.__adshubHousekeeping = runner
  const next = (delay: number) => {
    if (runner.stopped) return
    runner.timer = setTimeout(() => {
      if (runner.running || holder.__adshubHousekeepingManual) return next(EVERY_MS)
      runner.running = true
      void runHousekeeping()
        .catch((error) => warnThrottled('housekeeping', `[housekeeping] ${reasonOf(error)}`))
        .finally(() => {
          runner.running = false
          next(EVERY_MS)
        })
    }, delay)
    runner.timer.unref()
  }
  next(FIRST_RUN_MS)
}

export type HousekeepingReport = {
  callLogs: number
  auditLogs: number
  sessions: number
  cacheFiles: number
  cacheBytes: number
  freeBytes: number | null
}

/** Where it works, for a test to point at a scratch database and directory instead. */
export type HousekeepingTarget = { database: typeof db; embedded: boolean; dataDir: string; cacheDir: string; callLogMaxRows?: number }

const LIVE: HousekeepingTarget = { database: db, embedded: isEmbeddedDatabase, dataDir: DATA_DIR, cacheDir: CACHE_DIR }

export async function runHousekeeping(now = Date.now(), target: HousekeepingTarget = LIVE): Promise<HousekeepingReport> {
  const { database } = target
  const started = Date.now()
  const cap = target.callLogMaxRows ?? CALL_LOG_MAX_ROWS
  const report: HousekeepingReport = { callLogs: 0, auditLogs: 0, sessions: 0, cacheFiles: 0, cacheBytes: 0, freeBytes: null }
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      warnThrottled(`housekeeping:${name}`, `[housekeeping] ${name}: ${reasonOf(error)}`)
    }
  }

  await step('call log', async () => {
    report.callLogs += await deleted(database.delete(apiCallLogs).where(lt(apiCallLogs.createdAt, new Date(now - CALL_LOG_DAYS * DAY_MS))).returning({ id: apiCallLogs.id }))
    // A project calling in a loop stays within its cap: all but its newest CALL_LOG_MAX_ROWS rows go.
    const projects = await database
      .select({ projectId: apiCallLogs.projectId, n: sql<number>`count(*)::int` })
      .from(apiCallLogs)
      .groupBy(apiCallLogs.projectId)
    for (const { projectId, n } of projects) {
      if (n <= cap) continue
      const [edge] = await database
        .select({ createdAt: apiCallLogs.createdAt })
        .from(apiCallLogs)
        .where(eq(apiCallLogs.projectId, projectId))
        .orderBy(desc(apiCallLogs.createdAt))
        .offset(cap)
        .limit(1)
      if (!edge) continue
      report.callLogs += await deleted(
        database
          .delete(apiCallLogs)
          .where(and(eq(apiCallLogs.projectId, projectId), lte(apiCallLogs.createdAt, edge.createdAt)))
          .returning({ id: apiCallLogs.id }),
      )
    }
  })

  await step('audit log', async () => {
    report.auditLogs += await deleted(database.delete(auditLogs).where(lt(auditLogs.createdAt, new Date(now - AUDIT_DAYS * DAY_MS))).returning({ id: auditLogs.id }))
  })

  await step('sessions', async () => {
    const cutoff = new Date(now)
    report.sessions += await deleted(database.delete(session).where(lt(session.expiresAt, cutoff)).returning({ id: session.id }))
    report.sessions += await deleted(database.delete(verification).where(lt(verification.expiresAt, cutoff)).returning({ id: verification.id }))
  })

  // A server database vacuums itself; the embedded one is told to, when rows went.
  if (target.embedded && report.callLogs + report.auditLogs + report.sessions > 0) {
    await step('vacuum', async () => {
      await database.execute(sql`VACUUM`)
    })
  }

  await step('cache', async () => {
    const known = new Set((await database.select({ id: connections.id }).from(connections)).map((row) => row.id))
    const outcome = await sweepCache(target.cacheDir, known, now)
    report.cacheFiles = outcome.files
    report.cacheBytes = outcome.bytes
  })

  await step('disk', async () => {
    const fs = await statfs(target.dataDir)
    report.freeBytes = fs.bavail * fs.bsize
    if (report.freeBytes < LOW_DISK_BYTES) {
      warnThrottled('housekeeping:disk', `[housekeeping] low disk space: ${(report.freeBytes / 1024 ** 3).toFixed(1)} GB free where ${target.dataDir} lives`)
    }
  })

  const removed = report.callLogs + report.auditLogs + report.sessions + report.cacheFiles
  if (removed > 0) {
    console.info(
      `[housekeeping] removed ${report.callLogs} call log rows, ${report.auditLogs} audit rows, ${report.sessions} expired sessions, ${report.cacheFiles} cache files (${(report.cacheBytes / 1024 ** 2).toFixed(1)} MB)`,
    )
  }
  // Only the app's own runs are remembered; a test's scratch run is not the server's history.
  if (target === LIVE) holder.__adshubHousekeepingLast = { at: new Date(now).toISOString(), ms: Date.now() - started, report }
  return report
}

async function deleted(query: Promise<unknown[]>): Promise<number> {
  return (await query).length
}
