import { daysBetween, shiftDay, vnDate } from '@/modules/overview/data/period'

/**
 * The period a report covers, and how its figures are grouped: day by day, or
 * month by month for the longer look the KOC and cost questions need.
 *
 * Every day is a Vietnam date (UTC+7), the time zone of the shop, the ad
 * accounts and the Sapo store alike. Nothing here is server-only: the page's
 * date picker checks a custom range with the same rules the route does.
 */

export type ReportRange = '7d' | '30d' | '90d' | 'custom'
export const REPORT_RANGES: readonly ReportRange[] = ['7d', '30d', '90d']

export type Granularity = 'day' | 'month'
export const GRANULARITIES: readonly Granularity[] = ['day', 'month']

/**
 * How far back a report reaches, and how long a custom range may run (half a
 * year). The reach is the Sapo day store's: it keeps about 320 days (KEEP_DAYS
 * in overview/data/sapo.ts), and every day it has not seen is read order by
 * order — once, then kept.
 */
export const REPORT_LOOKBACK_DAYS = 270
export const REPORT_MAX_DAYS = 186

export type CustomRange = { from: string; to: string }

export interface ReportPeriod {
  range: ReportRange
  granularity: Granularity
  start: string
  end: string
  /** Every day of the period, oldest first. */
  days: string[]
  /** The x-axis positions: the days, or the months ("2026-09") the days fall in. */
  buckets: string[]
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

export type RangeProblem = 'invalid' | 'order' | 'future' | 'tooOld' | 'tooLong'

export function reportRangeProblem(range: CustomRange, now = new Date()): RangeProblem | null {
  const { from, to } = range
  if (!DAY.test(from) || !DAY.test(to) || shiftDay(from, 0) !== from || shiftDay(to, 0) !== to) return 'invalid'
  if (from > to) return 'order'
  const today = vnDate(now)
  if (to > today) return 'future'
  if (from < shiftDay(today, -(REPORT_LOOKBACK_DAYS - 1))) return 'tooOld'
  if (daysBetween(from, to).length > REPORT_MAX_DAYS) return 'tooLong'
  return null
}

/** The bucket a day falls in. */
export const bucketOf = (day: string, granularity: Granularity) => (granularity === 'month' ? day.slice(0, 7) : day)

export function reportPeriodOf(range: ReportRange, granularity: Granularity, custom?: CustomRange, now = new Date()): ReportPeriod {
  const today = vnDate(now)
  let start: string
  let end = today
  if (range === 'custom') {
    if (!custom) throw new Error('A custom range needs its dates')
    start = custom.from
    end = custom.to
  } else {
    start = shiftDay(today, -((range === '7d' ? 7 : range === '30d' ? 30 : 90) - 1))
  }
  const days = daysBetween(start, end)
  return { range, granularity, start, end, days, buckets: [...new Set(days.map((day) => bucketOf(day, granularity)))] }
}

export { daysBetween, shiftDay, vnDate }
