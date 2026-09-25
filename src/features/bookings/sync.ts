import 'server-only'

import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { bookings } from '@/core/db/schema/bookings'
import { connections } from '@/core/db/schema/connections'
import { freshContext } from '@/core/plugins/fresh-credentials'
import { reasonOf, warnThrottled } from '@/core/utils/log'
import { ttsCall } from '@/modules/analytics/data/tiktok-shop'
import { vnDate } from '@/modules/analytics/period'
import { readResults, resultTargets, type ResultRow } from '@/modules/bookings/results'
import { RESULT_CHUNK, resultUpdateStatement } from './result-writes'

/**
 * Keeps each booking's results — "Số đơn ra" and "Doanh thu quy KOC" — in
 * step with TikTok Shop (see modules/bookings/results.ts for how they are
 * read), without anyone waiting on it:
 *
 *   · opening the booking page starts a sync when the last one is older than
 *     DUE_MS (or a booking with a video was never synced) — the page does
 *     not wait, it shows "Đang đồng bộ…" and refreshes when the sync is done;
 *   · "Đồng bộ kết quả" on the page starts one at once;
 *   · the server's background rounds start one for each shop connection's
 *     project when due (overview/data/background.ts).
 *
 * One sync per project at a time: whoever asks while one runs shares it. Its
 * state is kept in memory (on globalThis, so a dev reload keeps it) — after a
 * restart, the rows' own sync times say what is due.
 *
 * Results are written in a few bulk statements after the reads, never inside
 * a transaction: the embedded database has one connection (see actions.ts).
 */

/** A sync older than this is due when the page opens. */
export const DUE_MS = 30 * 60_000
/** A booking never synced makes a sync due sooner — but not in a loop when there is nothing to read it with. */
const UNSYNCED_DUE_MS = 2 * 60_000
/** TikTok calls one sync may make; the rest waits for the next. */
const MAX_CALLS = 400

export type SyncOutcome = {
  /** When it finished (epoch ms). */
  at: number
  /** Bookings whose results were written. */
  updated: number
  /** Why nothing could be read, when so. */
  reason: 'noConnection' | 'failed' | null
}

type ProjectSync = { running: Promise<SyncOutcome> | null; startedAt: number; last: SyncOutcome | null }

const syncs = ((globalThis as unknown as { __adshubBookingSync?: Map<string, ProjectSync> }).__adshubBookingSync ??= new Map())

function stateOf(projectId: string): ProjectSync {
  let state = syncs.get(projectId)
  if (!state) syncs.set(projectId, (state = { running: null, startedAt: 0, last: null }))
  return state
}

/** The project's TikTok Shop connection — the first that tests green, else the first — as the reports pick it. */
async function shopContext(projectId: string) {
  const rows = await db
    .select()
    .from(connections)
    .where(and(eq(connections.projectId, projectId), eq(connections.pluginId, 'tiktok-shop')))
  const row = rows.find((candidate) => candidate.status === 'connected') ?? rows[0]
  return row ? freshContext(row) : null
}

/** Whether the project has a TikTok Shop connection to sync results from. */
export async function hasShopConnection(projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.projectId, projectId), eq(connections.pluginId, 'tiktok-shop')))
    .limit(1)
  return rows.length > 0
}

async function run(projectId: string, force: boolean): Promise<SyncOutcome> {
  const done = (updated: number, reason: SyncOutcome['reason'] = null): SyncOutcome => ({ at: Date.now(), updated, reason })
  const context = await shopContext(projectId)
  if (!context) return done(0, 'noConnection')

  const rows: ResultRow[] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      videoId: bookings.videoId,
      bookedOn: bookings.bookedOn,
      airedOn: bookings.airedOn,
      resultSource: bookings.resultSource,
      resultSyncedAt: bookings.resultSyncedAt,
    })
    .from(bookings)
    .where(and(eq(bookings.projectId, projectId), ne(bookings.status, 'cancelled'), isNotNull(bookings.videoId), or(isNull(bookings.resultSource), ne(bookings.resultSource, 'manual'))))
    .then((found) => found.map((row) => ({ ...row, resultSyncedAt: row.resultSyncedAt?.toISOString() ?? null })))

  const today = vnDate(new Date())
  const targets = resultTargets(rows, today, Date.now(), force)
  if (targets.length === 0) return done(0)

  const read = await readResults(targets, (endpointId, params) => ttsCall(context, endpointId, params), today, { maxCalls: MAX_CALLS })
  if (read.failure) warnThrottled(`[bookings] results:${projectId}`, `[bookings] Syncing booking results for ${projectId}: ${read.failure}`)

  // Each figure with the video and start day it was read for: a booking changed meanwhile is not written (result-writes.ts).
  const asRead = new Map(targets.map((row) => [row.id, { videoId: row.videoId, startOn: row.startOn }]))
  const written = [...read.figures].flatMap(([id, figures]) => {
    const was = asRead.get(id)
    return was && was.videoId ? [{ id, ...figures, ...was }] : []
  })
  const at = new Date()
  for (let i = 0; i < written.length; i += RESULT_CHUNK) await db.execute(resultUpdateStatement(projectId, written.slice(i, i + RESULT_CHUNK), at))
  const allFailed = written.length > 0 && written.every((row) => row.note === 'error')
  return done(written.length, allFailed ? 'failed' : null)
}

/**
 * Starts the project's sync, or joins the one running. `force` reads every
 * booking whose figures can still move, however recently it was synced.
 */
export function startResultSync(projectId: string, force = false): Promise<SyncOutcome> {
  const state = stateOf(projectId)
  if (state.running) return state.running
  state.startedAt = Date.now()
  const running = run(projectId, force)
    .catch((error): SyncOutcome => {
      warnThrottled(`[bookings] results:${projectId}`, `[bookings] Syncing booking results for ${projectId}: ${reasonOf(error)}`)
      return { at: Date.now(), updated: 0, reason: 'failed' }
    })
    .then((outcome) => {
      state.last = outcome
      state.running = null
      return outcome
    })
  state.running = running
  return running
}

export type SyncState = { running: boolean; last: SyncOutcome | null }

export function resultSyncState(projectId: string): SyncState {
  const state = stateOf(projectId)
  return { running: Boolean(state.running), last: state.last }
}

/**
 * Whether a sync is due, judged from the memory of the last one — or, after
 * a restart, from the rows' own sync times: the most recent of them standing
 * in for the last sync, and any booking with a video never synced making it
 * due sooner.
 */
export function resultSyncDue(
  projectId: string,
  rows: ReadonlyArray<{ status: string; videoId: string | null; bookedOn: string; airedOn: string | null; resultSource: string | null; resultSyncedAt: string | null }>,
  now = Date.now(),
): boolean {
  const state = stateOf(projectId)
  if (state.running) return false
  // A booking whose figures start after today has nothing to read yet.
  const today = vnDate(new Date(now))
  const syncable = rows.filter((row) => row.status !== 'cancelled' && row.videoId && row.resultSource !== 'manual' && (row.airedOn ?? row.bookedOn) <= today)
  if (syncable.length === 0) return false
  const lastRun = state.last?.at ?? Math.max(0, ...syncable.map((row) => (row.resultSyncedAt ? Date.parse(row.resultSyncedAt) : 0)))
  const age = now - lastRun
  if (age >= DUE_MS) return true
  return age >= UNSYNCED_DUE_MS && syncable.some((row) => !row.resultSyncedAt && row.resultSource === null)
}

/** For the page: starts a sync in the background when one is due; whether one is running now. */
export function syncResultsIfDue(projectId: string, rows: Parameters<typeof resultSyncDue>[1]): boolean {
  if (resultSyncDue(projectId, rows)) void startResultSync(projectId)
  return resultSyncState(projectId).running
}

/** For the background rounds: a project's sync when due, judged from its rows. */
export async function syncResultsInBackground(projectId: string): Promise<void> {
  const rows = await db
    .select({ status: bookings.status, videoId: bookings.videoId, bookedOn: bookings.bookedOn, airedOn: bookings.airedOn, resultSource: bookings.resultSource, resultSyncedAt: bookings.resultSyncedAt })
    .from(bookings)
    .where(and(eq(bookings.projectId, projectId), isNotNull(bookings.videoId)))
  const due = resultSyncDue(
    projectId,
    rows.map((row) => ({ ...row, resultSyncedAt: row.resultSyncedAt?.toISOString() ?? null })),
  )
  if (due) await startResultSync(projectId)
}
