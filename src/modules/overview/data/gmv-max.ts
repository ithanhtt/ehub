import 'server-only'

import { buildQueryString } from '@/core/plugins/http'
import type { ConnectionContext } from '@/core/plugins/types'
import { dayStore, settlingFreshness, type DayRead } from '@/modules/analytics/data/day-store'
import { BASE_URL, authHeaders } from '@/plugins/tiktok-ads/context'
import { sendPatiently, type RequestPriority } from '@/plugins/tiktok-ads/gmv-max'
import { memo } from './cache'
import {
  addRow,
  assembleRows,
  composeDays,
  composeHours,
  composeToday,
  copy,
  dayOf,
  readSpanFor,
  settleGaps,
  zero,
  type GmvDay,
  type GmvPair,
  type Live,
  type Row,
} from './gmv-max-compose'
import { daysBetween, shiftDay, vnDate, type Period } from './period'
import { pairKey, selectionKey, selectionOf } from './selection'
import type { Failure, GmvMaxOverview, GmvMaxTotals } from './types'

export type { GmvPair } from './gmv-max-compose'

/**
 * GMV Max spend and revenue across the shops a TikTok connection runs it for
 * — all of them, or the ones chosen for this project's dashboard — as close
 * to live as TikTok allows.
 *
 * Three reads, on three clocks, because TikTok serves them at different
 * speeds (measured on a live account) and most of a view does not move:
 *
 *  · Today's running total per shop — a report with no time dimension —
 *    moves about once a minute. It is re-read every 25 seconds and drives the
 *    headline numbers and the last point of every chart.
 *  · Today's hour-by-hour and day breakdown lags about an hour. It is re-read
 *    every five minutes and draws the shape behind that last point.
 *  · Every earlier day is kept on disk, per shop (gmvDays below): its row in
 *    the daily report and its rows in the hourly one. A day is read once it
 *    has settled and then never again; the last few days, which TikTok still
 *    attributes orders to, are read again every quarter hour. A 30-day view
 *    therefore costs today's reads, not sixty days of reports every five
 *    minutes, and survives a restart. Days not kept yet are filled in behind
 *    the response — the view says how many are on their way (`pendingDays`)
 *    and never passes a short sum off as a whole one (gmv-max-compose.ts).
 *
 * Today's chart is cumulative: the hours TikTok has broken down, then a
 * straight run to the live total now. Hours it has not broken down yet stay
 * empty rather than being guessed, so every point on the line is a figure
 * TikTok reported.
 *
 * The report endpoint answers for one advertiser and one shop at a time, and
 * only for the advertiser that holds the shop's GMV Max rights
 * (`is_gmv_max_available`). TikTok also requires a "main" dimension beside
 * the time one, so reports group by `advertiser_id`.
 */

const METRICS = ['cost', 'gross_revenue', 'orders']
const STORE_TTL = 30 * 60_000
const SERIES_TTL = 5 * 60_000
const LIVE_TTL = 25_000
/**
 * How long past its TTL a read is still shown while a fresh one runs behind
 * it (cache.ts): the page answers at once, and the numbers catch up on its
 * next refresh. A sweep that lost some of its reads is retried after
 * RETRY_TTL instead of its full TTL.
 */
const STORE_STALE = 6 * 3600_000
const SERIES_STALE = 30 * 60_000
const LIVE_STALE = 5 * 60_000
const RETRY_TTL = 30_000
const retrySoon = (ttl: number) => (value: { failures: Failure[] }) => (value.failures.length > 0 ? Math.min(ttl, RETRY_TTL) : ttl)
const CONCURRENCY = 4

async function get(context: ConnectionContext, path: string, params: Record<string, unknown>, priority: RequestPriority = 'interactive') {
  const response = await sendPatiently(
    {
      url: `${BASE_URL}${path}${buildQueryString(params)}`,
      method: 'GET',
      headers: authHeaders(context),
    },
    { priority },
  )
  const body = response.data as { code?: number; message?: string; data?: Record<string, unknown> } | null
  if (!response.ok || !body || body.code !== 0) {
    throw new Error(body?.message ? `TikTok ${body.code}: ${body.message}` : (response.error ?? 'TikTok request failed'))
  }
  return body.data ?? {}
}

async function pool<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await run(items[i])
      }
    }),
  )
  return out
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function advertisersOf(metadata: Record<string, unknown>): Array<{ id: string; name: string }> {
  const list = Array.isArray(metadata.advertisers) ? metadata.advertisers : []
  return list.flatMap((item) =>
    item && typeof item === 'object' && 'id' in item
      ? [{ id: String((item as { id: unknown }).id), name: String((item as { name?: unknown }).name ?? '') }]
      : [],
  )
}

/**
 * Every (advertiser, shop) pair that can report GMV Max, with any advertiser
 * whose shop list could not be read. Failures are part of the cached value,
 * so every caller sees them — not only the one that triggered the sweep.
 */
export function listGmvPairs(context: ConnectionContext): Promise<{ pairs: GmvPair[]; failures: Failure[] }> {
  return memo(`gmv-pairs:${context.connectionId}`, STORE_TTL, async () => {
    const failures: Failure[] = []
    const lists = await pool(advertisersOf(context.metadata), async (a) => {
      try {
        const data = await get(context, '/gmv_max/store/list/', { advertiser_id: a.id })
        const stores = Array.isArray(data.store_list) ? (data.store_list as Array<Record<string, unknown>>) : []
        return stores
          .filter((s) => s.is_gmv_max_available === true)
          .map((s) => ({
            advertiserId: a.id,
            advertiserName: a.name,
            storeId: String(s.store_id),
            storeName: String(s.store_name ?? s.store_id),
            bcId: String(s.store_authorized_bc_id ?? ''),
          }))
      } catch (error) {
        failures.push({ source: a.name || a.id, message: messageOf(error) })
        return []
      }
    })
    return { pairs: lists.flat(), failures }
  }, { staleMs: STORE_STALE, ttlOf: retrySoon(STORE_TTL) })
}

/** The pairs the project's dashboard counts: all of them, or the ones chosen (selection.ts). */
async function chosenPairs(context: ConnectionContext) {
  const selected = selectionOf(context.metadata).gmvStores
  const { pairs: all, failures } = await listGmvPairs(context)
  const pairs = selected ? all.filter((p) => selected.includes(pairKey(p.advertiserId, p.storeId))) : all
  return { all, pairs, failures, selection: selectionKey(selected) }
}

/**
 * One shop's GMV Max report from `start` to `end`, by day or by hour. TikTok
 * answers an hourly report for one day at most ("max time span is 1 day when
 * use 'stat_time_hour'"), so a longer hourly span is asked for day by day, in
 * order — the rows come back as one report over the span would list them.
 */
async function report(context: ConnectionContext, pair: GmvPair, start: string, end: string, hourly: boolean, priority: RequestPriority = 'interactive'): Promise<Row[]> {
  if (hourly && start < end) {
    const rows: Row[] = []
    for (const day of daysBetween(start, end)) rows.push(...(await report(context, pair, day, day, true, priority)))
    return rows
  }
  const rows: Row[] = []
  for (let page = 1; ; page++) {
    const data = await get(
      context,
      '/gmv_max/report/get/',
      {
        advertiser_id: pair.advertiserId,
        store_ids: [pair.storeId],
        start_date: start,
        end_date: end,
        dimensions: ['advertiser_id', hourly ? 'stat_time_hour' : 'stat_time_day'],
        metrics: METRICS,
        page,
        page_size: 1000,
      },
      priority,
    )
    rows.push(...(Array.isArray(data.list) ? (data.list as Row[]) : []))
    const info = (data.page_info ?? {}) as { total_page?: number }
    if (page >= Number(info.total_page ?? 1)) return rows
  }
}

/* ------------------------------------------------------------- live read --- */

/**
 * Holds a running total steady against one stale read.
 *
 * TikTok occasionally answers with an older total — measured: 58.08M, then
 * 58.01M a minute later, then 58.17M. Shown as-is, the live counter would
 * tick backwards and forwards. A lower figure is therefore held back until a
 * second read in a row confirms it, so a real drop (a refund) still shows,
 * about fifty seconds later, while a replica's stale answer never does.
 */
const steadyMemory = ((globalThis as unknown as {
  __adshubGmvSteady?: Map<string, { day: string; totals: GmvMaxTotals; lower: number }>
}).__adshubGmvSteady ??= new Map())

function steady(key: string, day: string, fresh: GmvMaxTotals): GmvMaxTotals {
  const previous = steadyMemory.get(key)
  const grew =
    !previous ||
    previous.day !== day ||
    (fresh.cost >= previous.totals.cost && fresh.revenue >= previous.totals.revenue && fresh.orders >= previous.totals.orders)
  if (grew || previous.lower >= 1) {
    steadyMemory.set(key, { day, totals: copy(fresh), lower: 0 })
    return fresh
  }
  previous.lower += 1
  return copy(previous.totals)
}

function loadLive(context: ConnectionContext, pairs: GmvPair[], selection: string, today: string): Promise<Live> {
  return memo(`gmv-live:${context.connectionId}:${selection}:${today}`, LIVE_TTL, async () => {
    const failures: Failure[] = []
    const totals = new Map<string, GmvMaxTotals>()
    const raise = (key: string, value: GmvMaxTotals) => {
      totals.set(key, copy(value))
      steadyMemory.set(`${context.connectionId}:${key}`, { day: today, totals: copy(value), lower: 0 })
    }
    await pool(pairs, async (pair) => {
      const key = pairKey(pair.advertiserId, pair.storeId)
      try {
        const data = await get(context, '/gmv_max/report/get/', {
          advertiser_id: pair.advertiserId,
          store_ids: [pair.storeId],
          start_date: today,
          end_date: today,
          dimensions: ['advertiser_id'],
          metrics: METRICS,
          page_size: 10,
        })
        const fresh = zero()
        for (const row of Array.isArray(data.list) ? (data.list as Row[]) : []) addRow(fresh, row)
        totals.set(key, steady(`${context.connectionId}:${key}`, today, fresh))
      } catch (error) {
        failures.push({ source: pair.storeName, message: messageOf(error) })
      }
    })
    return { totals, at: Date.now(), failures, raise }
  }, { staleMs: LIVE_STALE, ttlOf: retrySoon(LIVE_TTL) })
}

/** For a view that ends before today: nothing live to read, everything is in the reports. */
const noLive = (): Live => ({ totals: new Map(), at: Date.now(), failures: [], raise: () => {} })

/* ------------------------------------------------------- today's breakdown --- */

/**
 * One shop's report rows for today — by hour, or its one daily row — on the
 * five-minute clock. Kept per shop, so a change of the dashboard's shop
 * choice reads only the shops added, and the today view and a longer one
 * share today's hours. A read that failed is carried as such (its rows empty,
 * as a sweep with a failed shop always showed it) and asked again after
 * RETRY_TTL.
 */
function loadToday(context: ConnectionContext, pair: GmvPair, today: string, hourly: boolean): Promise<{ rows: Row[]; failure: Failure | null }> {
  const key = pairKey(pair.advertiserId, pair.storeId)
  return memo(
    `gmv-today:${context.connectionId}:${key}:${today}:${hourly ? 'hour' : 'day'}`,
    SERIES_TTL,
    async () => {
      try {
        return { rows: await report(context, pair, today, today, hourly), failure: null }
      } catch (error) {
        return { rows: [] as Row[], failure: { source: pair.storeName, message: messageOf(error) } }
      }
    },
    { staleMs: SERIES_STALE, ttlOf: (value) => (value.failure ? RETRY_TTL : SERIES_TTL) },
  )
}

/* ------------------------------------------------------------ kept days --- */

/**
 * The days still settling. TikTok keeps attributing orders to a day's ads for
 * a while after it (and its spend lags by hours), so the last SETTLE_DAYS full
 * days are read again every RECENT_MS; a day older than that is read once
 * after it settled and kept. Conservative on purpose: a day kept too early
 * would stay short for good, a day re-read too long costs one small report.
 */
const SETTLE_DAYS = 3
const RECENT_MS = 15 * 60_000
/**
 * How far back days are kept: the longest custom view reaches CUSTOM_LOOKBACK_DAYS
 * back and its comparison period CUSTOM_MAX_DAYS before that (period.ts).
 */
const KEEP_DAYS = 280
/** A span read for one day serves every other day of the span read in the same burst (a backfill, a re-read of the settling days). */
const SPAN_TTL = 2 * 60_000
const SPAN_FAILED_TTL = 30_000
/** How long a view waits for days it has nothing kept for, before answering with what it has and the rest pending. */
const DAYS_WAIT_MS = 5_000
const DAYS_POLL_MS = 250

/**
 * Which shop a context handed to the day store is for. The store keeps one
 * file per (advertiser, shop) pair — its scope (day-store.ts, scopeOf) — so a
 * change of the dashboard's shop choice never re-reads a shop already kept,
 * and two shops' figures can never mix. The pair rides on the context's
 * metadata, under a key nothing else uses, because the store hands its
 * compute only a context and a day.
 */
const PAIR_FIELD = '__gmvDayPair'
const withPair = (context: ConnectionContext, pair: GmvPair): ConnectionContext => ({ ...context, metadata: { ...context.metadata, [PAIR_FIELD]: pair } })
const pairOf = (context: ConnectionContext) => (context.metadata[PAIR_FIELD] ?? null) as GmvPair | null

/**
 * The daily and the hourly report over one span of days, for one shop (see
 * readSpanFor). Every day of a span that is being filled in or refreshed
 * together shares the one read; a read that failed fails the whole span at
 * once, instead of each of its days trying again in turn. Background priority
 * (plugins/tiktok-ads/gmv-max.ts): nothing waits on it the way a page waits on
 * today's figures.
 */
function readSpan(context: ConnectionContext, pair: GmvPair, from: string, to: string): Promise<{ daily: Row[]; hourly: Row[] }> {
  const key = pairKey(pair.advertiserId, pair.storeId)
  return memo(
    `gmv-span:${context.connectionId}:${key}:${from}:${to}`,
    SPAN_TTL,
    async () => {
      try {
        const daily = await report(context, pair, from, to, false, 'background')
        const hourly = await report(context, pair, from, to, true, 'background')
        return { daily, hourly, error: null as string | null }
      } catch (error) {
        return { daily: [] as Row[], hourly: [] as Row[], error: messageOf(error) }
      }
    },
    { ttlOf: (value) => (value.error ? SPAN_FAILED_TTL : SPAN_TTL) },
  ).then((value) => {
    if (value.error) throw new Error(value.error)
    return value
  })
}

/** GMV Max per shop per day, kept on disk (.data/cache/gmv-days-{connection}-{advertiser}_{shop}.json). */
const gmvDays = dayStore<GmvDay>({
  name: 'gmv-days',
  version: 1,
  keepDays: KEEP_DAYS,
  scopeOf: (context) => {
    const pair = pairOf(context)
    return pair ? `${pair.advertiserId}_${pair.storeId}` : ''
  },
  isFresh: settlingFreshness({ todayMs: SERIES_TTL, recentMs: RECENT_MS, settleDays: SETTLE_DAYS }),
  workers: 2,
  async compute(context, day) {
    const pair = pairOf(context)
    if (!pair) throw new Error('No GMV Max shop given')
    const span = readSpanFor(day, vnDate(new Date()), SETTLE_DAYS + 1)
    const { daily, hourly } = await readSpan(context, pair, span.from, span.to)
    return dayOf(daily, hourly, day)
  },
})

/**
 * Each shop's kept days among `days`. Missing and outdated ones are queued
 * with the store's workers (which read them most recent first and save them
 * when done); when some are missing, the answer waits up to DAYS_WAIT_MS for
 * them — a span read fills a month at once, so a first visit usually gets
 * whole figures — and then goes with what it has, the rest pending.
 *
 * The store's own `wait` is not used: it reads the days it waits for outside
 * the workers, and those are saved only with a later write.
 */
async function keptDays(context: ConnectionContext, pairs: GmvPair[], days: string[]): Promise<Array<DayRead<GmvDay>>> {
  if (days.length === 0) return pairs.map(() => ({ values: {}, pendingDays: 0, failedDays: 0, error: null }))
  const readAll = () => Promise.all(pairs.map((pair) => gmvDays.read(withPair(context, pair), days)))
  let reads = await readAll()
  const until = Date.now() + DAYS_WAIT_MS
  while (reads.some((read) => read.pendingDays > 0) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, DAYS_POLL_MS))
    reads = await readAll()
  }
  return reads
}

/**
 * Queues the days a dashboard opens on — the last 30 and the 30 before them,
 * for the 30-day view and its comparison — for the shops the project counts,
 * without waiting for them: the background's warm-up (background.ts). The
 * store reads only what is missing or due, so a warm-up after the first costs
 * the settling days' one short report per shop.
 */
export async function warmGmvMaxDays(context: ConnectionContext): Promise<void> {
  const { pairs } = await chosenPairs(context)
  const today = vnDate(new Date())
  const days = daysBetween(shiftDay(today, -60), shiftDay(today, -1))
  await Promise.all(pairs.map((pair) => gmvDays.warm(withPair(context, pair), days)))
}

/* ------------------------------------------------------------- compose --- */

export async function gmvMaxOverview(context: ConnectionContext, period: Period): Promise<GmvMaxOverview> {
  const { all, pairs, failures: discovery, selection } = await chosenPairs(context)

  // Today is read from TikTok (live total, and its breakdown) only when the view reaches it; every other day is kept.
  const today = vnDate(new Date())
  const reachesToday = period.end === today
  const single = period.range === 'today'
  const currentDays = daysBetween(period.start, period.end).filter((day) => day !== today)
  const previousDays = daysBetween(period.previousStart, period.previousEnd)

  const [kept, todayHourly, todayDaily, live] = await Promise.all([
    keptDays(context, pairs, [...currentDays, ...previousDays]),
    Promise.all(pairs.map((pair) => (reachesToday ? loadToday(context, pair, today, true) : Promise.resolve({ rows: [] as Row[], failure: null })))),
    Promise.all(pairs.map((pair) => (reachesToday && !single ? loadToday(context, pair, today, false) : Promise.resolve({ rows: [] as Row[], failure: null })))),
    reachesToday ? loadLive(context, pairs, selection, today) : Promise.resolve(noLive()),
  ])

  const { perPair, hourly, missingCurrent, missingPrevious } = assembleRows({
    period,
    today,
    pairs,
    stored: kept.map((read) => read.values),
    todayDaily: todayDaily.map((read) => read.rows),
    todayHourly: todayHourly.map((read) => read.rows),
  })

  // Today's breakdown failing is reported as the report sweep's failures always were: the hours for the today
  // view, the day's row for a longer one (whose hours card, as before, goes without).
  const todayFailures = (single ? todayHourly : todayDaily).flatMap((read) => (read.failure ? [read.failure] : []))
  const keptFailures = pairs.flatMap((pair, i) => (kept[i].error && kept[i].failedDays > 0 ? [{ source: pair.storeName, message: kept[i].error! }] : []))
  const failures = dedupe([...discovery, ...todayFailures, ...keptFailures, ...live.failures])

  // Days some shop is still waiting on, of the view and of its comparison period. When every missing day is
  // one whose read failed, nothing is on its way (the failure says why): the page then stops asking quickly.
  const missing = missingCurrent.size + missingPrevious.size
  const pending = kept.reduce((sum, read) => sum + read.pendingDays, 0)
  const pendingDays = Math.min(missing, pending)

  const series = { perPair, failures: [] }
  const composed = settleGaps(single ? composeToday(period, series, live) : composeDays(period, series, live), period, missingCurrent, missingPrevious)
  return {
    currency: 'VND',
    scope: { selected: pairs.length, total: all.length },
    fetchedAt: new Date(live.at).toISOString(),
    failures,
    ...composed,
    hours: composeHours(period, hourly, composed.totals, composed.dataThrough, missingCurrent),
    // Read beside this one (overview.ts), so the headline is not held up by the per-product reports.
    products: { items: [], hourly: false, total: 0, failures: [] },
    pendingDays,
  }
}

function dedupe(failures: Failure[]): Failure[] {
  const seen = new Set<string>()
  return failures.filter((failure) => {
    const key = `${failure.source}\u0000${failure.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
