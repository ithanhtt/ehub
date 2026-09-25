/**
 * TikTok Shop's orders as records, and the ledger that keeps the recent days
 * current between full reads — the part of analytics/data/tiktok-shop.ts that
 * touches neither the network nor the disk, so it can be tried offline on
 * made-up pages. Nothing here imports anything at run time.
 *
 * Why a ledger. A day's figures are sums, and a sum cannot take back what one
 * order put into it: an order cancelled after the day was read would have to
 * be read again with the whole day. So for the days that still change (today
 * and the SETTLE_DAYS before it) the ledger keeps each order's own record —
 * what it adds to its day — and the day is summed from those. An order seen
 * again (the sweep asks TikTok for the orders changed since it last asked)
 * replaces its record: a status change moves the amounts exactly once, however
 * often the order is seen. Of each older day only the ids of its cancelled
 * orders are kept, which is what tells whether a change seen later (a late
 * cancellation) is one its kept figures lack; such a day is marked `touched`,
 * and read again in full.
 *
 * The records are merged by `update_time`: of two sightings of an order the
 * later one stands, so a full read and a sweep crossing each other never put
 * an older state back.
 */

/* ---------------------------------------------------------------- figures --- */

export type ShopProductDay = {
  name: string
  /** sku_id → seller_sku: what ties the product to the same one in Sapo. */
  skus: Record<string, string>
  /** Orders holding it (once each), and the units in them — cancelled ones included, as GMV counts them. */
  orders: number
  units: number
  /** Its lines at sale price (after the shop's own discounts, before TikTok's). */
  gmv: number
  cancelledOrders: number
  cancelledGmv: number
  /** On its lines in orders not cancelled: TikTok's and the shop's discounts. */
  platformDiscount: number
  sellerDiscount: number
  /** By the hour its orders were placed (Vietnam time): [orders, value not cancelled]; hours without orders left out. */
  hours: Record<string, [number, number]>
}

/** One hour's orders placed: [orders, gmv, cancelled, cancelled gmv]. */
export type ShopHourTally = [number, number, number, number]

export type ShopOrderDay = {
  orders: number
  cancelled: number
  gmv: number
  cancelledGmv: number
  /** Over orders not cancelled: vouchers and discounts TikTok funded, and those the shop did — on products, and on shipping. */
  platformDiscount: number
  sellerDiscount: number
  shippingPlatformDiscount: number
  shippingSellerDiscount: number
  /**
   * The same by the hour placed, Vietnam time, 0–23. An order TikTok sent
   * without a create_time is in the day's totals but in no hour, so the hours
   * can sum to a little less than the day — never to a false midnight peak.
   */
  hours: ShopHourTally[]
  products: Record<string, ShopProductDay>
  /**
   * Refunds TikTok completed on the day's orders (the return/refund requests,
   * filed under the day their order was placed): the amount given back to the
   * buyers (`refund_total` — what they paid for the items, shipping refunded
   * included), and the orders refunded. Orders counted as cancelled are left
   * out, their value is in `cancelledGmv` already. Absent when not known: the
   * app has no return/refund scope, the returns are still being read, or the
   * day is older than the returns kept. Not taken off `gmv` or anything else.
   */
  refunded?: number
  refundedOrders?: number
}

/* -------------------------------------------------------------- the clock --- */

const VN_OFFSET_MS = 7 * 3600_000

/** The day `days` after `day` (the same rule as overview/data/period.ts). */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** A Vietnam day's first second, Unix time. */
export const dayStart = (day: string) => Math.floor(Date.parse(`${day}T00:00:00+07:00`) / 1000)

const unixOf = (value: unknown) => {
  const at = Number(value)
  return Number.isFinite(at) && at > 0 ? at : null
}

/** The Vietnam day of a Unix time, or null when there is none. */
export function dayOfUnix(seconds: unknown): string | null {
  const at = unixOf(seconds)
  return at === null ? null : new Date(at * 1000 + VN_OFFSET_MS).toISOString().slice(0, 10)
}

/** The Vietnam hour of a Unix time, or null when there is none. */
export function hourOfUnix(seconds: unknown): number | null {
  const at = unixOf(seconds)
  return at === null ? null : new Date(at * 1000 + VN_OFFSET_MS).getUTCHours()
}

/** `{ amount: "1000", currency }`, or a bare number or string. */
export const money = (value: unknown) => Number((value && typeof value === 'object' ? (value as { amount?: unknown }).amount : value) ?? 0) || 0
export const list = (value: unknown) => (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [])

/* ---------------------------------------------------------------- records --- */

/** One line: [product id, product name, sku id, seller sku, sale price, TikTok's discount, the shop's]. */
export type OrderLine = [string, string, string, string, number, number, number]

/** What one order adds to its day — all the day's figures need of it. */
export type OrderRecord = {
  /** update_time, seconds: which of two sightings of the order is the later. */
  u: number
  /** create_time, seconds; null when TikTok sent none. */
  t: number | null
  /** 1: cancelled. */
  c: 0 | 1
  /** Shipping discounts: TikTok's, the shop's. */
  sp: number
  ss: number
  /** Its lines with a product (a line without one counts for nothing, as before). */
  l: OrderLine[]
}

export const orderIdOf = (order: Record<string, unknown>) => String(order.id ?? '')

/**
 * An order of orders/search (202309) as its record. Each line_items row is one
 * unit — the API has no quantity (the catalogue says so, endpoints.ts) — and
 * its sale_price is that unit's price.
 */
export function recordOf(order: Record<string, unknown>): OrderRecord {
  const payment = (order.payment ?? {}) as Record<string, unknown>
  const lines: OrderLine[] = []
  for (const line of list(order.line_items)) {
    const productId = String(line.product_id ?? '')
    if (!productId) continue
    lines.push([
      productId,
      String(line.product_name ?? productId),
      line.sku_id ? String(line.sku_id) : '',
      line.seller_sku ? String(line.seller_sku) : '',
      money(line.sale_price),
      money(line.platform_discount),
      money(line.seller_discount),
    ])
  }
  return {
    u: unixOf(order.update_time) ?? unixOf(order.create_time) ?? 0,
    t: unixOf(order.create_time),
    c: order.status === 'CANCELLED' ? 1 : 0,
    sp: money(payment.shipping_fee_platform_discount),
    ss: money(payment.shipping_fee_seller_discount),
    l: lines,
  }
}

/** Whether two records add the same to their day (their update_time aside). */
export function sameFigures(a: OrderRecord, b: OrderRecord) {
  return a.t === b.t && a.c === b.c && a.sp === b.sp && a.ss === b.ss && JSON.stringify(a.l) === JSON.stringify(b.l)
}

export const emptyDay = (): ShopOrderDay => ({
  orders: 0,
  cancelled: 0,
  gmv: 0,
  cancelledGmv: 0,
  platformDiscount: 0,
  sellerDiscount: 0,
  shippingPlatformDiscount: 0,
  shippingSellerDiscount: 0,
  hours: Array.from({ length: 24 }, (): ShopHourTally => [0, 0, 0, 0]),
  products: {},
})

/**
 * A day's figures from its orders' records. Summed in the order the orders
 * were placed (as a full read hands them over), so the name a product goes
 * by, when it changed during the day, is the same whichever way the records
 * came in.
 */
export function aggregate(records: Iterable<OrderRecord>): ShopOrderDay {
  const out = emptyDay()
  const sorted = [...records].sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity))
  for (const order of sorted) {
    const cancelled = order.c === 1
    const hour = hourOfUnix(order.t)
    const tally = hour === null ? null : out.hours[hour]
    out.orders += 1
    if (tally) tally[0] += 1
    if (cancelled) {
      out.cancelled += 1
      if (tally) tally[2] += 1
    } else {
      out.shippingPlatformDiscount += order.sp
      out.shippingSellerDiscount += order.ss
    }
    const counted = new Set<string>()
    for (const [productId, name, skuId, sellerSku, value, platform, seller] of order.l) {
      const product = (out.products[productId] ??= {
        name,
        skus: {},
        orders: 0,
        units: 0,
        gmv: 0,
        cancelledOrders: 0,
        cancelledGmv: 0,
        platformDiscount: 0,
        sellerDiscount: 0,
        hours: {},
      })
      if (skuId && sellerSku) product.skus[skuId] = sellerSku
      product.units += 1
      product.gmv += value
      out.gmv += value
      if (tally) tally[1] += value
      const productHour = hour === null ? null : (product.hours[String(hour)] ??= [0, 0])
      if (productHour && !cancelled) productHour[1] += value
      if (cancelled) {
        product.cancelledGmv += value
        out.cancelledGmv += value
        if (tally) tally[3] += value
      } else {
        product.platformDiscount += platform
        product.sellerDiscount += seller
        out.platformDiscount += platform
        out.sellerDiscount += seller
      }
      if (!counted.has(productId)) {
        counted.add(productId)
        product.orders += 1
        if (productHour) productHour[0] += 1
        if (cancelled) product.cancelledOrders += 1
      }
    }
  }
  return out
}

/* ------------------------------------------------------- paging, in parts --- */

export type Page = { items: Array<Record<string, unknown>>; next?: string }

/**
 * Every item of a listing over a time window [from, to), without ever keeping
 * a part of it as if it were all. When the pages run past `pageCap` the window
 * is cut in two and each half read on its own (what was read already is
 * handed over as well — `take` must not count an item twice); a window that
 * still holds too many at `minSpanS` seconds is a failure, not a short answer.
 */
export async function readSplitting(
  fetchPage: (from: number, to: number, token: string | undefined) => Promise<Page>,
  from: number,
  to: number,
  take: (items: Array<Record<string, unknown>>) => void,
  options: { pageCap: number; minSpanS?: number; what: string },
): Promise<void> {
  let token: string | undefined
  for (let page = 0; page < options.pageCap; page++) {
    const { items, next } = await fetchPage(from, to, token)
    take(items)
    token = next || undefined
    if (!token) return
  }
  if (to - from <= (options.minSpanS ?? 60)) {
    throw new Error(`TikTok Shop: more ${options.what} between ${from} and ${to} than ${options.pageCap} pages hold — not read, rather than read in part`)
  }
  const middle = from + Math.floor((to - from) / 2)
  await readSplitting(fetchPage, from, middle, take, options)
  await readSplitting(fetchPage, middle, to, take, options)
}

/* ---------------------------------------------------------------- ledger --- */

/** Days still changing — kept order by order: today and these before it. After that a day is settled. */
export const SETTLE_DAYS = 7

export type LedgerDay = {
  /** A full read of the day went in: its records are all of its orders, not only the ones seen changing. */
  full: boolean
  /** When the last full read that went in began (ms). */
  readAt: number
  /** Counts the changes to `orders`: what a sum kept aside is checked against. */
  rev: number
  orders: Record<string, OrderRecord>
}

/** A return/refund request, filed under the day its order was placed. */
export type ReturnRecord = {
  /** Its order, and the day that order was placed (null: unknown). */
  o: string
  d: string | null
  /** return_status, and the amount refunded (refund_amount.refund_total). */
  s: string
  a: number
  /** update_time, seconds. */
  u: number
  /** 1: its order was cancelled when last looked up. */
  c: 0 | 1
}

export type LedgerData = {
  version: 1
  /** Unix seconds: every order change before it has been applied. null: never swept. */
  cursor: number | null
  /** When the last sweep that went through ended (ms). */
  sweptAt: number
  /** The days still changing, order by order. */
  days: Record<string, LedgerDay>
  /** Settled days: the ids of their cancelled orders, as the last full read found them. */
  cancelled: Record<string, string[]>
  /** Settled days: when (ms, TikTok's update_time) a change was seen that their kept figures may lack. */
  touched: Record<string, number>
  /** The return/refund requests; null until they are first read. */
  returns: {
    cursor: number | null
    /** Unix seconds: requests are known from here on — the refunds of orders placed since. */
    from: number
    /** When the last read of them went through (ms); 0: never — nothing is known yet. */
    sweptAt: number
    items: Record<string, ReturnRecord>
  } | null
}

export const emptyLedger = (): LedgerData => ({ version: 1, cursor: null, sweptAt: 0, days: {}, cancelled: {}, touched: {}, returns: null })

/** Whether `day` is still kept order by order. */
export const inWindow = (day: string, today: string) => day >= shiftDay(today, -SETTLE_DAYS)

const touch = (ledger: LedgerData, day: string, atMs: number) => {
  ledger.touched[day] = Math.max(ledger.touched[day] ?? 0, atMs)
}

/**
 * Settles the days that have left the window: of each only its cancelled
 * orders' ids stay. A change the sweep applied after the day's last full read
 * marks it touched, so the kept figures — which the ledger stood in for until
 * now — are read again with it.
 */
export function roll(ledger: LedgerData, today: string, keepDays: number) {
  for (const [day, entry] of Object.entries(ledger.days)) {
    if (inWindow(day, today)) continue
    ledger.cancelled[day] = Object.entries(entry.orders)
      .filter(([, record]) => record.c === 1)
      .map(([id]) => id)
    let latest = 0
    for (const record of Object.values(entry.orders)) if (!entry.full || record.u * 1000 > entry.readAt) latest = Math.max(latest, record.u * 1000)
    if (latest > 0) touch(ledger, day, latest)
    delete ledger.days[day]
  }
  const oldest = shiftDay(today, -keepDays)
  for (const day of Object.keys(ledger.cancelled)) if (day < oldest) delete ledger.cancelled[day]
  for (const day of Object.keys(ledger.touched)) if (day < oldest) delete ledger.touched[day]
}

/**
 * Orders seen changing (a page of the sweep), each applied to the day it was
 * placed. In the window, its record replaces the one kept — an older sighting
 * never replaces a newer one. A settled day is marked touched when the order's
 * cancellation is news to it. An order without a create_time cannot be placed
 * in a day and is passed over (`skipped`); a full read of its day counts it.
 */
export function applyOrders(ledger: LedgerData, orders: Array<Record<string, unknown>>, today: string, keepDays: number) {
  const changed = new Set<string>()
  let skipped = 0
  const oldest = shiftDay(today, -keepDays)
  for (const order of orders) {
    const id = orderIdOf(order)
    const record = recordOf(order)
    const day = dayOfUnix(record.t)
    if (!id || !day) {
      skipped += 1
      continue
    }
    if (day < oldest) continue
    if (inWindow(day, today)) {
      const entry = (ledger.days[day] ??= { full: false, readAt: 0, rev: 0, orders: {} })
      const kept = entry.orders[id]
      if (kept && kept.u > record.u) continue
      entry.orders[id] = record
      if (!kept || !sameFigures(kept, record)) {
        entry.rev += 1
        changed.add(day)
      }
      // Not all of the day is known here: its kept figures must be read again to take this in.
      if (!entry.full) touch(ledger, day, record.u * 1000)
      continue
    }
    const known = ledger.cancelled[day]
    if (record.c === 1 ? !known?.includes(id) : known?.includes(id)) {
      touch(ledger, day, record.u * 1000)
      changed.add(day)
    }
  }
  return { changed, skipped }
}

/**
 * A full read of `day` (begun at `readAt`, ms) goes in. In the window its
 * records are merged with those kept — the later sighting of each order
 * standing, and orders placed after the read passed kept — and the day's
 * figures are summed from the merge; a settled day keeps its cancelled ids.
 * Returns the records the day's figures are to be summed from.
 */
export function mergeFull(ledger: LedgerData, day: string, records: Map<string, OrderRecord>, today: string, readAt: number, keepDays: number): OrderRecord[] {
  roll(ledger, today, keepDays)
  if (!inWindow(day, today)) {
    ledger.cancelled[day] = [...records].filter(([, record]) => record.c === 1).map(([id]) => id)
    return [...records.values()]
  }
  const entry = (ledger.days[day] ??= { full: false, readAt: 0, rev: 0, orders: {} })
  for (const [id, record] of records) {
    const kept = entry.orders[id]
    if (kept && kept.u > record.u) continue
    entry.orders[id] = record
    if (!kept || !sameFigures(kept, record)) entry.rev += 1
  }
  entry.full = true
  entry.readAt = Math.max(entry.readAt, readAt)
  entry.rev += 1
  return Object.values(entry.orders)
}

/**
 * Where the first sweep starts: at the earliest full read kept, so nothing
 * that changed after a day was read is missed; with none kept, now.
 */
export function initialCursor(ledger: LedgerData, nowS: number) {
  let earliest = nowS
  for (const entry of Object.values(ledger.days)) if (entry.full) earliest = Math.min(earliest, Math.floor(entry.readAt / 1000))
  return earliest
}

/** The day an order of the window was placed, and whether it is cancelled — from its record. */
export function findOrder(ledger: LedgerData, orderId: string): { day: string; cancelled: boolean } | null {
  for (const [day, entry] of Object.entries(ledger.days)) {
    const record = entry.orders[orderId]
    if (record) return { day, cancelled: record.c === 1 }
  }
  return null
}

/* --------------------------------------------------------------- refunds --- */

/**
 * The return_status values of a request whose refund has been paid out:
 * a return or refund completed, and a replacement refunded instead.
 */
export const REFUNDED = new Set(['RETURN_OR_REFUND_REQUEST_COMPLETE', 'REPLACEMENT_REQUEST_REFUND_SUCCESS'])

/** A return/refund request's refunded amount: refund_amount.refund_total. */
export const refundTotal = (row: Record<string, unknown>) => money(((row.refund_amount ?? {}) as Record<string, unknown>).refund_total)

export const returnIdOf = (row: Record<string, unknown>) => String(row.return_id ?? row.id ?? '')

/**
 * Requests seen changing, kept by id (the later sighting standing). The day
 * of each one's order comes from `orders` (order id → the day placed and
 * whether cancelled: looked up, or found in the window), else from what was
 * kept of the request before.
 */
export function applyReturns(ledger: LedgerData, rows: Array<Record<string, unknown>>, orders: Map<string, { day: string | null; cancelled: boolean }>) {
  const returns = ledger.returns
  if (!returns) return
  for (const row of rows) {
    const id = returnIdOf(row)
    const orderId = String(row.order_id ?? '')
    if (!id || !orderId) continue
    const u = unixOf(row.update_time) ?? unixOf(row.create_time) ?? 0
    const kept = returns.items[id]
    if (kept && kept.u > u) continue
    const order = orders.get(orderId)
    returns.items[id] = {
      o: orderId,
      d: order?.day ?? kept?.d ?? null,
      s: String(row.return_status ?? ''),
      a: refundTotal(row),
      u,
      c: order ? (order.cancelled ? 1 : 0) : (kept?.c ?? 0),
    }
  }
}

/**
 * The refunds completed per day their orders were placed, from `from` on —
 * the days whose requests are all known. Null while nothing is known (never
 * read, or the app may not read them). An order counted as cancelled (by the
 * ledger's own record of it, when it has one) is left out.
 */
export function refundsByDay(ledger: LedgerData): { from: string; days: Record<string, { amount: number; orders: number }> } | null {
  const returns = ledger.returns
  if (!returns || !returns.sweptAt) return null
  const from = dayOfUnix(returns.from)
  if (!from) return null
  const days: Record<string, { amount: number; orders: number }> = {}
  const counted = new Map<string, Set<string>>()
  for (const item of Object.values(returns.items)) {
    if (!item.d || item.d < from || !REFUNDED.has(item.s)) continue
    const inLedger = ledger.days[item.d]?.orders[item.o]
    const known = ledger.cancelled[item.d]
    const cancelled = inLedger ? inLedger.c === 1 : known ? known.includes(item.o) : item.c === 1
    if (cancelled) continue
    const day = (days[item.d] ??= { amount: 0, orders: 0 })
    day.amount += item.a
    const ids = counted.get(item.d) ?? new Set<string>()
    if (!ids.has(item.o)) {
      ids.add(item.o)
      day.orders += 1
    }
    counted.set(item.d, ids)
  }
  return { from, days }
}
