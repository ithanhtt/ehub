import type { BookingFileSummary } from '@/modules/analytics/shared/sheet-notice'

/**
 * Booking & KOC: what booked videos do to the rest.
 *
 * Every day, three counts of videos: the booked ones that aired (booking
 * data), all the videos posted with the shop's products in the cart (TikTok
 * Shop's video analytics), and the videos GMV Max put money behind (TikTok
 * Ads). The organic videos — those posted with the cart without a booking —
 * are all the videos less the booked ones: how they move with booking is the
 * effect booking has on organic content.
 *
 * Built from what the shop's app may read: the affiliate orders need a scope
 * the app may not have, so nothing here depends on them.
 */

export type BookingKocBucket = {
  at: string
  /** Booked videos aired, and their fees (booking data). */
  booked: number
  bookingCost: number
  /** Videos posted with the shop's products in the cart; null until TikTok has the day's analytics. */
  postedVideos: number | null
  /** Posted less booked: the videos that came without a booking. */
  organicVideos: number | null
  /** Distinct videos GMV Max spent on; null without TikTok Ads. */
  adsVideos: number | null
  /** Booked videos among them. */
  bookedOnAds: number | null
}

/** Booking's effect on organic videos, day by day over the period. */
export type BookingImpact = {
  /** Organic videos a day, on days with booked videos aired and on days without; null with no such day. */
  organicWithBooking: number | null
  organicWithout: number | null
  daysWithBooking: number
  daysWithout: number
}

export type BookingKocProduct = {
  /** TikTok product id, or what the booking data wrote when it could not be matched. */
  key: string
  name: string
  booked: number
  /** Days of the period with at least one booked video aired. */
  airDays: number
  postedVideos: number
  organicVideos: number
  adsVideos: number
  /** Per bucket, lined up with the buckets: booked, and organic videos of the product. */
  bookedByBucket: number[]
  organicByBucket: Array<number | null>
}

export type BookingKocKoc = {
  koc: string
  name: string
  booked: number
  cost: number
  /** Their videos posted with the cart in the period (TikTok Shop), and their GMV that day. */
  postedVideos: number
  postedGmv: number
  /** Their booked videos GMV Max spent on, and what it spent on them. */
  onAds: number
  adsCost: number
}

export type BookingKocData = {
  buckets: BookingKocBucket[]
  totals: {
    booked: number
    bookingCost: number
    bookedKocs: number
    postedVideos: number
    organicVideos: number
    adsVideos: number
    bookedOnAds: number
    /** GMV Max spend on booked videos. */
    adsCostOnBooked: number
  }
  impact: BookingImpact
  /** The last day TikTok's video analytics had, within the period. */
  analyticsThrough: string | null
  products: BookingKocProduct[]
  kocs: BookingKocKoc[]
  /** What the booking data holds, for the notice above the report. */
  sheet: BookingFileSummary | null
}
