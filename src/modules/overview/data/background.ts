import 'server-only'

import { reasonOf, warnThrottled } from '@/core/utils/log'
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
  // The reports' TikTok Shop days are kept warm the same way, without holding up the Sapo round.
  void warmReports(runner)

  let contexts
  try {
    contexts = await dashboardSapoContexts()
  } catch (error) {
    warnThrottled('[sync] Sapo connections unavailable', `[sync] Sapo connections unavailable: ${reasonOf(error)}`)
    return
  }
  await Promise.all(
    contexts.map(async (context) => {
      if (runner.busy.has(context.connectionId)) return
      runner.busy.add(context.connectionId)
      try {
        await syncSapoInBackground(context)
      } catch (error) {
        warnThrottled(`[sync] Sapo:${context.connectionId}`, `[sync] Sapo ${context.connectionId}: ${reasonOf(error)}`)
      } finally {
        runner.busy.delete(context.connectionId)
      }
    }),
  )
}

/** Rounds between TikTok Shop warm-ups: its days fill in behind a queue, so every ten minutes is plenty. */
const REPORT_EVERY_ROUNDS = 10
let reportRound = 0

/**
 * Queues the recent days the reports and the overview read — each TikTok Ads
 * connection's GMV Max days, each TikTok Shop connection's order days (see
 * analytics/data/tiktok-shop.ts) — one connection's failure never stopping the next.
 */
async function warmReports(runner: Runner) {
  if (reportRound++ % REPORT_EVERY_ROUNDS !== 0) return
  try {
    const [{ connectedContexts }, { warmTiktokShop }, { fileTodayTargets }, { warmGmvMaxDays }] = await Promise.all([
      import('@/modules/analytics/data/connections'),
      import('@/modules/analytics/data/tiktok-shop'),
      import('@/modules/analytics/data/gmv-max'),
      import('./gmv-max'),
    ])
    for (const context of await connectedContexts('tiktok-ads')) {
      // The overview's GMV Max days (overview/data/gmv-max.ts): queued, not waited for — they fill in behind,
      // at background priority, so the dashboard opens on days already kept.
      await warmGmvMaxDays(context).catch((error) =>
        warnThrottled(`[sync] GMV Max days:${context.connectionId}`, `[sync] GMV Max days ${context.connectionId}: ${reasonOf(error)}`),
      )
      // TikTok keeps no history of ROI targets: each round files today's (see analytics/data/gmv-max.ts).
      await fileTodayTargets(context).catch((error) =>
        warnThrottled(`[sync] GMV Max targets:${context.connectionId}`, `[sync] GMV Max targets ${context.connectionId}: ${reasonOf(error)}`),
      )
    }
    for (const context of await connectedContexts('tiktok-shop')) {
      const key = `tts:${context.connectionId}`
      if (runner.busy.has(key)) continue
      runner.busy.add(key)
      await warmTiktokShop(context)
        .catch((error) => warnThrottled(`[sync] TikTok Shop:${context.connectionId}`, `[sync] TikTok Shop ${context.connectionId}: ${reasonOf(error)}`))
        .finally(() => runner.busy.delete(key))
    }
  } catch (error) {
    warnThrottled('[sync] TikTok Shop connections unavailable', `[sync] TikTok Shop connections unavailable: ${reasonOf(error)}`)
  }
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
