import 'server-only'

import { and, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { connections } from '@/core/db/schema/connections'
import { reasonOf, warnThrottled } from '@/core/utils/log'
import { syncResultsInBackground } from './sync'

/**
 * Keeps the booking file's results (orders and revenue per booked video)
 * current on its own — no one has to open the page or press "sync".
 *
 * Every ROUND_MS, each project with a working TikTok Shop connection gets
 * its sync when one is due (sync.ts, syncResultsInBackground): a light check
 * that reads only what can still move — recent videos every half hour, older
 * ones less often, settled ones never — and bounds its calls per run. One
 * sync per project at a time, the page's own included: a page that asks while
 * this one runs joins it.
 *
 * Unlike the Sapo and report warm-ups (overview/data/background.ts), this is
 * on under `npm run dev` too: the results are few calls, and a team that runs
 * the app from one machine expects them to fill in. BOOKING_AUTO_SYNC=0 turns
 * it off.
 */

const ROUND_MS = 5 * 60_000
/** After the server starts, so the first requests are not competing with it. */
const START_DELAY_MS = 45_000

type Runner = { timer: NodeJS.Timeout | null; stopped: boolean; running: boolean }
const holder = globalThis as unknown as { __adshubBookingAutoSync?: Runner }

export function bookingAutoSyncEnabled(): boolean {
  return !/^(0|false|no|off)$/i.test(process.env.BOOKING_AUTO_SYNC?.trim() ?? '')
}

/** The projects whose booking results can be read: those with a TikTok Shop connection that works. */
async function projectsWithShop(): Promise<string[]> {
  const rows = await db
    .select({ projectId: connections.projectId })
    .from(connections)
    .where(and(eq(connections.pluginId, 'tiktok-shop'), eq(connections.status, 'connected')))
  return [...new Set(rows.map((row) => row.projectId))]
}

async function round() {
  let projects: string[]
  try {
    projects = await projectsWithShop()
  } catch (error) {
    warnThrottled('[bookings] auto-sync projects', `[bookings] auto-sync: connections unavailable: ${reasonOf(error)}`)
    return
  }
  // One project after another: each sync is bounded, and the TikTok Shop app's call budget is shared.
  for (const projectId of projects) {
    await syncResultsInBackground(projectId).catch((error) =>
      warnThrottled(`[bookings] auto-sync:${projectId}`, `[bookings] auto-sync ${projectId}: ${reasonOf(error)}`),
    )
  }
}

export function startBookingAutoSync() {
  if (!bookingAutoSyncEnabled()) return
  // A dev reload starts it again: the one already running is stopped first.
  const previous = holder.__adshubBookingAutoSync
  if (previous) {
    previous.stopped = true
    if (previous.timer) clearTimeout(previous.timer)
  }
  const runner: Runner = { timer: null, stopped: false, running: false }
  holder.__adshubBookingAutoSync = runner
  const next = (delay: number) => {
    if (runner.stopped) return
    runner.timer = setTimeout(() => {
      if (runner.running) return next(ROUND_MS)
      runner.running = true
      // The next round is timed from the end of this one: rounds never pile up.
      void round().finally(() => {
        runner.running = false
        next(ROUND_MS)
      })
    }, delay)
    runner.timer.unref()
  }
  next(START_DELAY_MS)
}
