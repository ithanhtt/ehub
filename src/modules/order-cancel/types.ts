/**
 * Orders & cancellations: the orders Sapo records per product — created and
 * cancelled — beside the orders GMV Max ads brought each product, and when in
 * the day orders come and cancellations happen least.
 *
 * Shared by the server that builds it (report.ts) and the widgets.
 */

export type OrderCancelBucket = {
  at: string
  /** Sapo orders placed, and of them the cancelled — as orders; null for days not read yet. */
  created: number | null
  cancelled: number | null
  /** GMV Max: orders, spend. */
  adsOrders: number | null
  adsCost: number | null
}

export type OrderCancelProduct = {
  /** Sapo product id. */
  key: string
  name: string
  /** Orders holding it, and of them the cancelled. */
  created: number
  cancelled: number
  /** The GMV Max orders of the TikTok product it matched by SKU; null when unmatched. */
  adsOrders: number | null
  adsRevenue: number | null
  tiktokProductId: string | null
  /** By hour of the day: its orders and cancellations. */
  hours: Array<[number, number]>
}

export type OrderCancelData = {
  buckets: OrderCancelBucket[]
  totals: { created: number; cancelled: number; adsOrders: number; adsCost: number; adsRevenue: number }
  products: OrderCancelProduct[]
  /** Over the period: orders and cancellations by hour of the day (0–23, Vietnam time), and the days behind them. */
  hours: { created: number[]; cancelled: number[]; days: number }
  /** How ads orders were tied to Sapo products: by SKU through TikTok Shop, or not at all. */
  matching: { mode: 'sku' | 'none'; matchedAdsOrders: number; unmatchedAdsOrders: number }
}
