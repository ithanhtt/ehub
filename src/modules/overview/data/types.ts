/**
 * The overview dashboard's data contract, shared by the server that builds it
 * and the client that draws it.
 *
 * Every period is in Vietnam time (UTC+7) — the time zone of the ad accounts
 * and the Sapo store alike — and every amount in the source's own currency.
 */

/** A preset, or 'custom' — which comes with its own dates (see period.ts). */
export type DashboardRange = 'today' | '7d' | '30d' | 'custom'

/** The presets offered as buttons. */
export const DASHBOARD_RANGES: readonly DashboardRange[] = ['today', '7d', '30d']

/** One bucket on the time axis: an hour ("2026-09-10 14:00") for today, a date otherwise. */
export type TimeBucket = { at: string }

export type Failure = { source: string; message: string }

export interface GmvMaxTotals {
  cost: number
  revenue: number
  orders: number
}

export interface GmvMaxOverview {
  currency: string
  totals: GmvMaxTotals
  /** The same-length period just before, for the deltas; for today, yesterday up to the same time. */
  previous: GmvMaxTotals | null
  /**
   * Per day, or — for today — cumulative per hour, ending at the live total.
   * null for an hour TikTok has not broken down yet: drawn as a gap, never guessed.
   */
  byTime: Array<TimeBucket & { cost: number | null; revenue: number | null; orders: number | null }>
  /**
   * The comparison period, lined up with `byTime` position by position: for
   * today, yesterday's running total at the same hour; otherwise the matching
   * day of the previous period. Empty when there is nothing to compare with.
   */
  previousByTime: Array<{ cost: number | null; revenue: number | null; orders: number | null }>
  byStore: Array<GmvMaxTotals & { storeId: string; storeName: string; advertiserName: string }>
  /** Latest hour TikTok has reported spend for (today view only) — its reporting lags by about an hour. */
  dataThrough: string | null
  /** Shops counted, out of all the connection can report GMV Max for. */
  scope: { selected: number; total: number }
  /** When these figures were read from TikTok. */
  fetchedAt: string
  failures: Failure[]
}

/**
 * Sapo's own revenue report ("Báo cáo doanh thu theo thời gian"), column for
 * column: the orders placed in a period and their value, less every refund
 * made in it — cancellations and returns alike, whenever their order was
 * placed. Measured against the report's export: orders, returns, VAT and both
 * revenue figures to the đồng; `lines` and `discounts` within a few đồng an
 * hour (Sapo rounds VAT out of each line its own way).
 */
export interface SapoSales {
  /** Số lượng đơn hàng: orders placed, cancelled ones included. */
  orders: number
  /** Tiền hàng: their lines at list price, VAT taken out. */
  lines: number
  /** Giảm giá, VAT taken out. */
  discounts: number
  /** Tiền hàng trả lại: refunded in the period — cancelled and returned orders — VAT taken out. */
  returns: number
  /** Doanh thu thuần = lines − discounts − returns. */
  netRevenue: number
  /** Phí giao hàng. */
  shipping: number
  /** Tiền thuế: VAT on the orders placed, less VAT refunded. */
  tax: number
  /** Tổng doanh thu = netRevenue + shipping + tax: the orders' value with VAT, less what was refunded. */
  revenue: number
}

/** For the orders created in a period: how many, how many of them were cancelled, and their gross value. */
export interface SapoTotals {
  created: number
  cancelled: number
  /** Gross value of the created orders, cancelled ones included. */
  gmv: number
  /** The same without the cancelled orders. */
  net: number
  /** The period as Sapo's revenue report counts it — the revenue figure the page leads with. */
  sales: SapoSales
}

/**
 * When in the day orders come in: Sapo orders created, by hour of the day
 * (0–23, Vietnam time), over exactly the view's days — the same days as every
 * other figure on the page.
 */
export interface SapoHours {
  /**
   * The today view: today's orders in each hour, the one in progress
   * included; null for hours still ahead. The longer views: the average per
   * day for each hour, today joining only for the hours it has finished.
   */
  profile: Array<number | null>
  /** Orders in each hour over the view's days, and how many days are behind each hour. */
  totals: number[]
  counts: number[]
  /** The previous period of the same length, figured the same way: yesterday's hours, or the previous 7/30 days' average. null until synced. */
  previous: number[] | null
  /** The longer views' weekday rows, Monday first: the average per day for each hour, and the days behind it. Empty for today. */
  week: Array<{ weekday: number; hours: Array<number | null>; counts: number[] }>
  /** The hour now, when today is one of the view's days. */
  currentHour: number | null
  /** Synced days of the view. */
  days: number
}

/** The products sold over the view's days, for the best-sellers card and the "no new orders for a while" list. */
export interface SapoProducts {
  /**
   * Busiest first. `orders` are the orders holding the product (once each,
   * whatever the units), `quantity` the units in them, `gmv` its lines'
   * value after discounts, without shipping — all three counting cancelled
   * orders, as the day totals do; `cancelled` and `cancelledGmv` are the
   * cancelled share. `last` is the creation time of its latest order, epoch ms.
   */
  items: Array<{
    key: string
    name: string
    orders: number
    quantity: number
    cancelled: number
    gmv: number
    cancelledGmv: number
    last: number
  }>
  /** Start of the view's first day, epoch ms: the span the usual order rate is taken over. */
  since: number
  /** Days of the view whose products are still being read (or read again for newer figures). */
  pendingDays: number
  /** Sapo admin's product page prefix — a numeric key appended opens the product; empty when unknown. */
  adminUrl: string
  /**
   * The end of a view that stops before today, epoch ms: "no order for an
   * hour" is then counted back from there. null when the view reaches today.
   */
  until: number | null
}

/** Every product the store has for sale, for the "all products" view of the quiet list. */
export interface SapoCatalog {
  /** `last`: its latest order among the days kept, on the chosen channels, epoch ms; null when none. */
  items: Array<{ key: string; name: string; last: number | null }>
  /** Start of the earliest day with products kept, epoch ms: how far back "no order" reaches. */
  knownSince: number | null
  fetchedAt: string
}

export interface SapoOverview {
  currency: string
  /** Over the days already synced; `pendingDays` says how many are still missing. */
  totals: SapoTotals
  previous: SapoTotals | null
  /**
   * Per day, or — for today — cumulative per hour. null for a day not synced
   * yet: a gap, never a zero. `revenue` is Sapo's Tổng doanh thu, cumulative
   * like the rest; `sales` is the bucket's own report row (for today, that
   * hour alone — the lines of Sapo's hourly export).
   */
  byTime: Array<
    TimeBucket & {
      created: number | null
      cancelled: number | null
      gmv: number | null
      revenue: number | null
      sales: SapoSales | null
    }
  >
  /** The comparison period, lined up with `byTime` position by position (see GmvMaxOverview). */
  previousByTime: Array<{ created: number | null; cancelled: number | null; gmv: number | null; revenue: number | null }>
  /** Days of this view (and its comparison period) still being fetched in the background. */
  pendingDays: number
  /**
   * The same, split — days of the view itself (its figures are short until
   * they land) and of the comparison period (only the changes are) — with the
   * days the view needs in all, for a progress bar. `returns` counts the
   * earlier days still being read only for the refunds made on the view's
   * days (returns land up to weeks after their order), and `catchingUp` says
   * the recent refunds are still being read: until both clear, the revenue
   * figures may be high.
   */
  sync: { current: number; previous: number; total: number; returns: number; catchingUp: boolean }
  /** The sales channels counted; null for every channel. */
  scope: { channels: string[] | null }
  /** When today's orders were last read from Sapo; null before the first read. */
  fetchedAt: string | null
  hours: SapoHours
  products: SapoProducts
  failures: Failure[]
}

/** What the "choose data sources" dialog offers, and what is chosen now. */
export interface DashboardSources {
  tiktok: {
    connectionId: string
    connectionName: string
    shops: Array<{ key: string; advertiserId: string; advertiserName: string; storeId: string; storeName: string }>
    /** Ad accounts the token reaches that run no GMV Max shop, so have nothing to choose. */
    accountsWithoutShops: number
    selected: string[] | null
    failures: Failure[]
  } | null
  sapo: {
    connectionId: string
    connectionName: string
    /** Channels seen in the synced days, busiest first, with their orders over 30 days. */
    channels: Array<{ name: string; orders: number }>
    selected: string[] | null
  } | null
}

export interface DashboardData {
  range: DashboardRange
  /** The days the view covers, for its labels. */
  period: { start: string; end: string; days: number }
  generatedAt: string
  /** null when the project has no connection of that kind. */
  gmvMax: GmvMaxOverview | null
  sapo: SapoOverview | null
}
