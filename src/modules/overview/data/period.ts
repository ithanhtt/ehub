import type { DashboardRange } from './types'

/**
 * Turns a range — a preset, or a custom pair of dates — into concrete
 * Vietnam-time dates.
 *
 * `buckets` are the x-axis positions: the hours of today so far, or each day
 * of the period. The previous period has the same length and ends the day
 * before the current one starts — for today, it is yesterday.
 *
 * Nothing here is server-only: the page's date picker checks a custom range
 * with the same limits and rules the route does.
 */
export type Period = {
  range: DashboardRange
  start: string
  end: string
  previousStart: string
  previousEnd: string
  buckets: string[]
  /** Days in the period. */
  days: number
}

export type CustomRange = { from: string; to: string }

/**
 * How far back a custom range may start (about six months), and how long it
 * may run (a quarter). Its comparison period reaches up to CUSTOM_MAX_DAYS
 * further back, which the Sapo day store keeps (KEEP_DAYS in sapo.ts).
 *
 * The bound is Sapo's: it has no totals endpoint, so every day is read order
 * by order (8–14 MB a day for this store) — once, then kept. TikTok's daily
 * report is read in 30-day pieces and would take longer spans in its stride.
 */
export const CUSTOM_LOOKBACK_DAYS = 180
export const CUSTOM_MAX_DAYS = 92

const OFFSET_MS = 7 * 3600_000
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** YYYY-MM-DD in UTC+7. */
export function vnDate(date: Date): string {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10)
}

export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Every day from `start` to `end`, inclusive. */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let day = start; day <= end; day = shiftDay(day, 1)) out.push(day)
  return out
}

export type CustomRangeProblem = 'invalid' | 'order' | 'future' | 'tooOld' | 'tooLong'

/** What is wrong with a custom range, or null when it can be shown. */
export function customRangeProblem(range: CustomRange, now = new Date()): CustomRangeProblem | null {
  const { from, to } = range
  // A real calendar date survives the round trip; "2026-02-30" does not.
  if (!DAY.test(from) || !DAY.test(to) || shiftDay(from, 0) !== from || shiftDay(to, 0) !== to) return 'invalid'
  if (from > to) return 'order'
  const today = vnDate(now)
  if (to > today) return 'future'
  if (from < shiftDay(today, -(CUSTOM_LOOKBACK_DAYS - 1))) return 'tooOld'
  if (daysBetween(from, to).length > CUSTOM_MAX_DAYS) return 'tooLong'
  return null
}

/** `custom` carries the dates of a custom range, checked beforehand with customRangeProblem. */
export function periodOf(range: DashboardRange, custom?: CustomRange, now = new Date()): Period {
  const today = vnDate(now)

  if (range === 'today') {
    const hour = new Date(now.getTime() + OFFSET_MS).getUTCHours()
    return {
      range,
      start: today,
      end: today,
      previousStart: shiftDay(today, -1),
      previousEnd: shiftDay(today, -1),
      buckets: Array.from({ length: hour + 1 }, (_, h) => `${today} ${String(h).padStart(2, '0')}:00`),
      days: 1,
    }
  }

  if (range === 'custom') {
    if (!custom) throw new Error('A custom range needs its dates')
    const buckets = daysBetween(custom.from, custom.to)
    return {
      range,
      start: custom.from,
      end: custom.to,
      previousStart: shiftDay(custom.from, -buckets.length),
      previousEnd: shiftDay(custom.from, -1),
      buckets,
      days: buckets.length,
    }
  }

  const days = range === '7d' ? 7 : 30
  const start = shiftDay(today, -(days - 1))
  return {
    range,
    start,
    end: today,
    previousStart: shiftDay(start, -days),
    previousEnd: shiftDay(start, -1),
    buckets: daysBetween(start, today),
    days,
  }
}
