import 'server-only'

import { readBookings, type BookingRow } from '@/modules/analytics/data/booking'
import { buildReport, distinctPerBucket, perBucket } from '@/modules/analytics/data/envelope'
import { gmvProductDays, gmvVideoDays } from '@/modules/analytics/data/gmv-max'
import { bookingProduct, catalogOf } from '@/modules/analytics/data/joins'
import { isScopeDenied, shopOrderDays, videoDays } from '@/modules/analytics/data/tiktok-shop'
import { bucketOf, type ReportPeriod } from '@/modules/analytics/period'
import type { BookingKocData, BookingKocKoc, BookingKocProduct } from './types'

/**
 * Booked videos against all the videos posted with the shop's products in the
 * cart and the videos GMV Max spends on, day by day.
 *
 * A booked video counts on the day the booking data says it aired, for the
 * product it names (a TikTok product id, or an SKU matched through TikTok
 * Shop's orders); a row naming no product takes the one its video carries.
 * The organic videos are the posted ones less the booked ones — the videos
 * the shop got without paying a KOC — and the report sets them against
 * booking to show what booking adds.
 *
 * Only what the shop's app may read is used: the orders (for product names
 * and SKUs), the video analytics, and GMV Max. A read the app has no scope
 * for is left out without a warning.
 */
export function bookingKocReport(projectId: string, period: ReportPeriod) {
  return buildReport<BookingKocData>('booking-koc', projectId, period, async (tools) => {
    const { contexts } = tools
    const inPeriod = new Set(period.days)
    const shop = contexts.tiktokShop
    const adsContext = contexts.tiktokAds

    const [booking, orders, videos, ads] = await Promise.all([
      tools.attempt('booking', () => readBookings(projectId), null),
      shop ? tools.attempt('tiktokShop', () => shopOrderDays(shop, period.days), null) : null,
      shop ? tools.attempt('tiktokShop', () => videoDays(shop, period.days), null) : null,
      adsContext ? tools.attempt('tiktokAds', () => gmvProductDays(adsContext, period.start, period.end), null) : null,
    ])
    for (const read of [orders, videos]) {
      if (!read) continue
      tools.pending('tiktokShop', read.pendingDays)
      if (read.error && !isScopeDenied(read.error)) tools.fail('tiktokShop', new Error(read.error))
    }
    if (ads) tools.fail('tiktokAds', ads.failures)
    const videoAds = adsContext && ads ? await tools.attempt('tiktokAds', () => gmvVideoDays(adsContext, period.start, period.end, ads.days, ads.campaigns), null) : null
    if (videoAds) tools.fail('tiktokAds', videoAds.failures)

    const catalog = orders ? catalogOf(orders.values) : null

    /* --------------------------------------------- the videos, day by day --- */

    /** The videos posted that day with the cart; null while TikTok does not have the day. */
    const postedOn = (day: string) => {
      const kept = videos?.values[day]
      return kept && kept.available ? kept.videos.filter((video) => video.products.length > 0) : null
    }
    const adsOn = (day: string) =>
      videoAds && !ads?.failedDays.has(day)
        ? Object.entries(videoAds.days[day] ?? {})
            .filter(([, figures]) => figures.cost > 0)
            .map(([id]) => id)
        : null

    // The product each video carries, from the videos posted and the videos GMV Max ran.
    const videoProduct = new Map<string, string>()
    for (const day of period.days) {
      for (const video of postedOn(day) ?? []) if (video.products[0]) videoProduct.set(video.id, video.products[0])
      for (const [id, figures] of Object.entries(videoAds?.days[day] ?? {})) if (figures.product && !videoProduct.has(id)) videoProduct.set(id, figures.product)
    }

    /* ----------------------------------------------------- booking rows --- */

    const rows = booking?.rows ?? []
    const aired = rows.filter((row): row is BookingRow & { airedOn: string } => row.airedOn !== null && inPeriod.has(row.airedOn))
    const productOfRow = (row: BookingRow) => (row.product ? bookingProduct(row.product, catalog) : (row.videoId && videoProduct.get(row.videoId)) || '')
    const bookedVideoIds = new Set(rows.map((row) => row.videoId).filter(Boolean))
    const bookedOn = (day: string) => aired.filter((row) => row.airedOn === day)
    let unmatchedProducts = 0
    for (const row of aired) {
      const key = productOfRow(row)
      if (!key || (catalog && !/^\d{10,}$/.test(key))) unmatchedProducts += 1
    }
    if (booking) tools.note('booking', 'noteBooking', { rows: rows.length, aired: aired.length })

    const posted = (day: string) => postedOn(day)?.length ?? null
    const organic = (day: string) => {
      const count = posted(day)
      return count === null ? null : Math.max(0, count - bookedOn(day).length)
    }

    /* -------------------------------------------------------- per bucket --- */

    const booked = perBucket(period, (day) => bookedOn(day).length)
    const bookingCost = perBucket(period, (day) => bookedOn(day).reduce((sum, row) => sum + row.cost, 0))
    const postedVideos = perBucket(period, posted)
    const organicVideos = perBucket(period, organic)
    const adsVideos = distinctPerBucket(period, adsOn)
    const bookedOnAds = distinctPerBucket(period, (day) => adsOn(day)?.filter((id) => bookedVideoIds.has(id)) ?? null)

    /* ------------------------------------------ booking's effect on organic --- */

    let withSum = 0
    let withDays = 0
    let withoutSum = 0
    let withoutDays = 0
    for (const day of period.days) {
      const count = organic(day)
      if (count === null) continue
      if (bookedOn(day).length > 0) {
        withSum += count
        withDays += 1
      } else {
        withoutSum += count
        withoutDays += 1
      }
    }
    const analyticsThrough = [...period.days].reverse().find((day) => postedOn(day) !== null) ?? null

    /* ------------------------------------------------------- per product --- */

    const bucketIndex = new Map(period.buckets.map((bucket, i) => [bucket, i]))
    const indexOf = (day: string) => bucketIndex.get(bucketOf(day, period.granularity))!
    type ProductWork = BookingKocProduct & { days: Set<string>; postedBy: Array<number | null>; ads: Set<string> }
    const products = new Map<string, ProductWork>()
    const productOf = (key: string) => {
      let own = products.get(key)
      if (!own) {
        own = {
          key,
          name: catalog?.names.get(key) ?? key,
          booked: 0,
          airDays: 0,
          postedVideos: 0,
          organicVideos: 0,
          adsVideos: 0,
          bookedByBucket: period.buckets.map(() => 0),
          organicByBucket: [],
          days: new Set(),
          postedBy: period.buckets.map(() => null),
          ads: new Set(),
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
      own.days.add(row.airedOn)
      own.bookedByBucket[indexOf(row.airedOn)] += 1
    }
    for (const day of period.days) {
      const i = indexOf(day)
      for (const video of postedOn(day) ?? []) {
        for (const key of video.products) {
          const own = productOf(key)
          own.postedVideos += 1
          own.postedBy[i] = (own.postedBy[i] ?? 0) + 1
        }
      }
      for (const [id, figures] of Object.entries(videoAds?.days[day] ?? {})) if (figures.cost > 0 && figures.product) productOf(figures.product).ads.add(id)
    }
    const productList = [...products.values()]
      .map(({ days, postedBy, ads, ...own }) => {
        const organicByBucket = postedBy.map((count, i) => (count === null ? null : Math.max(0, count - own.bookedByBucket[i])))
        return {
          ...own,
          airDays: days.size,
          adsVideos: ads.size,
          organicByBucket,
          organicVideos: organicByBucket.reduce<number>((sum, n) => sum + (n ?? 0), 0),
        }
      })
      .filter((p) => p.booked > 0 || p.postedVideos > 0 || p.adsVideos > 0)
      .sort((a, b) => b.booked - a.booked || b.postedVideos - a.postedVideos)
      .slice(0, 300)

    /* ----------------------------------------------------------- per KOC --- */

    const kocs = new Map<string, BookingKocKoc>()
    const kocOf = (koc: string) => {
      let own = kocs.get(koc)
      if (!own) kocs.set(koc, (own = { koc, name: '', booked: 0, cost: 0, postedVideos: 0, postedGmv: 0, onAds: 0, adsCost: 0 }))
      return own
    }
    const videoKoc = new Map<string, string>()
    for (const row of aired) {
      if (!row.koc) continue
      const own = kocOf(row.koc)
      own.booked += 1
      own.cost += row.cost
      if (row.kocName && !own.name) own.name = row.kocName
      if (row.videoId) videoKoc.set(row.videoId, row.koc)
    }
    // What TikTok saw of the booked KOCs' videos in the period, and what GMV Max spent on their booked ones.
    for (const day of period.days) {
      for (const video of postedOn(day) ?? []) {
        const own = kocs.get(video.creator)
        if (!own) continue
        own.postedVideos += 1
        own.postedGmv += video.gmv
      }
    }
    const adsCostOf = new Map<string, number>()
    for (const day of period.days) {
      if (ads?.failedDays.has(day)) continue
      for (const [id, figures] of Object.entries(videoAds?.days[day] ?? {})) {
        if (figures.cost > 0 && bookedVideoIds.has(id)) adsCostOf.set(id, (adsCostOf.get(id) ?? 0) + figures.cost)
      }
    }
    for (const [id, cost] of adsCostOf) {
      const koc = videoKoc.get(id) ?? rows.find((row) => row.videoId === id)?.koc
      if (!koc) continue
      const own = kocOf(koc)
      own.onAds += 1
      own.adsCost += cost
    }
    const kocList = [...kocs.values()].sort((a, b) => b.booked - a.booked || b.cost - a.cost).slice(0, 500)

    const total = (values: Array<number | null>) => values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    const everyAds = new Set<string>()
    for (const day of period.days) for (const id of adsOn(day) ?? []) everyAds.add(id)

    return {
      buckets: period.buckets.map((at, i) => ({
        at,
        booked: booked[i] ?? 0,
        bookingCost: bookingCost[i] ?? 0,
        postedVideos: postedVideos[i],
        organicVideos: organicVideos[i],
        adsVideos: adsVideos[i],
        bookedOnAds: bookedOnAds[i],
      })),
      totals: {
        booked: aired.length,
        bookingCost: aired.reduce((sum, row) => sum + row.cost, 0),
        bookedKocs: new Set(aired.map((row) => row.koc).filter(Boolean)).size,
        postedVideos: total(postedVideos),
        organicVideos: total(organicVideos),
        adsVideos: everyAds.size,
        bookedOnAds: [...everyAds].filter((id) => bookedVideoIds.has(id)).length,
        adsCostOnBooked: [...adsCostOf.values()].reduce((sum, cost) => sum + cost, 0),
      },
      impact: {
        organicWithBooking: withDays > 0 ? withSum / withDays : null,
        organicWithout: withoutDays > 0 ? withoutSum / withoutDays : null,
        daysWithBooking: withDays,
        daysWithout: withoutDays,
      },
      analyticsThrough,
      products: productList,
      kocs: kocList,
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
