import 'server-only'

import { readBookings, type BookingRow } from '@/modules/analytics/data/booking'
import { buildReport, perBucket } from '@/modules/analytics/data/envelope'
import { bookingProduct, catalogOf } from '@/modules/analytics/data/joins'
import { affiliateDays, isScopeDenied, productPerformanceDays, shopOrderDays, videoDays } from '@/modules/analytics/data/tiktok-shop'
import { bucketOf, type ReportPeriod } from '@/modules/analytics/period'
import type { VideoGmvData, VideoGmvProduct } from './types'

/**
 * Booked videos aired (booking sheet) against the new videos posted with each
 * product and the product's GMV (TikTok Shop).
 *
 * "Videos attached" is TikTok's own count of new videos per product per day
 * (creators' and the shop's), from its analytics — a day or two behind, so
 * the latest days are gaps until TikTok has them. GMV comes from the orders
 * themselves and is current. A booked video is "attached" when TikTok lists it
 * among the videos posted with a product.
 */
export function videoGmvReport(projectId: string, period: ReportPeriod) {
  return buildReport<VideoGmvData>('video-gmv', projectId, period, async (tools) => {
    const { contexts } = tools
    const inPeriod = new Set(period.days)
    const shopContext = contexts.tiktokShop

    const [booking, orders, performance, videos, affiliate] = await Promise.all([
      tools.attempt('booking', () => readBookings(projectId), null),
      shopContext ? tools.attempt('tiktokShop', () => shopOrderDays(shopContext, period.days), null) : null,
      shopContext ? tools.attempt('tiktokShop', () => productPerformanceDays(shopContext, period.days), null) : null,
      shopContext ? tools.attempt('tiktokShop', () => videoDays(shopContext, period.days), null) : null,
      shopContext ? tools.attempt('tiktokShop', () => affiliateDays(shopContext, period.days), null) : null,
    ])
    for (const read of [orders, performance, videos, affiliate]) {
      if (!read) continue
      tools.pending('tiktokShop', read.pendingDays)
      // A read the app has no scope for (the affiliate orders, without the affiliate scope) is left out, not reported.
      if (read.error && !isScopeDenied(read.error)) tools.fail('tiktokShop', new Error(read.error))
    }

    const catalog = orders ? catalogOf(orders.values) : null
    const videoProduct = new Map<string, string>()
    const postedWithProduct = new Set<string>()
    let analyticsThrough: string | null = null
    for (const day of period.days) {
      for (const video of videos?.values[day]?.videos ?? []) {
        if (video.products.length > 0) {
          postedWithProduct.add(video.id)
          videoProduct.set(video.id, video.products[0])
        }
      }
      for (const [id, video] of Object.entries(affiliate?.values[day]?.videos ?? {})) if (!videoProduct.has(id) && video.products[0]) videoProduct.set(id, video.products[0])
      if (performance?.values[day]?.available) analyticsThrough = day
    }
    if (performance) tools.note('tiktokShop', analyticsThrough ? 'noteAnalyticsThrough' : 'noteAnalyticsNone', analyticsThrough ? { date: analyticsThrough } : undefined)

    const rows = booking?.rows ?? []
    const aired = rows.filter((row): row is BookingRow & { airedOn: string } => row.airedOn !== null && inPeriod.has(row.airedOn))
    const productOfRow = (row: BookingRow) => (row.product ? bookingProduct(row.product, catalog) : (row.videoId && videoProduct.get(row.videoId)) || '')
    let unmatchedProducts = 0
    for (const row of aired) {
      const key = productOfRow(row)
      if (!key || (catalog && !/^\d{10,}$/.test(key))) unmatchedProducts += 1
    }
    if (booking) tools.note('booking', 'noteBooking', { rows: rows.length, aired: aired.length })

    const perf = (day: string) => performance?.values[day]
    const series = {
      booked: booking ? perBucket(period, (day) => aired.filter((row) => row.airedOn === day).length) : period.buckets.map(() => null),
      attached: perBucket(period, (day) => {
        const value = perf(day)
        return value?.available ? Object.values(value.products).reduce((s, p) => s + p.affiliateNewVideos + p.sellerNewVideos, 0) : null
      }),
      bookedAttached:
        booking && videos ? perBucket(period, (day) => aired.filter((row) => row.airedOn === day && postedWithProduct.has(row.videoId)).length) : period.buckets.map(() => null),
      gmv: perBucket(period, (day) => orders?.values[day]?.gmv),
    }

    const bucketIndex = new Map(period.buckets.map((bucket, i) => [bucket, i]))
    const products = new Map<string, VideoGmvProduct>()
    const productOf = (key: string) => {
      let own = products.get(key)
      if (!own) {
        own = {
          key,
          name: catalog?.names.get(key) ?? key,
          booked: 0,
          attached: 0,
          gmv: 0,
          bookedByBucket: period.buckets.map(() => 0),
          attachedByBucket: period.buckets.map(() => null),
          gmvByBucket: period.buckets.map(() => 0),
        }
        products.set(key, own)
      }
      return own
    }
    for (const row of aired) {
      const key = productOfRow(row)
      if (!key) continue
      const own = productOf(key)
      own.booked += 1
      own.bookedByBucket[bucketIndex.get(bucketOf(row.airedOn, period.granularity))!] += 1
    }
    const availableBuckets = new Set<number>()
    for (const day of period.days) {
      const i = bucketIndex.get(bucketOf(day, period.granularity))!
      for (const [key, product] of Object.entries(orders?.values[day]?.products ?? {})) {
        const own = productOf(key)
        own.gmv += product.gmv
        own.gmvByBucket[i] += product.gmv
      }
      const value = perf(day)
      if (value?.available) {
        for (const [key, product] of Object.entries(value.products)) {
          const count = product.affiliateNewVideos + product.sellerNewVideos
          if (count === 0 && !products.has(key)) continue
          const own = productOf(key)
          own.attached += count
          own.attachedByBucket[i] = (own.attachedByBucket[i] ?? 0) + count
        }
        availableBuckets.add(i)
      }
    }
    // A bucket TikTok had figures for, but no new video of a product in it: zero for that product, not a gap.
    for (const own of products.values()) for (const i of availableBuckets) own.attachedByBucket[i] ??= 0

    const total = (values: Array<number | null>) => values.reduce<number>((s, v) => s + (v ?? 0), 0)
    return {
      buckets: period.buckets.map((at, i) => ({
        at,
        booked: series.booked[i],
        attached: series.attached[i],
        bookedAttached: series.bookedAttached[i],
        gmv: series.gmv[i],
      })),
      totals: { booked: aired.length, attached: total(series.attached), bookedAttached: total(series.bookedAttached), gmv: total(series.gmv) },
      products: [...products.values()].filter((p) => p.booked > 0 || p.attached > 0 || p.gmv > 0).sort((a, b) => b.gmv - a.gmv).slice(0, 300),
      analyticsThrough,
      sheet: booking
        ? {
            rows: rows.length,
            withoutAirDate: rows.filter((row) => row.airedOn === null).length,
            unmatchedProducts,
          }
        : null,
    }
  })
}
