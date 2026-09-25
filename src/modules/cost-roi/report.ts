import 'server-only'

import { readBookings } from '@/modules/analytics/data/booking'
import { buildReport, perBucket } from '@/modules/analytics/data/envelope'
import { gmvProductDays, gmvVideoDays, roiTargetHistory } from '@/modules/analytics/data/gmv-max'
import { affiliateDays, isScopeDenied, ratingDays, shopOrderDays, videoDays } from '@/modules/analytics/data/tiktok-shop'
import type { ReportPeriod } from '@/modules/analytics/period'
import { addTo } from '@/modules/analytics/shared/stats'
import type { CostRoiData, CostRoiKoc, CostRoiProduct, RoiLevel } from './types'

/** Days a target level needs before it can be called the best. */
const MIN_LEVEL_DAYS = 3

/**
 * The best ROI target for a product, from the levels it ran at: of the levels
 * TikTok met (revenue ÷ spend at or above the target), the one that brought
 * the most revenue a day — a higher target that starves delivery is not
 * better. When no level was met, the one with the highest ROI. Levels with
 * fewer than MIN_LEVEL_DAYS days are not judged.
 */
export function bestLevel(levels: RoiLevel[]): RoiLevel | null {
  const judged = levels.filter((level) => level.days >= MIN_LEVEL_DAYS && level.cost > 0)
  if (judged.length === 0) return null
  const met = judged.filter((level) => level.revenue / level.cost >= level.target)
  if (met.length > 0) return met.reduce((a, b) => (b.revenue / b.days > a.revenue / a.days ? b : a))
  return judged.reduce((a, b) => (b.revenue / b.cost > a.revenue / a.cost ? b : a))
}

export function costRoiReport(projectId: string, period: ReportPeriod) {
  return buildReport<CostRoiData>('cost-roi', projectId, period, async (tools) => {
    const { contexts } = tools
    const shopContext = contexts.tiktokShop
    const adsContext = contexts.tiktokAds

    const [orders, affiliate, videos, ratings, ads, booking] = await Promise.all([
      shopContext ? tools.attempt('tiktokShop', () => shopOrderDays(shopContext, period.days), null) : null,
      shopContext ? tools.attempt('tiktokShop', () => affiliateDays(shopContext, period.days), null) : null,
      shopContext ? tools.attempt('tiktokShop', () => videoDays(shopContext, period.days), null) : null,
      shopContext ? tools.attempt('tiktokShop', () => ratingDays(shopContext, period.days), null) : null,
      adsContext ? tools.attempt('tiktokAds', () => gmvProductDays(adsContext, period.start, period.end), null) : null,
      tools.attempt('booking', () => readBookings(projectId), null),
    ])
    for (const read of [orders, affiliate, videos, ratings]) {
      if (!read) continue
      tools.pending('tiktokShop', read.pendingDays)
      // A read the app has no scope for (the affiliate orders, without the affiliate scope) is left out, not reported.
      if (read.error && !isScopeDenied(read.error)) tools.fail('tiktokShop', new Error(read.error))
    }
    if (ads) tools.fail('tiktokAds', ads.failures)
    if (booking) tools.fail('booking', booking.failures)

    type TargetHistory = Awaited<ReturnType<typeof roiTargetHistory>>
    const noTargets: TargetHistory = {}
    const [videoAds, targets] = await Promise.all([
      adsContext && ads ? tools.attempt('tiktokAds', () => gmvVideoDays(adsContext, period.start, period.end, ads.days, ads.campaigns), null) : null,
      adsContext && ads ? tools.attempt('tiktokAds', () => roiTargetHistory(adsContext, ads.campaigns), noTargets) : noTargets,
    ])
    if (videoAds) tools.fail('tiktokAds', videoAds.failures)

    /* ------------------------------------------------ per bucket --- */
    const shopDay = (day: string) => orders?.values[day]
    const adsDay = (day: string) => (ads && !ads.failedDays.has(day) ? Object.values(ads.days[day] ?? {}) : null)
    const ratingDay = (day: string) => {
      const value = ratings?.values[day]
      return value && value.available ? Object.values(value.products) : null
    }
    const series = {
      gmv: perBucket(period, (day) => shopDay(day)?.gmv),
      netGmv: perBucket(period, (day) => (shopDay(day) ? shopDay(day)!.gmv - shopDay(day)!.cancelledGmv : null)),
      platformVoucher: perBucket(period, (day) => (shopDay(day) ? shopDay(day)!.platformDiscount + shopDay(day)!.shippingPlatformDiscount : null)),
      sellerVoucher: perBucket(period, (day) => (shopDay(day) ? shopDay(day)!.sellerDiscount + shopDay(day)!.shippingSellerDiscount : null)),
      adsCost: perBucket(period, (day) => adsDay(day)?.reduce((sum, f) => sum + f.cost, 0)),
      adsRevenue: perBucket(period, (day) => adsDay(day)?.reduce((sum, f) => sum + f.revenue, 0)),
      commission: perBucket(period, (day) => {
        const value = affiliate?.values[day]
        return value ? Object.values(value.creators).reduce((sum, c) => sum + c.commission, 0) : null
      }),
      reviews: perBucket(period, (day) => ratingDay(day)?.reduce((sum, r) => sum + r.reviews, 0)),
      badReviews: perBucket(period, (day) => ratingDay(day)?.reduce((sum, r) => sum + r.bad, 0)),
    }
    const total = (values: Array<number | null>) => values.reduce<number>((sum, v) => sum + (v ?? 0), 0)

    /* -------------------------------------------------- per KOC --- */
    // Who each video belongs to: the booking sheet first (it names the KOC it paid), then TikTok's own records.
    const inPeriod = new Set(period.days)
    const videoOwner = new Map<string, string>()
    for (const day of period.days) {
      for (const video of videos?.values[day]?.videos ?? []) if (video.creator && video.authorType !== 'OFFICIAL') videoOwner.set(video.id, video.creator)
      for (const [id, video] of Object.entries(affiliate?.values[day]?.videos ?? {})) videoOwner.set(id, video.creator)
    }
    const bookingCost = new Map<string, number>()
    let bookingTotal = 0
    for (const row of booking?.rows ?? []) {
      if (row.videoId && row.koc) videoOwner.set(row.videoId, row.koc)
      // By the day it aired, as the booking report counts it.
      if (!row.airedOn || !inPeriod.has(row.airedOn)) continue
      bookingTotal += row.cost
      if (row.koc) addTo(bookingCost, row.koc, row.cost)
    }

    const kocs = new Map<string, CostRoiKoc>()
    const kocOf = (koc: string) => {
      let own = kocs.get(koc)
      if (!own) kocs.set(koc, (own = { koc, gmv: 0, orders: 0, commission: 0, adsCost: 0, adsRevenue: 0, bookingCost: 0, videos: 0, totalCost: 0 }))
      return own
    }
    const kocVideos = new Map<string, Set<string>>()
    for (const day of period.days) {
      for (const [name, creator] of Object.entries(affiliate?.values[day]?.creators ?? {})) {
        const own = kocOf(name)
        own.gmv += creator.gmv
        own.orders += creator.orders
        own.commission += creator.commission
        const seen = kocVideos.get(name) ?? new Set<string>()
        creator.videos.forEach((video) => seen.add(video))
        kocVideos.set(name, seen)
      }
    }
    let unattributedAdsCost = 0
    for (const day of period.days) {
      for (const [video, figures] of Object.entries(videoAds?.days[day] ?? {})) {
        const owner = videoOwner.get(video)
        if (!owner) {
          unattributedAdsCost += figures.cost
          continue
        }
        const own = kocOf(owner)
        own.adsCost += figures.cost
        own.adsRevenue += figures.revenue
      }
    }
    for (const [koc, cost] of bookingCost) kocOf(koc).bookingCost += cost
    for (const own of kocs.values()) {
      own.videos = kocVideos.get(own.koc)?.size ?? 0
      own.totalCost = own.commission + own.adsCost + own.bookingCost
    }

    /* ---------------------------------------------- per product --- */
    const products = new Map<string, CostRoiProduct>()
    const productOf = (key: string, name?: string) => {
      let own = products.get(key)
      if (!own) {
        own = {
          key,
          name: name ?? key,
          gmv: 0,
          netGmv: 0,
          voucher: 0,
          commission: 0,
          adsCost: 0,
          adsRevenue: 0,
          adsOrders: 0,
          target: null,
          levels: [],
          best: null,
          reviews: null,
          badReviews: null,
        }
        products.set(key, own)
      } else if (name && own.name === key) own.name = name
      return own
    }
    for (const day of period.days) {
      for (const [key, product] of Object.entries(shopDay(day)?.products ?? {})) {
        const own = productOf(key, product.name)
        own.gmv += product.gmv
        own.netGmv += product.gmv - product.cancelledGmv
        own.voucher += product.platformDiscount + product.sellerDiscount
      }
      for (const creator of Object.values(affiliate?.values[day]?.creators ?? {})) {
        for (const [key, product] of Object.entries(creator.products)) productOf(key).commission += product.commission
      }
      const rated = ratings?.values[day]
      if (rated?.available) {
        for (const [key, rating] of Object.entries(rated.products)) {
          const own = productOf(key)
          own.reviews = (own.reviews ?? 0) + rating.reviews
          own.badReviews = (own.badReviews ?? 0) + rating.bad
        }
      }
    }

    // Spend by product, and by the ROI target in force that day.
    const levels = new Map<string, Map<number, RoiLevel & { seen: Set<string> }>>()
    let targetDays = 0
    for (const day of period.days) {
      const filed = targets[day]
      if (filed) targetDays += 1
      for (const [key, figures] of Object.entries(ads?.days[day] ?? {})) {
        const own = productOf(key)
        own.adsCost += figures.cost
        own.adsRevenue += figures.revenue
        own.adsOrders += figures.orders
        if (!filed) continue
        for (const [campaign, part] of Object.entries(figures.byCampaign)) {
          const target = filed[campaign]?.roasBid
          if (!target || part.cost <= 0) continue
          const byTarget = levels.get(key) ?? new Map()
          const level = byTarget.get(target) ?? { target, days: 0, cost: 0, revenue: 0, seen: new Set<string>() }
          level.cost += part.cost
          level.revenue += part.revenue
          if (!level.seen.has(day)) {
            level.seen.add(day)
            level.days += 1
          }
          byTarget.set(target, level)
          levels.set(key, byTarget)
        }
      }
    }
    // The target each product runs at now: the campaigns that promote it (by list, or all products of the shop).
    const current = new Map<string, number>()
    for (const campaign of ads?.campaigns ?? []) {
      if (!campaign.roasBid) continue
      const promoted = campaign.items ?? [...products.keys()].filter((key) => (products.get(key)?.adsCost ?? 0) > 0)
      for (const key of promoted) current.set(key, Math.max(current.get(key) ?? 0, campaign.roasBid))
    }
    for (const own of products.values()) {
      own.levels = [...(levels.get(own.key)?.values() ?? [])].map(({ seen: _seen, ...level }) => level).sort((a, b) => a.target - b.target)
      own.best = bestLevel(own.levels)
      own.target = current.get(own.key) ?? null
    }

    if (ratings) tools.note('tiktokShop', 'noteRatings', { count: 25 })

    return {
      buckets: period.buckets.map((at, i) => ({
        at,
        gmv: series.gmv[i],
        netGmv: series.netGmv[i],
        platformVoucher: series.platformVoucher[i],
        sellerVoucher: series.sellerVoucher[i],
        adsCost: series.adsCost[i],
        adsRevenue: series.adsRevenue[i],
        commission: series.commission[i],
        reviews: series.reviews[i],
        badReviews: series.badReviews[i],
      })),
      totals: {
        gmv: total(series.gmv),
        netGmv: total(series.netGmv),
        platformVoucher: total(series.platformVoucher),
        sellerVoucher: total(series.sellerVoucher),
        adsCost: total(series.adsCost),
        adsRevenue: total(series.adsRevenue),
        commission: total(series.commission),
        bookingCost: bookingTotal,
        reviews: total(series.reviews),
        badReviews: total(series.badReviews),
      },
      kocs: [...kocs.values()].filter((k) => k.gmv > 0 || k.totalCost > 0).sort((a, b) => b.gmv - a.gmv),
      products: [...products.values()].filter((p) => p.gmv > 0 || p.adsCost > 0).sort((a, b) => b.gmv + b.adsRevenue - (a.gmv + a.adsRevenue)),
      targetDays,
      unattributedAdsCost,
    }
  })
}
