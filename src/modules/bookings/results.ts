import type { BookingResultNote, BookingResultSource, BookingStatus } from '@/core/db/schema/bookings'
import { money, list } from '@/modules/analytics/data/tiktok-shop-ledger'
import { shiftDay } from '@/modules/analytics/period'

/**
 * What a booked video brought in — its orders ("Số đơn ra") and its revenue
 * ("Doanh thu quy KOC") since it aired — read from TikTok Shop's video
 * analytics. Nothing here touches the database or the network: the reads go
 * through a `call` handed in (ttsCall in features/bookings/sync.ts, a fake in
 * scripts/check-plugins.ts), so the whole plan can be checked offline.
 *
 * TikTok has two ways to ask, and neither is enough alone:
 *
 *   analytics-shop-videos  every video with activity in a date range, with
 *                          its SKU orders and GMV over that range — sorted
 *                          by GMV, 100 a page
 *   analytics-video        one video's GMV over a range (granularity ALL) —
 *                          but no order count
 *
 * So the bookings are grouped by the day their figures start (the air date,
 * else the booking date), and for each such day the list is read over
 * [that day, tomorrow) page by page until every booked video of the group
 * has turned up. A list that ends without a video means it sold nothing: a
 * real 0. A list still going when the page cap is reached leaves the videos
 * not seen yet to be read one by one — their revenue only, their orders left
 * unknown (note 'not_found'). A range the list refuses as too long is read in
 * windows of WINDOW_DAYS and summed.
 *
 * The app lacking the analytics scope (TikTok 105005) is noted ('no_scope')
 * and the figures kept as they were; any other failure is noted ('error'),
 * figures kept too, and the next sync tries again.
 */

export type ResultCall = (endpointId: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>

/** Pages of the video list read per start day before the rest of its videos are asked for one by one. */
export const LIST_PAGE_CAP = 20

/** The longest range read in one ask, when TikTok refuses a longer one. */
export const WINDOW_DAYS = 30

/** A booking that aired this long ago … */
export const SETTLED_AFTER_DAYS = 90
/** … and was last synced once it was this old has figures that no longer move: it is not read again. */
export const SETTLED_SYNC_AGE_DAYS = 30

/** A booking as the sync needs it. */
export type ResultRow = {
  id: string
  status: BookingStatus
  videoId: string | null
  bookedOn: string
  airedOn: string | null
  resultSource: BookingResultSource | null
  /** ISO time, or null when never synced. */
  resultSyncedAt: string | null
}

/** A booking to read: its video, and the day its figures start. */
export type ResultTarget = { id: string; videoId: string; startOn: string }

/** What a sync found for a booking. `keep` leaves its figures as they were and only records the note. */
export type ResultFigures = { orders: number | null; revenue: number | null; note: BookingResultNote | null; keep: boolean }

/** 2026-09-12T03:00:00Z → 2026-09-12 in Vietnam, where the booking dates are. */
const vnDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10)

/**
 * How long a synced figure stands before it is read again: a video's first
 * week moves by the hour, its first month by the day, an older one barely.
 */
export function resyncAfterMs(startOn: string, today: string): number {
  if (startOn >= shiftDay(today, -7)) return 30 * 60_000
  if (startOn >= shiftDay(today, -30)) return 2 * 3600_000
  return 6 * 3600_000
}

/**
 * The bookings a sync reads, the longest-unsynced first: those with a video,
 * not cancelled, not holding figures a booker typed, whose figures can still
 * move — and, unless `force`, not synced too recently for their age.
 */
export function resultTargets(rows: readonly ResultRow[], today: string, now: number, force = false): ResultTarget[] {
  const out: Array<ResultTarget & { syncedAt: number }> = []
  for (const row of rows) {
    if (row.status === 'cancelled' || !row.videoId || row.resultSource === 'manual') continue
    const startOn = row.airedOn ?? row.bookedOn
    if (startOn > today) continue
    const syncedAt = row.resultSyncedAt ? Date.parse(row.resultSyncedAt) : 0
    if (row.resultSyncedAt && startOn < shiftDay(today, -SETTLED_AFTER_DAYS) && vnDay(row.resultSyncedAt) >= shiftDay(startOn, SETTLED_SYNC_AGE_DAYS)) continue
    if (!force && syncedAt && now - syncedAt < resyncAfterMs(startOn, today)) continue
    out.push({ id: row.id, videoId: row.videoId, startOn, syncedAt })
  }
  return out.sort((a, b) => a.syncedAt - b.syncedAt).map(({ syncedAt: _syncedAt, ...target }) => target)
}

/** Whether TikTok refused a read for its date range (too long, too far back) rather than for anything else. */
export const isRangeError = (message: string) => /\b(date|range|days?|period|interval|start_date_ge|end_date_lt)\b/i.test(message) && !/\b105005\b/.test(message)

const isDenied = (message: string) => /\b105005\b/.test(message)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** [from, to) cut into windows of at most WINDOW_DAYS. */
export function windowsOf(from: string, to: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let start = from; start < to; start = shiftDay(start, WINDOW_DAYS)) {
    const end = shiftDay(start, WINDOW_DAYS)
    out.push([start, end < to ? end : to])
  }
  return out
}

type Scan = { found: Map<string, { orders: number; revenue: number }>; complete: boolean }

/** The video list over [from, to), paged until every wanted video has turned up, the list ends, or the cap is reached. */
async function scanList(call: ResultCall, from: string, to: string, wanted: ReadonlySet<string>, pageCap: number, budget: Budget): Promise<Scan> {
  const found = new Map<string, { orders: number; revenue: number }>()
  let token: string | undefined
  for (let page = 0; page < pageCap; page++) {
    budget.calls += 1
    const data = await call('analytics-shop-videos', { start_date_ge: from, end_date_lt: to, account_type: 'ALL', currency: 'LOCAL', page_size: 100, page_token: token })
    for (const video of list(data.videos)) {
      const id = String(video.id ?? '')
      if (wanted.has(id) && !found.has(id)) found.set(id, { orders: Number(video.sku_orders) || 0, revenue: Math.round(money(video.gmv)) })
    }
    if (found.size === wanted.size) return { found, complete: true }
    token = typeof data.next_page_token === 'string' && data.next_page_token ? data.next_page_token : undefined
    if (!token) return { found, complete: true }
  }
  return { found, complete: false }
}

/** The list over [from, to), in windows when TikTok refuses the range whole; the figures summed per video. */
async function readList(call: ResultCall, from: string, to: string, wanted: ReadonlySet<string>, pageCap: number, budget: Budget) {
  try {
    const scan = await scanList(call, from, to, wanted, pageCap, budget)
    return { found: scan.found, unknown: scan.complete ? new Set<string>() : new Set([...wanted].filter((id) => !scan.found.has(id))) }
  } catch (error) {
    if (!isRangeError(messageOf(error)) || windowsOf(from, to).length < 2) throw error
  }
  const found = new Map<string, { orders: number; revenue: number }>()
  const unknown = new Set<string>()
  for (const [start, end] of windowsOf(from, to)) {
    const scan = await scanList(call, start, end, wanted, pageCap, budget)
    for (const [id, figures] of scan.found) {
      const sum = found.get(id) ?? { orders: 0, revenue: 0 }
      found.set(id, { orders: sum.orders + figures.orders, revenue: sum.revenue + figures.revenue })
    }
    if (!scan.complete) for (const id of wanted) if (!scan.found.has(id)) unknown.add(id)
  }
  return { found, unknown }
}

/** One video's GMV over [from, to), from its own analytics — in windows when the range is refused whole. */
async function readVideoRevenue(call: ResultCall, videoId: string, from: string, to: string, budget: Budget): Promise<number> {
  const once = async (start: string, end: string) => {
    budget.calls += 1
    const data = await call('analytics-video', { video_id: videoId, start_date_ge: start, end_date_lt: end, granularity: 'ALL', currency: 'LOCAL' })
    const intervals = list(((data.performance ?? {}) as Record<string, unknown>).intervals)
    return intervals.reduce((sum, interval) => {
      const overall = (((interval.sales ?? {}) as Record<string, unknown>).overall ?? {}) as Record<string, unknown>
      return sum + money(overall.gmv)
    }, 0)
  }
  try {
    return Math.round(await once(from, to))
  } catch (error) {
    if (!isRangeError(messageOf(error)) || windowsOf(from, to).length < 2) throw error
  }
  let total = 0
  for (const [start, end] of windowsOf(from, to)) total += await once(start, end)
  return Math.round(total)
}

/** Calls made so far, against the most one sync may make. */
type Budget = { calls: number; max: number }

export type ResultRead = {
  /** By booking id; a booking left out was not reached (the call budget ran out) and keeps its last sync time. */
  figures: Map<string, ResultFigures>
  calls: number
  /** The first failure other than a missing scope, for the log. */
  failure: string | null
}

/**
 * Reads the figures of the targets, start day by start day (the oldest
 * synced first, as resultTargets orders them), until done or `maxCalls` is
 * spent — the next sync picks up the rest.
 */
export async function readResults(
  targets: readonly ResultTarget[],
  call: ResultCall,
  today: string,
  options: { pageCap?: number; maxCalls?: number } = {},
): Promise<ResultRead> {
  const pageCap = options.pageCap ?? LIST_PAGE_CAP
  const budget: Budget = { calls: 0, max: options.maxCalls ?? 400 }
  const tomorrow = shiftDay(today, 1)
  const figures = new Map<string, ResultFigures>()
  let failure: string | null = null

  // Start day → video → the bookings of it (one video may be booked twice).
  const groups = new Map<string, Map<string, string[]>>()
  for (const target of targets) {
    const group = groups.get(target.startOn) ?? new Map<string, string[]>()
    groups.set(target.startOn, group)
    group.set(target.videoId, [...(group.get(target.videoId) ?? []), target.id])
  }

  for (const [startOn, videos] of groups) {
    if (budget.calls >= budget.max) break
    const put = (videoId: string, value: ResultFigures) => {
      for (const id of videos.get(videoId) ?? []) figures.set(id, value)
    }
    const failed = (error: unknown, videoIds: Iterable<string>) => {
      const message = messageOf(error)
      const note: BookingResultNote = isDenied(message) ? 'no_scope' : 'error'
      if (note === 'error') failure ??= message
      for (const videoId of videoIds) put(videoId, { orders: null, revenue: null, note, keep: true })
    }

    let read: { found: Map<string, { orders: number; revenue: number }>; unknown: Set<string> }
    try {
      read = await readList(call, startOn, tomorrow, new Set(videos.keys()), pageCap, budget)
    } catch (error) {
      failed(error, videos.keys())
      continue
    }
    for (const videoId of videos.keys()) {
      const seen = read.found.get(videoId)
      if (seen) put(videoId, { orders: seen.orders, revenue: seen.revenue, note: null, keep: false })
      else if (!read.unknown.has(videoId)) put(videoId, { orders: 0, revenue: 0, note: null, keep: false })
    }
    for (const videoId of read.unknown) {
      if (budget.calls >= budget.max) break
      try {
        put(videoId, { orders: null, revenue: await readVideoRevenue(call, videoId, startOn, tomorrow, budget), note: 'not_found', keep: false })
      } catch (error) {
        failed(error, [videoId])
      }
    }
  }
  return { figures, calls: budget.calls, failure }
}
