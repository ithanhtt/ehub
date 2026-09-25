import 'server-only'

import { gmvProductDays } from '@/modules/analytics/data/gmv-max'
import { buildReport, perBucket } from '@/modules/analytics/data/envelope'
import { catalogOf, sapoToTiktok } from '@/modules/analytics/data/joins'
import { shopOrderDays } from '@/modules/analytics/data/tiktok-shop'
import type { ReportPeriod } from '@/modules/analytics/period'
import { sapoProductDays } from '@/modules/overview/data/sapo'
import type { OrderCancelData, OrderCancelProduct } from './types'

/**
 * Sapo's orders per product and hour, GMV Max's orders per product, and the
 * two tied together by SKU when TikTok Shop is connected (it knows which
 * seller SKUs each TikTok product sells under).
 *
 * Sapo counts the channels chosen for the project on the overview; a product
 * is counted once per order that holds it. The hour of an order is the hour it
 * was placed; a cancellation is filed under the hour its order was placed, so
 * "the hour with the fewest cancellations" reads as the hour whose orders are
 * cancelled least.
 */
export function orderCancelReport(projectId: string, period: ReportPeriod) {
  return buildReport<OrderCancelData>('order-cancel', projectId, period, async (tools) => {
    const { contexts } = tools

    const [sapo, ads, shop] = await Promise.all([
      contexts.sapo ? tools.attempt('sapo', () => sapoProductDays(contexts.sapo!, period.days), null) : null,
      contexts.tiktokAds ? tools.attempt('tiktokAds', () => gmvProductDays(contexts.tiktokAds!, period.start, period.end), null) : null,
      contexts.tiktokShop ? tools.attempt('tiktokShop', () => shopOrderDays(contexts.tiktokShop!, period.days), null) : null,
    ])
    if (sapo) {
      tools.pending('sapo', sapo.pendingDays)
      tools.fail('sapo', sapo.failures)
    }
    if (ads) tools.fail('tiktokAds', ads.failures)
    if (shop) {
      tools.pending('tiktokShop', shop.pendingDays)
      if (shop.error) tools.fail('tiktokShop', new Error(shop.error))
    }

    const catalog = shop ? catalogOf(shop.values) : null
    const matched = sapo ? sapoToTiktok(sapo.days, catalog) : new Map<string, string>()

    // GMV Max per TikTok product over the period.
    const adsByProduct = new Map<string, { orders: number; revenue: number }>()
    let adsOrders = 0
    let adsCost = 0
    let adsRevenue = 0
    for (const day of period.days) {
      for (const [item, figures] of Object.entries(ads?.days[day] ?? {})) {
        const own = adsByProduct.get(item) ?? { orders: 0, revenue: 0 }
        own.orders += figures.orders
        own.revenue += figures.revenue
        adsByProduct.set(item, own)
        adsOrders += figures.orders
        adsCost += figures.cost
        adsRevenue += figures.revenue
      }
    }

    // Sapo over the period: orders as orders, and per product.
    const products = new Map<string, OrderCancelProduct>()
    const hoursCreated = Array.from({ length: 24 }, () => 0)
    const hoursCancelled = Array.from({ length: 24 }, () => 0)
    let created = 0
    let cancelled = 0
    let daysRead = 0
    for (const day of period.days) {
      const total = sapo?.totals[day]
      if (total) {
        daysRead += 1
        created += total.created
        cancelled += total.cancelled
        total.hours.forEach(([orders, cancels], hour) => {
          hoursCreated[hour] += orders
          hoursCancelled[hour] += cancels
        })
      }
      for (const [key, product] of Object.entries(sapo?.days[day] ?? {})) {
        const own = products.get(key) ?? {
          key,
          name: product.name,
          created: 0,
          cancelled: 0,
          adsOrders: null,
          adsRevenue: null,
          tiktokProductId: matched.get(key) ?? null,
          hours: Array.from({ length: 24 }, (): [number, number] => [0, 0]),
        }
        own.name = product.name
        own.created += product.orders
        own.cancelled += product.cancelled
        for (const [hour, [orders, cancels]] of Object.entries(product.hours)) {
          const cell = own.hours[Number(hour)]
          if (!cell) continue
          cell[0] += orders
          cell[1] += cancels
        }
        products.set(key, own)
      }
    }

    // Each TikTok product's ads orders go to the first (busiest) Sapo product matched to it.
    const ranked = [...products.values()].sort((a, b) => b.created - a.created)
    let matchedAdsOrders = 0
    const claimed = new Set<string>()
    for (const product of ranked) {
      const item = product.tiktokProductId
      if (!item || claimed.has(item)) continue
      claimed.add(item)
      const figures = adsByProduct.get(item)
      product.adsOrders = figures?.orders ?? 0
      product.adsRevenue = figures?.revenue ?? 0
      matchedAdsOrders += figures?.orders ?? 0
    }
    if (sapo && catalog) tools.note('sapo', 'noteMatched', { matched: matched.size, products: products.size })

    const createdByBucket = perBucket(period, (day) => sapo?.totals[day]?.created)
    const cancelledByBucket = perBucket(period, (day) => sapo?.totals[day]?.cancelled)
    const sumAds = (day: string, pick: 'orders' | 'cost') =>
      ads && !ads.failedDays.has(day) ? Object.values(ads.days[day] ?? {}).reduce((total, figures) => total + figures[pick], 0) : null
    const adsOrdersByBucket = perBucket(period, (day) => sumAds(day, 'orders'))
    const adsCostByBucket = perBucket(period, (day) => sumAds(day, 'cost'))

    return {
      buckets: period.buckets.map((at, i) => ({
        at,
        created: createdByBucket[i],
        cancelled: cancelledByBucket[i],
        adsOrders: adsOrdersByBucket[i],
        adsCost: adsCostByBucket[i],
      })),
      totals: { created, cancelled, adsOrders, adsCost, adsRevenue },
      products: ranked,
      hours: { created: hoursCreated, cancelled: hoursCancelled, days: daysRead },
      matching: { mode: catalog ? 'sku' : 'none', matchedAdsOrders, unmatchedAdsOrders: Math.max(0, adsOrders - matchedAdsOrders) },
    }
  })
}
