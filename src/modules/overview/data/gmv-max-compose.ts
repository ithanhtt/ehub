import { daysBetween, shiftDay, vnDate, type Period } from './period'
import { pairKey } from './selection'
import type { Failure, GmvMaxHours, GmvMaxOverview, GmvMaxTotals } from './types'

/**
 * How the GMV Max overview turns TikTok's report rows into what the page
 * draws — kept apart from the reads (gmv-max.ts), with nothing server-only in
 * it, so the same functions can be run over made-up rows and checked.
 *
 * The rows come from two places. Today's are read from TikTok as they always
 * were, a few minutes old at most. Every earlier day is kept on disk per shop
 * (GmvDay, gmv-max.ts): its row in the daily report and its rows in the hourly
 * one, exactly as TikTok listed them. Before composing, the kept days are
 * turned back into the rows they came from (rowsOfDay), in the order a single
 * report over the period would have listed them — so the sums below run in
 * the same order over the same numbers, and a view built from kept days is
 * figure for figure the view built from one long report.
 *
 * A day not kept yet is not a day without spend: the view says how many are
 * still on their way (`pendingDays`), draws that day as a gap, and leaves the
 * comparison out while any day of the period before is missing (settleGaps).
 */

const VN_OFFSET_MS = 7 * 3600_000

/** `bcId`: the Business Center the shop is authorised to (store_authorized_bc_id) — what the shop's product list is asked through. */
export type GmvPair = { advertiserId: string; advertiserName: string; storeId: string; storeName: string; bcId: string }
export type Row = { dimensions?: Record<string, string>; metrics?: Record<string, string | number> }

export const zero = (): GmvMaxTotals => ({ cost: 0, revenue: 0, orders: 0 })
export const copy = (t: GmvMaxTotals): GmvMaxTotals => ({ cost: t.cost, revenue: t.revenue, orders: t.orders })

export function addRow(target: GmvMaxTotals, row: Row) {
  target.cost += Number(row.metrics?.cost ?? 0)
  target.revenue += Number(row.metrics?.gross_revenue ?? 0)
  target.orders += Number(row.metrics?.orders ?? 0)
}

export function add(target: GmvMaxTotals, other: GmvMaxTotals) {
  target.cost += other.cost
  target.revenue += other.revenue
  target.orders += other.orders
}

export const timeOf = (row: Row) => String(row.dimensions?.stat_time_hour ?? row.dimensions?.stat_time_day ?? '')

export type Live = {
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

export type Series = { perPair: Array<{ pair: GmvPair; rows: Row[] }>; failures: Failure[] }

/* ------------------------------------------------------------ kept days --- */

/** Spend, revenue and orders as TikTok listed them in one row: [cost, gross_revenue, orders]. */
export type GmvFigures = [number, number, number]

/**
 * One shop's day as kept on disk: its row in the daily report and its rows in
 * the hourly one. Both are kept, not one summed from the other, because the
 * overview has always drawn days from the daily report and hours from the
 * hourly one — and TikTok's two need not agree to the đồng.
 */
export type GmvDay = {
  /** The daily report's row for the day; null when TikTok listed none (nothing spent or sold). */
  day: GmvFigures | null
  /** Hour of the day ("00"–"23") → the hourly report's row for it; an hour TikTok listed no row for is absent. */
  hours: Record<string, GmvFigures>
}

function accumulate(target: GmvFigures, row: Row) {
  target[0] += Number(row.metrics?.cost ?? 0)
  target[1] += Number(row.metrics?.gross_revenue ?? 0)
  target[2] += Number(row.metrics?.orders ?? 0)
}

/** One day out of a daily and an hourly report over a span that holds it. */
export function dayOf(dailyRows: Row[], hourlyRows: Row[], day: string): GmvDay {
  const out: GmvDay = { day: null, hours: {} }
  for (const row of dailyRows) {
    if (timeOf(row).slice(0, 10) !== day) continue
    accumulate((out.day ??= [0, 0, 0]), row)
  }
  for (const row of hourlyRows) {
    const at = timeOf(row)
    if (at.slice(0, 10) !== day) continue
    accumulate((out.hours[at.slice(11, 13)] ??= [0, 0, 0]), row)
  }
  return out
}

const rowOf = (dimension: string, at: string, [cost, revenue, orders]: GmvFigures): Row => ({
  dimensions: { [dimension]: at },
  metrics: { cost, gross_revenue: revenue, orders },
})

/** A kept day as the report rows it came from: the daily report's, or the hourly report's in hour order. */
export function rowsOfDay(day: string, value: GmvDay | undefined, hourly: boolean): Row[] {
  if (!value) return []
  if (!hourly) return value.day ? [rowOf('stat_time_day', `${day} 00:00:00`, value.day)] : []
  return Object.keys(value.hours)
    .sort()
    .map((hour) => rowOf('stat_time_hour', `${day} ${hour}:00:00`, value.hours[hour]))
}

/**
 * The span of days one read covers to fill `day` (gmv-max.ts, readSpan). The
 * days still settling — the last `recentDays` before today — are read
 * together, so keeping them fresh costs one short report, not one per day.
 * Older days are read in fixed 30-day windows (TikTok's longest daily report),
 * counted from a fixed first day, so every view, warm-up and re-read of those
 * days asks for exactly the same spans and shares their reads.
 */
export function readSpanFor(day: string, today: string, recentDays: number): { from: string; to: string } {
  if (day >= today) return { from: day, to: day }
  const recentFrom = shiftDay(today, -recentDays)
  if (day >= recentFrom) return { from: recentFrom, to: shiftDay(today, -1) }
  const EPOCH = '2024-01-01'
  const WINDOW = 30
  const offset = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`)) / 86_400_000)
  const from = shiftDay(EPOCH, Math.floor(offset / WINDOW) * WINDOW)
  const last = shiftDay(from, WINDOW - 1)
  const before = shiftDay(recentFrom, -1)
  return { from, to: last < before ? last : before }
}

/**
 * The rows the composers read, for one view: per shop, today's as read live
 * from TikTok and every other day's from what is kept — lined up as one report
 * over the view (and one over the period before) would have listed them — and
 * the days some shop has nothing kept for yet.
 *
 * `stored[i]`, `todayDaily[i]` and `todayHourly[i]` belong to `pairs[i]`.
 * The today view reads hours only, today's and yesterday's; a longer view the
 * days of both periods, and the hours of its own days for the hours card.
 */
export function assembleRows(input: {
  period: Period
  today: string
  pairs: GmvPair[]
  stored: Array<Record<string, GmvDay>>
  todayDaily: Row[][]
  todayHourly: Row[][]
}): { perPair: Series['perPair']; hourly: Row[]; missingCurrent: Set<string>; missingPrevious: Set<string> } {
  const { period, today, pairs, stored } = input
  const currentDays = daysBetween(period.start, period.end).filter((day) => day !== today)
  const previousDays = daysBetween(period.previousStart, period.previousEnd)
  const reachesToday = period.end === today
  const missingCurrent = new Set<string>()
  const missingPrevious = new Set<string>()
  pairs.forEach((_pair, i) => {
    for (const day of currentDays) if (!stored[i][day]) missingCurrent.add(day)
    for (const day of previousDays) if (!stored[i][day]) missingPrevious.add(day)
  })

  if (period.range === 'today') {
    const perPair = pairs.map((pair, i) => ({
      pair,
      rows: [...input.todayHourly[i], ...previousDays.flatMap((day) => rowsOfDay(day, stored[i][day], true))],
    }))
    return { perPair, hourly: perPair.flatMap(({ rows }) => rows), missingCurrent, missingPrevious }
  }

  const perPair = pairs.map((pair, i) => ({
    pair,
    rows: [
      ...currentDays.flatMap((day) => rowsOfDay(day, stored[i][day], false)),
      ...(reachesToday ? input.todayDaily[i] : []),
      ...previousDays.flatMap((day) => rowsOfDay(day, stored[i][day], false)),
    ],
  }))
  const hourly = pairs.flatMap((_pair, i) => [
    ...currentDays.flatMap((day) => rowsOfDay(day, stored[i][day], true)),
    ...(reachesToday ? input.todayHourly[i] : []),
  ])
  return { perPair, hourly, missingCurrent, missingPrevious }
}

/**
 * Days not kept yet are not shown as figures: a day of the view some shop is
 * still missing is a gap in the trend (a partial sum there would read as a bad
 * day), and the comparison is left out while any day of the period before is
 * missing, rather than set against a short count. The totals stay the sum of
 * what is kept, with `pendingDays` saying they are short.
 */
export function settleGaps(composed: Composed, period: Period, missingCurrent: Set<string>, missingPrevious: Set<string>): Composed {
  if (missingPrevious.size > 0) {
    composed.previous = null
    composed.previousByTime = []
  }
  if (period.range !== 'today' && missingCurrent.size > 0) {
    composed.byTime = composed.byTime.map((bucket) => (missingCurrent.has(bucket.at) ? { at: bucket.at, cost: null, revenue: null, orders: null } : bucket))
  }
  return composed
}

/* ------------------------------------------------------------- compose --- */

/**
 * Spend, revenue and orders by hour of the day over the view's days. Today
 * alone: each hour's own figures, as far as TikTok has broken the day down —
 * and the hour in progress, when the live total runs on from the last hour
 * broken down, as the difference. Longer views: the average per day for
 * each hour, today joining only for the hours it has finished. Days in
 * `missing` (not kept yet) are left out of the average, as if outside the view,
 * so it is not pulled down by days that only look empty.
 */
export function composeHours(period: Period, rows: Row[], totals: GmvMaxTotals, dataThrough: string | null, missing: Set<string> = new Set()): GmvMaxHours {
  const today = vnDate(new Date())
  const hourNow = new Date(Date.now() + VN_OFFSET_MS).getUTCHours()
  const single = period.range === 'today'
  const days = new Set(daysBetween(period.start, period.end).filter((day) => !missing.has(day)))
  const sums = Array.from({ length: 24 }, zero)
  for (const row of rows) {
    const at = timeOf(row)
    const day = at.slice(0, 10)
    const hour = Number(at.slice(11, 13))
    if (!days.has(day)) continue
    // An average leaves out today's unfinished hours, as it leaves them out of the day count below.
    if (!single && day === today && hour >= hourNow) continue
    addRow(sums[hour], row)
  }
  const currentHour = days.has(today) ? hourNow : null

  if (single) {
    const through = dataThrough ? Number(dataThrough.slice(11, 13)) : -1
    const reported = zero()
    for (let hour = 0; hour <= through; hour++) add(reported, sums[hour])
    const values = sums.map((own, hour): GmvMaxTotals | null => {
      if (hour <= through) return copy(own)
      // The hour in progress is the live total less every hour broken down — only when they meet.
      if (hour === hourNow && through === hourNow - 1) {
        return { cost: Math.max(0, totals.cost - reported.cost), revenue: Math.max(0, totals.revenue - reported.revenue), orders: Math.max(0, totals.orders - reported.orders) }
      }
      return null
    })
    return { values, totals: values.map((v) => (v ? copy(v) : zero())), counts: values.map((v) => (v ? 1 : 0)), currentHour }
  }

  const counts = Array.from({ length: 24 }, (_, hour) => [...days].filter((day) => day !== today || hour < hourNow).length)
  const values = sums.map((own, hour) =>
    counts[hour] === 0 ? null : { cost: own.cost / counts[hour], revenue: own.revenue / counts[hour], orders: own.orders / counts[hour] },
  )
  return { values, totals: sums, counts, currentHour }
}

export type Composed = Pick<GmvMaxOverview, 'totals' | 'previous' | 'byTime' | 'previousByTime' | 'byStore' | 'dataThrough'>

function storeEntry(pair: GmvPair, totals: GmvMaxTotals): GmvMaxOverview['byStore'][number] {
  return { ...copy(totals), storeId: pair.storeId, storeName: pair.storeName, advertiserName: pair.advertiserName }
}

export function composeToday(period: Period, series: Series, live: Live): Composed {
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

export function composeDays(period: Period, series: Series, live: Live): Composed {
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
