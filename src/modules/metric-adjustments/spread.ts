import { daysBetween } from '@/modules/overview/data/period'
import type { AdjustmentMetric, AdjustmentSpread } from '@/core/db/schema/adjustments'

/**
 * How an adjustment lands on the days it covers. Nothing here is
 * server-only: the admin page shows the per-day figure the dashboard adds.
 */

export const ADJUSTMENT_METRICS: readonly AdjustmentMetric[] = ['sapoRevenue', 'shopSales', 'adsCost', 'adsRevenue']

export interface AdjustmentSpan {
  metric: AdjustmentMetric
  amount: number
  spread: AdjustmentSpread
  startOn: string
  endOn: string
}

/**
 * The adjustment's amount on each of its days, in whole đồng. A 'total' is
 * split evenly, the odd đồng going to the first days, so the days always add
 * up to exactly the amount entered.
 */
export function amountsByDay(span: AdjustmentSpan): Map<string, number> {
  const days = daysBetween(span.startOn, span.endOn)
  const out = new Map<string, number>()
  if (days.length === 0) return out
  if (span.spread === 'daily') {
    for (const day of days) out.set(day, span.amount)
    return out
  }
  const sign = span.amount < 0 ? -1 : 1
  const whole = Math.abs(span.amount)
  const base = Math.floor(whole / days.length)
  const left = whole - base * days.length
  days.forEach((day, i) => out.set(day, sign * (base + (i < left ? 1 : 0))))
  return out
}

/** Every metric's total adjustment per day, the spans summed. */
export function adjustmentDays(spans: AdjustmentSpan[]): Map<AdjustmentMetric, Map<string, number>> {
  const out = new Map<AdjustmentMetric, Map<string, number>>()
  for (const span of spans) {
    const days = out.get(span.metric) ?? new Map<string, number>()
    for (const [day, amount] of amountsByDay(span)) days.set(day, (days.get(day) ?? 0) + amount)
    out.set(span.metric, days)
  }
  return out
}
