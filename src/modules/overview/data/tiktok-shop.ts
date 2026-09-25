import 'server-only'

import type { ConnectionContext } from '@/core/plugins/types'
import { isScopeDenied, shopOrderDays, type ShopOrderDay } from '@/modules/analytics/data/tiktok-shop'
import { daysBetween, vnDate, type Period } from './period'
import type { ShopFigures, TiktokShopOverview } from './types'

/**
 * The TikTok Shop's own orders on the overview: how much it sold and when,
 * hour by hour, over exactly the view's days — to set beside what GMV Max
 * spent in the same hours and what Sapo sold.
 *
 * Days come from the shop's order store (analytics/data/tiktok-shop.ts), kept
 * on disk and read again only while they can change; the recent days are kept
 * current every few minutes from the orders TikTok says changed. Days still on
 * their way are counted in `pendingDays`, and the figures are short until they
 * land.
 *
 * Hours are figured as Sapo's are (see sapo.ts, hoursOf): today alone, each
 * hour's own, the one in progress included; a longer view, the average day,
 * today joining only for the hours it has finished.
 */

const VN_OFFSET_MS = 7 * 3600_000
const PRODUCTS = 60
/** The longest a request waits on the shop's orders (a sweep due, a today not read yet) before answering. */
const FIRST_WAIT_MS = 15_000

const zero = (): ShopFigures => ({ orders: 0, cancelled: 0, gmv: 0, net: 0 })

function addTally(target: ShopFigures, [orders, gmv, cancelled, cancelledGmv]: [number, number, number, number]) {
  target.orders += orders
  target.gmv += gmv
  target.cancelled += cancelled
  target.net += gmv - cancelledGmv
}

/**
 * The previous period's figures, for the changes. Today is set against
 * yesterday up to the same time: its whole hours so far and the elapsed share
 * of this one (as the GMV Max figures are, gmv-max.ts). A longer view against
 * the period before it, whole — or not at all while any of its days is missing,
 * rather than against a short count.
 */
function previousOf(period: Period, days: string[], values: Record<string, ShopOrderDay>, hourNow: number): ShopFigures | null {
  if (days.some((day) => !values[day])) return null
  const out = zero()
  if (period.range === 'today') {
    const hours = values[days[0]].hours
    for (let hour = 0; hour < hourNow; hour++) addTally(out, hours[hour])
    const share = new Date(Date.now() + VN_OFFSET_MS).getUTCMinutes() / 60
    const [orders, gmv, cancelled, cancelledGmv] = hours[hourNow]
    addTally(out, [orders * share, gmv * share, cancelled * share, cancelledGmv * share])
    return out
  }
  for (const day of days) {
    const value = values[day]
    out.orders += value.orders
    out.cancelled += value.cancelled
    out.gmv += value.gmv
    out.net += value.gmv - value.cancelledGmv
  }
  return out
}

export async function tiktokShopOverview(context: ConnectionContext, period: Period): Promise<TiktokShopOverview> {
  const days = daysBetween(period.start, period.end)
  const previousDays = daysBetween(period.previousStart, period.previousEnd)
  // Read apart: the view's own days say what is still syncing; the previous period only feeds the changes.
  // Side by side, each within the same budget: a first request waits at most FIRST_WAIT_MS for today, a
  // request with today kept (however stale) not at all — the kept figures are served while it is read again.
  const [read, before] = await Promise.all([
    shopOrderDays(context, days, { budgetMs: FIRST_WAIT_MS }),
    shopOrderDays(context, previousDays, { budgetMs: FIRST_WAIT_MS }),
  ])
  const today = vnDate(new Date())
  const hourNow = new Date(Date.now() + VN_OFFSET_MS).getUTCHours()
  const single = period.range === 'today'
  const kept = days.flatMap((day) => (read.values[day] ? [{ day, value: read.values[day] as ShopOrderDay }] : []))

  const totals = zero()
  const hourTotals = Array.from({ length: 24 }, zero)
  const counts = Array.from({ length: 24 }, () => 0)
  const products = new Map<string, { id: string; name: string; totals: ShopFigures; hours: Array<{ orders: number; net: number }> }>()

  for (const { day, value } of kept) {
    totals.orders += value.orders
    totals.cancelled += value.cancelled
    totals.gmv += value.gmv
    totals.net += value.gmv - value.cancelledGmv
    for (let hour = 0; hour < 24; hour++) {
      // Today counts every hour so far for the today view, only finished ones for an average.
      if (day === today && (single ? hour > hourNow : hour >= hourNow)) continue
      addTally(hourTotals[hour], value.hours[hour])
      counts[hour] += 1
    }
    for (const [id, product] of Object.entries(value.products)) {
      const own = products.get(id) ?? { id, name: product.name, totals: zero(), hours: Array.from({ length: 24 }, () => ({ orders: 0, net: 0 })) }
      own.totals.orders += product.orders
      own.totals.cancelled += product.cancelledOrders
      own.totals.gmv += product.gmv
      own.totals.net += product.gmv - product.cancelledGmv
      // The store keeps each hour's value without its cancelled orders (analytics/data/tiktok-shop.ts): net already.
      for (const [hour, [orders, net]] of Object.entries(product.hours ?? {})) {
        own.hours[Number(hour)].orders += orders
        own.hours[Number(hour)].net += net
      }
      products.set(id, own)
    }
  }

  const values = hourTotals.map((sum, hour): ShopFigures | null => {
    if (counts[hour] === 0) return null
    if (single) return sum
    const n = counts[hour]
    return { orders: sum.orders / n, cancelled: sum.cancelled / n, gmv: sum.gmv / n, net: sum.net / n }
  })

  // The trend: today's net sales running up hour by hour; a longer view's, day by day.
  let running = 0
  const byTime = single
    ? hourTotals.slice(0, hourNow + 1).map((hour) => (running += hour.net))
    : days.map((day) => (read.values[day] ? read.values[day].gmv - read.values[day].cancelledGmv : null))

  // Refunds only when known for every day of the view: a partial sum would read as fewer refunds.
  const refunded =
    kept.length === days.length && kept.every(({ value }) => value.refunded !== undefined)
      ? kept.reduce((sum, { value }) => ({ amount: sum.amount + (value.refunded ?? 0), orders: sum.orders + (value.refundedOrders ?? 0) }), { amount: 0, orders: 0 })
      : null

  return {
    totals,
    previous: previousOf(period, previousDays, before.values, hourNow),
    byTime,
    hours: { values, totals: hourTotals, counts, currentHour: days.includes(today) ? hourNow : null },
    productCount: products.size,
    products: [...products.values()].sort((a, b) => b.totals.net - a.totals.net).slice(0, PRODUCTS),
    refunded,
    pendingDays: read.pendingDays,
    fetchedAt: new Date().toISOString(),
    // A read the app has no scope for is left out, not reported (the orders need only the order scope).
    failures: read.error && !isScopeDenied(read.error) ? [{ source: 'TikTok Shop', message: read.error }] : [],
  }
}
