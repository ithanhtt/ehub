import type { BookingFileSummary } from '@/modules/analytics/shared/sheet-notice'

/**
 * Video & product GMV: booked videos aired, all new videos posted with the
 * product attached, and the product's GMV — per day or month, with how the
 * three move together.
 */

export type VideoGmvBucket = {
  at: string
  /** Booked videos aired (booking sheet); null without a booking sheet. */
  booked: number | null
  /** New videos posted with a product attached — by creators and by the shop (TikTok Shop analytics); null while TikTok has no figures yet. */
  attached: number | null
  /** Of the booked videos aired, those TikTok lists as posted with a product. */
  bookedAttached: number | null
  /** GMV of the orders placed (TikTok Shop, cancelled included). */
  gmv: number | null
}

export type VideoGmvProduct = {
  key: string
  name: string
  booked: number
  attached: number
  gmv: number
  bookedByBucket: number[]
  /** null where the analytics have no figures yet. */
  attachedByBucket: Array<number | null>
  gmvByBucket: number[]
}

export type VideoGmvData = {
  buckets: VideoGmvBucket[]
  totals: { booked: number; attached: number; bookedAttached: number; gmv: number }
  products: VideoGmvProduct[]
  /** The last day TikTok's analytics had figures for, within the period. */
  analyticsThrough: string | null
  /** What the booking file holds, for the notice above the report. */
  sheet: BookingFileSummary | null
}
