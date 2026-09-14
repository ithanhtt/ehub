import 'server-only'

import { buildQueryString } from '@/core/plugins/http'
import type { ConnectionContext } from '@/core/plugins/types'
import { BASE_URL, authHeaders } from '@/plugins/tiktok-ads/context'
import { sendPatiently } from '@/plugins/tiktok-ads/gmv-max'
import { memo } from './cache'
import { daysBetween, shiftDay, vnDate, type Period } from './period'
import { pairKey, selectionKey, selectionOf } from './selection'
import type { Failure, GmvMaxOverview, GmvMaxTotals } from './types'

/**
 * GMV Max spend and revenue across the shops a TikTok connection runs it for
 * — all of them, or the ones chosen for this project's dashboard — as close
 * to live as TikTok allows.
 *
 * Two reads, on two clocks, because TikTok serves them at different speeds
 * (measured on a live account):
 *
 *  · Today's running total per shop — a report with no time dimension —
 *    moves about once a minute. It is re-read every 25 seconds and drives the
 *    headline numbers and the last point of every chart.
 *  · The hour-by-hour and day-by-day breakdown lags about an hour. It is
 *    re-read every five minutes and draws the shape behind that last point.
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
const CONCURRENCY = 4
const VN_OFFSET_MS = 7 * 3600_000

export type GmvPair = { advertiserId: string; advertiserName: string; storeId: string; storeName: string }
type Row = { dimensions?: Record<string, string>; metrics?: Record<string, string | number> }

const zero = (): GmvMaxTotals => ({ cost: 0, revenue: 0, orders: 0 })
const copy = (t: GmvMaxTotals): GmvMaxTotals => ({ cost: t.cost, revenue: t.revenue, orders: t.orders })

function addRow(target: GmvMaxTotals, row: Row) {
  target.cost += Number(row.metrics?.cost ?? 0)
  target.revenue += Number(row.metrics?.gross_revenue ?? 0)
  target.orders += Number(row.metrics?.orders ?? 0)
}

function add(target: GmvMaxTotals, other: GmvMaxTotals) {
  target.cost += other.cost
  target.revenue += other.revenue
  target.orders += other.orders
}

async function get(context: ConnectionContext, path: string, params: Record<string, unknown>) {
  const response = await sendPatiently({
    url: `${BASE_URL}${path}${buildQueryString(params)}`,
    method: 'GET',
    headers: authHeaders(context),
  })
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
          }))
      } catch (error) {
        failures.push({ source: a.name || a.id, message: error instanceof Error ? error.message : String(error) })
        return []
      }
    })
    return { pairs: lists.flat(), failures }
  })
}

async function report(context: ConnectionContext, pair: GmvPair, start: string, end: string, hourly: boolean): Promise<Row[]> {
  const rows: Row[] = []
  for (let page = 1; ; page++) {
    const data = await get(context, '/gmv_max/report/get/', {
      advertiser_id: pair.advertiserId,
      store_ids: [pair.storeId],
      start_date: start,
      end_date: end,
      dimensions: ['advertiser_id', hourly ? 'stat_time_hour' : 'stat_time_day'],
      metrics: METRICS,
      page,
      page_size: 1000,
    })
    rows.push(...(Array.isArray(data.list) ? (data.list as Row[]) : []))
    const info = (data.page_info ?? {}) as { total_page?: number }
    if (page >= Number(info.total_page ?? 1)) return rows
  }
}

/** A daily report may span at most 30 days (TikTok 40002): a longer span is read in pieces. */
async function reportSpan(context: ConnectionContext, pair: GmvPair, start: string, end: string, hourly: boolean): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = start; from <= end; from = shiftDay(from, 30)) {
    const last = shiftDay(from, 29)
    rows.push(...(await report(context, pair, from, last < end ? last : end, hourly)))
  }
  return rows
}

const timeOf = (row: Row) => String(row.dimensions?.stat_time_hour ?? row.dimensions?.stat_time_day ?? '')

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

type Live = {
  totals: Map<string, GmvMaxTotals>
  at: number
  failures: Failure[]
  /**
   * Adopts a fresher figure for a shop's today — the breakdown report is
   * sometimes a few seconds ahead of the running total (TikTok's replicas
   * disagree). Every view in this refresh window, and the next live read,
   * then start from it, so "today" is one number on every range.
   */
  raise: (key: string, totals: GmvMaxTotals) => void
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
        failures.push({ source: pair.storeName, message: error instanceof Error ? error.message : String(error) })
      }
    })
    return { totals, at: Date.now(), failures, raise }
  })
}

/** For a view that ends before today: nothing live to read, everything is in the reports. */
const noLive = (): Live => ({ totals: new Map(), at: Date.now(), failures: [], raise: () => {} })

/* ------------------------------------------------------ breakdown read --- */

type Series = { perPair: Array<{ pair: GmvPair; rows: Row[] }>; failures: Failure[] }

function loadSeries(context: ConnectionContext, pairs: GmvPair[], period: Period, selection: string): Promise<Series> {
  const hourly = period.range === 'today'
  const span = `${period.range}:${period.start}:${period.end}`
  return memo(`gmv-series:${context.connectionId}:${span}:${selection}`, SERIES_TTL, async () => {
    const failures: Failure[] = []
    const perPair = await pool(pairs, async (pair) => {
      try {
        // The period and the one before it are read separately, each in
        // pieces of at most 30 days (see reportSpan).
        const current = await reportSpan(context, pair, period.start, period.end, hourly)
        const before = await reportSpan(context, pair, period.previousStart, period.previousEnd, hourly)
        return { pair, rows: [...current, ...before] }
      } catch (error) {
        failures.push({ source: pair.storeName, message: error instanceof Error ? error.message : String(error) })
        return { pair, rows: [] as Row[] }
      }
    })
    return { perPair, failures }
  })
}

/* ------------------------------------------------------------- compose --- */

export async function gmvMaxOverview(context: ConnectionContext, period: Period): Promise<GmvMaxOverview> {
  const selected = selectionOf(context.metadata).gmvStores
  const selection = selectionKey(selected)
  const { pairs: all, failures: discovery } = await listGmvPairs(context)
  const pairs = selected ? all.filter((p) => selected.includes(pairKey(p.advertiserId, p.storeId))) : all

  // Today's running total is read only when the view reaches today.
  const today = vnDate(new Date())
  const [series, live] = await Promise.all([
    loadSeries(context, pairs, period, selection),
    period.end === today ? loadLive(context, pairs, selection, today) : Promise.resolve(noLive()),
  ])

  const failures = [...discovery, ...series.failures, ...live.failures]
  const base = { currency: 'VND', scope: { selected: pairs.length, total: all.length }, fetchedAt: new Date(live.at).toISOString(), failures }
  return period.range === 'today' ? { ...base, ...composeToday(period, series, live) } : { ...base, ...composeDays(period, series, live) }
}

type Composed = Pick<GmvMaxOverview, 'totals' | 'previous' | 'byTime' | 'previousByTime' | 'byStore' | 'dataThrough'>

function storeEntry(pair: GmvPair, totals: GmvMaxTotals): GmvMaxOverview['byStore'][number] {
  return { ...copy(totals), storeId: pair.storeId, storeName: pair.storeName, advertiserName: pair.advertiserName }
}

function composeToday(period: Period, series: Series, live: Live): Composed {
  const today = period.end
  const clock = new Date(Date.now() + VN_OFFSET_MS)
  const hourNow = clock.getUTCHours()
  const minuteShare = clock.getUTCMinutes() / 60

  const reported = Array.from({ length: 24 }, zero)
  const yesterday = Array.from({ length: 24 }, zero)
  const totals = zero()
  const byStore: GmvMaxOverview['byStore'] = []
  // The hour up to which every shop that spent today has been broken down.
  let through = 23
  let anySpend = false

  for (const { pair, rows } of series.perPair) {
    const own = zero()
    let latest = -1
    for (const row of rows) {
      const at = timeOf(row)
      const hour = Number(at.slice(11, 13))
      if (at.startsWith(today)) {
        addRow(reported[hour], row)
        addRow(own, row)
        if (Number(row.metrics?.cost ?? 0) > 0 && hour > latest) latest = hour
      } else if (at.startsWith(period.previousStart)) {
        addRow(yesterday[hour], row)
      }
    }
    // The live total is fresher; it is never allowed below what the hourly report already shows.
    const key = pairKey(pair.advertiserId, pair.storeId)
    const fresh = live.totals.get(key)
    const todayTotal = fresh && fresh.cost >= own.cost ? fresh : own
    if (todayTotal === own && own.cost > 0) live.raise(key, own)
    add(totals, todayTotal)
    byStore.push(storeEntry(pair, todayTotal))
    if (todayTotal.cost > 0) {
      anySpend = true
      through = Math.min(through, latest)
    }
  }
  if (!anySpend) through = hourNow - 1

  const running = zero()
  const byTime = period.buckets.map((at, hour) => {
    if (hour === hourNow) return { at, ...copy(totals) }
    if (hour <= through) {
      add(running, reported[hour])
      return { at, ...copy(running) }
    }
    return { at, cost: null, revenue: null, orders: null }
  })

  // Yesterday at the same time: its whole hours so far, plus the elapsed share of this hour.
  const previous = zero()
  for (let hour = 0; hour < hourNow; hour++) add(previous, yesterday[hour])
  previous.cost += yesterday[hourNow].cost * minuteShare
  previous.revenue += yesterday[hourNow].revenue * minuteShare
  previous.orders += yesterday[hourNow].orders * minuteShare

  // Yesterday's running total at each hour, for the comparison line; its last point is `previous` itself.
  const yesterdayRunning = zero()
  const previousByTime = period.buckets.map((_at, hour) => {
    if (hour === hourNow) return copy(previous)
    add(yesterdayRunning, yesterday[hour])
    return copy(yesterdayRunning)
  })

  return {
    totals,
    previous: series.perPair.length > 0 ? previous : null,
    byTime,
    previousByTime: series.perPair.length > 0 ? previousByTime : [],
    byStore: byStore.sort((a, b) => b.cost - a.cost),
    dataThrough: through >= 0 ? `${today} ${String(through).padStart(2, '0')}:00:00` : null,
  }
}

function composeDays(period: Period, series: Series, live: Live): Composed {
  const today = period.end
  const buckets = new Map(period.buckets.map((at) => [at, zero()]))
  const previousDays = daysBetween(period.previousStart, period.previousEnd)
  const previousBuckets = new Map(previousDays.map((day) => [day, zero()]))
  const totals = zero()
  const previous = zero()
  const byStore: GmvMaxOverview['byStore'] = []

  for (const { pair, rows } of series.perPair) {
    const days = new Map<string, GmvMaxTotals>()
    for (const row of rows) {
      const day = timeOf(row).slice(0, 10)
      if (buckets.has(day)) addRow((days.get(day) ?? days.set(day, zero()).get(day))!, row)
      else if (previousBuckets.has(day)) {
        addRow(previous, row)
        addRow(previousBuckets.get(day)!, row)
      }
    }
    // Today's column follows the live total, which is normally fresher than
    // the daily report; when the report is ahead, the live figure moves up to it.
    const key = pairKey(pair.advertiserId, pair.storeId)
    const fresh = live.totals.get(key)
    const reportedToday = days.get(today)
    if (fresh && fresh.cost >= (reportedToday?.cost ?? 0)) days.set(today, copy(fresh))
    else if (reportedToday && reportedToday.cost > 0) live.raise(key, reportedToday)

    const own = zero()
    for (const [day, value] of days) {
      add(buckets.get(day)!, value)
      add(own, value)
    }
    add(totals, own)
    byStore.push(storeEntry(pair, own))
  }

  return {
    totals,
    previous: series.perPair.length > 0 ? previous : null,
    byTime: period.buckets.map((at) => ({ at, ...buckets.get(at)! })),
    // Day i of the previous period sits under day i of this one.
    previousByTime: series.perPair.length > 0 ? previousDays.map((day) => copy(previousBuckets.get(day)!)) : [],
    byStore: byStore.sort((a, b) => b.cost - a.cost),
    dataThrough: null,
  }
}
