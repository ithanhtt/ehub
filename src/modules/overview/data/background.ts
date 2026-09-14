import 'server-only'

import { dashboardSapoContexts } from './overview'
import { syncSapoInBackground } from './sapo'

/**
 * Keeps the dashboard's Sapo figures in sync on the server, whether or not
 * anyone is looking — started once with the server (src/instrumentation.ts).
 *
 * Every ROUND_MS, each project's Sapo connection gets one round (see
 * syncSapoInBackground): what changed since the last round, today's orders,
 * and the recent days filled in and kept fresh. Opening the dashboard then
 * finds them ready instead of starting the fetch. Someone watching makes the
 * page's own reads run the live figures every few seconds on top of this.
 *
 * One round at a time; a store whose round is still going (a long first
 * catch-up) is skipped until it ends, and a failing store never holds up the
 * others. On by default only on the server (see backgroundSyncEnabled).
 */

/** Between rounds. The ledger read in each costs one small call when nothing changed. */
const ROUND_MS = 60_000
/** After the server starts, so the first requests are not competing with it. */
const START_DELAY_MS = 15_000

type Runner = { timer: NodeJS.Timeout | null; busy: Set<string>; stopped: boolean }

const globalRunner = globalThis as unknown as { __adshubBackgroundSync?: Runner }

/**
 * On by default on the server (a production build), off under `npm run dev`:
 * a development machine syncing too would spend the same store's call budget
 * as the server. SAPO_BACKGROUND_SYNC=1 or =0 decides either way.
 */
export function backgroundSyncEnabled(): boolean {
  const setting = process.env.SAPO_BACKGROUND_SYNC?.trim() ?? ''
  if (/^(1|true|yes|on)$/i.test(setting)) return true
  if (/^(0|false|no|off)$/i.test(setting)) return false
  return process.env.NODE_ENV === 'production'
}

async function round(runner: Runner) {
  let contexts
  try {
    contexts = await dashboardSapoContexts()
  } catch (error) {
    console.warn('[sync] Sapo connections unavailable:', error instanceof Error ? error.message : error)
    return
  }
  await Promise.all(
    contexts.map(async (context) => {
      if (runner.busy.has(context.connectionId)) return
      runner.busy.add(context.connectionId)
      try {
        await syncSapoInBackground(context)
      } catch (error) {
        console.warn(`[sync] Sapo ${context.connectionId}:`, error instanceof Error ? error.message : error)
      } finally {
        runner.busy.delete(context.connectionId)
      }
    }),
  )
}

export function startBackgroundSync() {
  if (!backgroundSyncEnabled()) return
  // A dev reload starts it again: the one already running is stopped first.
  const previous = globalRunner.__adshubBackgroundSync
  if (previous) {
    previous.stopped = true
    if (previous.timer) clearTimeout(previous.timer)
  }
  const runner: Runner = { timer: null, busy: previous?.busy ?? new Set(), stopped: false }
  globalRunner.__adshubBackgroundSync = runner

  const next = (delay: number) => {
    if (runner.stopped) return
    runner.timer = setTimeout(() => {
      // The next round is timed from the end of this one: rounds never pile up.
      void round(runner).finally(() => next(ROUND_MS))
    }, delay)
    runner.timer.unref()
  }
  next(START_DELAY_MS)
}
