import 'server-only'

import { and, eq, gte, lte } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { metricAdjustments, type AdjustmentMetric } from '@/core/db/schema/adjustments'
import { shiftDay } from '@/modules/overview/data/period'
import type { Period } from '@/modules/overview/data/period'
import type { DashboardData } from '@/modules/overview/data/types'
import { adjustmentDays } from '../spread'

/**
 * Folds the project's adjustments into the overview's figures: the totals,
 * the period before (for the changes), and the trend lines day by day — for
 * today, the day's amount is in every running total from its first hour.
 * The hour-of-day and per-product breakdowns are left as read: an amount from
 * outside belongs to no hour and no product.
 *
 * The overview's parts may be memoised objects shared between requests, so
 * the ones changed are copied first.
 */
export async function withAdjustments(projectId: string, period: Period, data: DashboardData): Promise<DashboardData> {
  if (!data.sapo && !data.tiktokShop && !data.gmvMax) return data
  const rows = await db
    .select()
    .from(metricAdjustments)
    .where(
      and(
        eq(metricAdjustments.projectId, projectId),
        lte(metricAdjustments.startOn, period.end),
        gte(metricAdjustments.endOn, period.previousStart),
      ),
    )
  if (rows.length === 0) return data

  const byDay = adjustmentDays(rows)
  const on = (metric: AdjustmentMetric, day: string) => byDay.get(metric)?.get(day) ?? 0
  const over = (metric: AdjustmentMetric, from: string, to: string) => {
    let sum = 0
    for (const [day, amount] of byDay.get(metric) ?? []) if (day >= from && day <= to) sum += amount
    return sum
  }
  const has = (metric: AdjustmentMetric) => over(metric, period.previousStart, period.end) !== 0
  const isToday = period.range === 'today'
  // The day of a trend position: today's hours all fall on today; otherwise one day each.
  const dayAt = (from: string, i: number) => (isToday ? from : shiftDay(from, i))
  const add = (value: number | null, amount: number) => (value === null ? null : value + amount)

  const out: DashboardData = { ...data }

  if (data.sapo && has('sapoRevenue')) {
    const sapo = structuredClone(data.sapo)
    const m = 'sapoRevenue'
    sapo.totals.sales.revenue += over(m, period.start, period.end)
    if (sapo.previous) sapo.previous.sales.revenue += over(m, period.previousStart, period.previousEnd)
    sapo.byTime.forEach((b, i) => {
      const amount = on(m, dayAt(period.start, i))
      b.revenue = add(b.revenue, amount)
      // A bucket's own report row: for today, the day's amount sits in its first hour.
      if (b.sales && (!isToday || i === 0)) b.sales.revenue += amount
    })
    sapo.previousByTime.forEach((b, i) => {
      b.revenue = add(b.revenue, on(m, dayAt(period.previousStart, i)))
    })
    out.sapo = sapo
  }

  if (data.tiktokShop && has('shopSales')) {
    const shop = structuredClone(data.tiktokShop)
    const m = 'shopSales'
    const current = over(m, period.start, period.end)
    shop.totals.net += current
    shop.totals.gmv += current
    if (shop.previous) {
      const before = over(m, period.previousStart, period.previousEnd)
      shop.previous.net += before
      shop.previous.gmv += before
    }
    shop.byTime = shop.byTime.map((value, i) => add(value, on(m, dayAt(period.start, i))))
    out.tiktokShop = shop
  }

  if (data.gmvMax && (has('adsCost') || has('adsRevenue'))) {
    const gmv = structuredClone(data.gmvMax)
    const fields = [
      ['adsCost', 'cost'],
      ['adsRevenue', 'revenue'],
    ] as const
    for (const [m, field] of fields) {
      gmv.totals[field] += over(m, period.start, period.end)
      if (gmv.previous) gmv.previous[field] += over(m, period.previousStart, period.previousEnd)
      gmv.byTime.forEach((b, i) => {
        b[field] = add(b[field], on(m, dayAt(period.start, i)))
      })
      gmv.previousByTime.forEach((b, i) => {
        b[field] = add(b[field], on(m, dayAt(period.previousStart, i)))
      })
    }
    out.gmvMax = gmv
  }

  return out
}
