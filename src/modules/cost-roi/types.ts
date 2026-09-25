/**
 * Cost & ROI: what selling on TikTok costs — vouchers (TikTok's and the
 * shop's), GMV Max spend, creators' commission, booking fees — against the
 * GMV it brings; which ROI target delivers best per product; and how bad
 * reviews move with GMV and spend.
 */

export type CostRoiBucket = {
  at: string
  /** TikTok Shop: GMV of the orders placed (cancelled included), and without the cancelled. */
  gmv: number | null
  netGmv: number | null
  /** Discounts on orders not cancelled: funded by TikTok, and by the shop (products and shipping). */
  platformVoucher: number | null
  sellerVoucher: number | null
  /** GMV Max. */
  adsCost: number | null
  adsRevenue: number | null
  /** Creators' commission on their orders (estimated until settled). */
  commission: number | null
  /** Reviews left, and of them 1–2 stars, on the products read; null where TikTok has no figures yet. */
  reviews: number | null
  badReviews: number | null
}

export type CostRoiKoc = {
  koc: string
  gmv: number
  orders: number
  commission: number
  /** GMV Max spend and revenue on this creator's videos. */
  adsCost: number
  adsRevenue: number
  /** Booking fees of the videos aired in the period. */
  bookingCost: number
  videos: number
  totalCost: number
}

export type RoiLevel = {
  /** The ROI target (roas_bid) in force. */
  target: number
  days: number
  cost: number
  revenue: number
}

export type CostRoiProduct = {
  key: string
  name: string
  gmv: number
  netGmv: number
  voucher: number
  commission: number
  adsCost: number
  adsRevenue: number
  adsOrders: number
  /** The ROI target now, from the campaigns that spent on it (the highest when several). */
  target: number | null
  /** Spend and revenue grouped by the target in force on each day — from the days the targets were filed. */
  levels: RoiLevel[]
  /** The level that delivered best (see report.ts), when enough days back it. */
  best: RoiLevel | null
  reviews: number | null
  badReviews: number | null
}

export type CostRoiData = {
  buckets: CostRoiBucket[]
  totals: {
    gmv: number
    netGmv: number
    platformVoucher: number
    sellerVoucher: number
    adsCost: number
    adsRevenue: number
    commission: number
    bookingCost: number
    reviews: number
    badReviews: number
  }
  kocs: CostRoiKoc[]
  products: CostRoiProduct[]
  /** Days with filed ROI targets in the period — the history "best target" draws on. */
  targetDays: number
  /** Spend on videos no creator could be named for (the shop's own, or unknown). */
  unattributedAdsCost: number
}
