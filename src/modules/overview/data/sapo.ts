import 'server-only'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { sendRequest } from '@/core/plugins/http'
import { requirePlugin } from '@/core/plugins/registry'
import type { ConnectionContext } from '@/core/plugins/types'
import { memo } from './cache'
import { OTHER_CHANNEL } from './channels'
import { daysBetween, shiftDay, vnDate, type Period } from './period'
import { selectionOf } from './selection'
import type {
  DashboardRange,
  Failure,
  SapoCatalog,
  SapoHours,
  SapoOverview,
  SapoProducts,
  SapoSales,
  SapoTotals,
} from './types'

/**
 * Sapo orders and revenue — per day and per sales channel, today live,
 * earlier days kept on disk — figured the way Sapo's own revenue report
 * ("Báo cáo doanh thu theo thời gian") figures them, so the two agree.
 *
 * Two kinds of figures, from two reads:
 *
 * - The orders placed in a period (by `processed_on`, the time the report
 *   files an order under — a few seconds before `created_on`, now and then
 *   hours): how many, how many of them were cancelled (whenever that
 *   happened), their value with and without the cancelled ones, and their
 *   lines, VAT and shipping. Read day by day.
 *
 * - The refunds made in a period — cancellations and returns alike, whenever
 *   their order was placed. Sapo records both as refunds on the order, and
 *   its report takes them off the period they were made in: an order placed
 *   yesterday and cancelled today, or returned three weeks after it was
 *   placed, lowers today's revenue. Hence Tổng doanh thu = the orders' value
 *   less the refunds of the period; Doanh thu thuần is the same without VAT
 *   and shipping. Measured against the report's exports of 10 and 11 Sep
 *   2026: equal to the đồng, hour by hour.
 *
 * The refunds come from a ledger: every few seconds, the orders modified
 * since the last read (a refund modifies its order), usually a handful. It
 * starts on the day before the first run; a refund on an earlier day is found
 * on its order instead, when that order's day is read — so for those days
 * the RETURN_WINDOW_DAYS before them are read too.
 *
 * Everything is summed order by order: the admin API has no totals endpoint,
 * ignores `fields`, and a page of 250 orders weighs about 2 MB (measured).
 * This store takes 700–1,700 orders a day, so re-reading whole days on every
 * refresh is out of the question. Today is read whole once and every ten
 * minutes (which is what picks up cancellations for the cancelled count);
 * the ledger adds new orders in between. Earlier days are summed once and
 * kept in .data/cache; yesterday is re-read every half hour, anything three
 * or more days old never (its orders no longer change: cancellations land
 * within 1.4 days, and later returns are the ledger's). Missing days are
 * filled in behind the response, most recent first.
 *
 * Each day is split by `source_name` (TikTok Shop, Shopee, …) so the
 * dashboard can count only the channels a project chose, without fetching
 * anything again when that choice changes.
 *
 * Measured quirks this relies on: date bounds only match with a time and
 * offset (`2026-09-10T00:00:00+07:00`; a bare date matches nothing); `status`
 * must be left out — `status=any` returns zero orders; `modified_on_min`
 * filters (`updated_on_min` is ignored); and no read may reach past 30,000
 * orders ("Result window is too large", page × limit).
 */

const PAGE_SIZE = 250
/** Sapo refuses page × limit beyond 30,000, so no read can go further. */
const MAX_PAGES = 30_000 / PAGE_SIZE
/**
 * How far back a refund comes after its order: a day before the ledger counts
 * its returns from the orders of this many days before it (measured: 51 days
 * at most; 99 % within 29, and past 45 days a few hundred thousand đồng a day).
 */
const RETURN_WINDOW_DAYS = 45
/**
 * A custom range reaches back 180 days, and its comparison period up to 92
 * more (see period.ts); a day before the ledger needs RETURN_WINDOW_DAYS more.
 */
const KEEP_DAYS = 275 + RETURN_WINDOW_DAYS
/** v4 files orders by processed_on and keeps what the revenue report needs; older files are ignored and their days fetched again. */
const CACHE_VERSION = 4
/**
 * What a day's product figures hold: 2 adds each product's cancelled orders and
 * value. A day kept with older ones keeps its totals; its products are read
 * again when a view needs them.
 */
const PRODUCTS_VERSION = 2

/** How often the ledger reads what changed. The page polls every 15 s. */
const LIVE_MS = 10_000
/** How often today is read whole, to catch cancellations of earlier orders. */
const FULL_MS = 10 * 60_000
/** …and when nobody has the dashboard open: the background keeps it close, without reading 2 MB pages for no one. */
const IDLE_FULL_MS = 30 * 60_000
/** A dashboard read within this long counts as someone watching. */
const WATCHED_MS = 5 * 60_000
/**
 * The days the background keeps ready before anyone asks: today back through a
 * 30-day view and the 30 days it is compared with (and, for those before the
 * ledger, the days their returns are counted from). Longer custom ranges fill
 * in the rest when opened, and keep it.
 */
const WARM_DAYS = 61
/** Look-back for "modified since", covering orders written a little late. */
const OVERLAP_MS = 2 * 60_000
const PERSIST_MS = 60_000
/** A ledger further behind than this catches up behind the response; closer, the response waits for it. */
const CATCH_UP_MS = 2 * 3600_000
/** Behind by more than this, the revenue figures are flagged as still syncing. */
const BEHIND_MS = 5 * 60_000
/** Refunds read within this long are remembered by id, so overlapping reads count each once. */
const RECENT_MS = 3 * 86_400_000
/** A catch-up too big for one read goes in slices of a week of orders placed, back this far before the ledger's mark. */
const SLICE_DAYS = 7
const SLICE_LOOKBACK_DAYS = 60

/**
 * Sapo's call budget per store: a bucket of 40 calls that drains two a second.
 * Every read of a store shares one gate that keeps within it, with a few calls
 * spare for anything else using the store's API.
 */
const BUCKET_CALLS = 36
const DRAIN_PER_SECOND = 2
/**
 * Calls to one store under way at once. A page takes seconds to come back, so
 * waiting for each before the next left most of the budget unused; a page is
 * also about 2 MB, so not too many are held at once on a small server.
 */
const MAX_IN_FLIGHT = 4
/** Once a read's first page comes back full, the next pages are asked for this many at a time. */
const PAGE_BATCH = 3
/** Days filled in at once behind the response. */
const DAY_WORKERS = 3
/** While days are filled in, the cache file is written at most this often — and once they are all in. */
const BACKFILL_PERSIST_MS = 15_000

type Order = Record<string, unknown>

/**
 * One hour's orders placed: [orders, cancelled, gmv, cancelled value, lines,
 * VAT, shipping] — see Tally.
 */
type HourTally = [number, number, number, number, number, number, number]

type Tally = {
  /** Orders placed, cancelled ones included. */
  created: number
  /** Of those, the ones cancelled. */
  cancelled: number
  /** Value of every order placed (`total_price`: after discounts, VAT and shipping in), cancelled ones included. */
  gmv: number
  cancelledValue: number
  /** Their lines at list price, VAT taken out — Sapo's Tiền hàng (see linesOf). */
  lines: number
  /** The VAT inside `gmv`. */
  tax: number
  shipping: number
  /** The same for each hour of the day, Vietnam time, by the hour placed. */
  hours: HourTally[]
}

/** Refunds: [how many, amount with VAT, the VAT in it]. */
type RefundTally = [number, number, number]

/** One product's orders on one day, in one channel. */
type ProductDay = {
  name: string
  /** Orders containing it (an order with two lines of it counts once), and the units in them. */
  orders: number
  quantity: number
  /** Of those orders, the ones cancelled. Missing, like the values below, on days read before products version 2. */
  cancelled?: number
  /** Its lines' value after discounts (see `lineValue`), cancelled orders included — as the day's GMV counts them. */
  gmv?: number
  /** The part of `gmv` in cancelled orders. */
  cancelledGmv?: number
  /** Time of its latest order, epoch ms. */
  last: number
}

type DayStats = {
  sources: Record<string, Tally>
  /**
   * The refunds on this day's orders, by the day they were made (Vietnam
   * time), per channel — as far as they had happened when the day was read.
   * What the days before the ledger count their returns from.
   */
  refunds: Record<string, Record<string, RefundTally>>
  /**
   * Per channel, per product id. Missing on days summed before products were
   * kept: those are read again when a view needs them.
   */
  products?: Record<string, Record<string, ProductDay>>
  /** What `products` holds; see PRODUCTS_VERSION. */
  productsVersion?: number
  computedAt: number
  /** Old enough that its orders no longer change. */
  final: boolean
}

/** Every refund made since `since`, as the orders they modified were read. */
type Ledger = {
  /** The first day the ledger holds whole, Vietnam time. */
  since: string
  /** Orders modified up to here have been read, epoch ms (this server's clock, less OVERLAP_MS when read). */
  cursor: number
  /** Per day made, per channel, per hour (Vietnam time). */
  days: Record<string, Record<string, RefundTally[]>>
  /** The refunds counted in the last RECENT_MS, id → time made. */
  recent: Record<string, number>
}

/** In memory only: which of today's orders are counted, so the ledger adds each new one exactly once. */
type Live = {
  day: string
  ids: Set<unknown>
  at: number
  /** When today was last read whole, and when that read started. */
  fullAt: number
  readFrom: number
}

type State = {
  days: Record<string, DayStats>
  ledger: Ledger
  live: Live | null
  loaded: Promise<void> | null
  queue: Set<string>
  /** Days being read by a worker right now. */
  reading: Set<string>
  /** Workers filling in the queue. */
  workers: number
  lastError: string | null
  /** Why the last read of today failed, when it did. */
  todayError: string | null
  /** The ledger read in progress: one at a time, however long it takes. */
  sweep: Promise<void> | null
  sweptAt: number
  sweepError: string | null
  /** When the file was last written. */
  persistedAt: number
  /** The write under way, if any: one at a time, and a change made meanwhile is written after it. */
  writing: Promise<void> | null
  dirty: boolean
  /** When a dashboard last read these figures, epoch ms. */
  viewedAt: number
}

// A new key, so a hot reload does not hand this code an older in-memory shape.
const states = ((globalThis as unknown as { __adshubSapoDaysV8?: Map<string, State> }).__adshubSapoDaysV8 ??= new Map())

/** The call budget of one store, shared by every read of it (see BUCKET_CALLS). */
type Gate = { level: number; at: number; inFlight: number }
const gates = ((globalThis as unknown as { __adshubSapoGates?: Map<string, Gate> }).__adshubSapoGates ??= new Map())

const CACHE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'cache')
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const VN_OFFSET_MS = 7 * 3600_000
const DAY_MS = 86_400_000

const emptyHours = (): HourTally[] => Array.from({ length: 24 }, (): HourTally => [0, 0, 0, 0, 0, 0, 0])
const emptyRefundHours = (): RefundTally[] => Array.from({ length: 24 }, (): RefundTally => [0, 0, 0])

const emptyTally = (): Tally => ({
  created: 0,
  cancelled: 0,
  gmv: 0,
  cancelledValue: 0,
  lines: 0,
  tax: 0,
  shipping: 0,
  hours: emptyHours(),
})

/** A ledger starting on the day before today. */
const newLedger = (): Ledger => {
  const since = shiftDay(vnDate(new Date()), -1)
  return { since, cursor: Date.parse(`${since}T00:00:00+07:00`), days: {}, recent: {} }
}

/** The day's products are kept, with every figure the current version has. */
const hasProducts = (stats: DayStats | undefined) => !!stats?.products && stats.productsVersion === PRODUCTS_VERSION

/** An instant as Sapo's bounds accept it: local Vietnam time with its offset. */
const vnIso = (ms: number) => `${new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 19)}+07:00`
const vnHour = (ms: number) => new Date(ms + VN_OFFSET_MS).getUTCHours()

function fileFor(connectionId: string): string {
  // Our own generated ids; checked anyway, since they become a file name.
  if (!SAFE_ID.test(connectionId)) throw new Error('Unexpected connection id')
  return path.join(CACHE_DIR, `sapo-days-${connectionId}.json`)
}

async function stateFor(connectionId: string): Promise<State> {
  let state = states.get(connectionId)
  if (!state) {
    state = {
      days: {},
      ledger: newLedger(),
      live: null,
      loaded: null,
      queue: new Set(),
      reading: new Set(),
      workers: 0,
      lastError: null,
      todayError: null,
      sweep: null,
      sweptAt: 0,
      sweepError: null,
      persistedAt: 0,
      writing: null,
      dirty: false,
      viewedAt: 0,
    }
    states.set(connectionId, state)
  }
  const current = state
  current.loaded ??= readFile(fileFor(connectionId), 'utf8')
    .then((text) => {
      const parsed = JSON.parse(text) as { version?: number; days?: Record<string, DayStats>; ledger?: Ledger }
      // The days and the ledger are one: a day's refunds before the ledger are
      // whole only when the ledger has run since the day was read, so a day
      // never outlives its ledger.
      if (parsed.version === CACHE_VERSION && parsed.days && typeof parsed.days === 'object' && parsed.ledger?.since) {
        current.days = { ...parsed.days, ...current.days }
        current.ledger = parsed.ledger
      }
    })
    .catch(() => {
      /* no cache yet, or unreadable: start empty */
    })
  await current.loaded
  return current
}

async function writeState(connectionId: string, state: State) {
  const oldest = shiftDay(vnDate(new Date()), -KEEP_DAYS)
  for (const day of Object.keys(state.days)) if (day < oldest) delete state.days[day]
  for (const day of Object.keys(state.ledger.days)) if (day < oldest) delete state.ledger.days[day]

  await mkdir(CACHE_DIR, { recursive: true })
  const file = fileFor(connectionId)
  const temp = `${file}.tmp`
  state.persistedAt = Date.now()
  await writeFile(temp, JSON.stringify({ version: CACHE_VERSION, days: state.days, ledger: state.ledger }), 'utf8')
  await rename(temp, file)
}

/**
 * Writes the cache file. One write at a time — two at once would race on the
 * temporary file — and whatever changed while one was under way goes in the
 * next, so a burst of changes costs two writes, not one each.
 */
function persist(connectionId: string, state: State): Promise<void> {
  state.dirty = true
  state.writing ??= (async () => {
    try {
      while (state.dirty) {
        state.dirty = false
        await writeState(connectionId, state)
      }
    } finally {
      state.writing = null
    }
  })()
  return state.writing
}

function isFresh(day: string, stats: DayStats | undefined, today: string): boolean {
  if (!stats) return false
  if (stats.final) return true
  const age = Date.now() - stats.computedAt
  if (day === shiftDay(today, -1)) return age < 30 * 60_000
  return age < 6 * 3600_000
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function sapoRequest(context: ConnectionContext) {
  const sapo = requirePlugin('sapo')
  return { base: sapo.resolveBaseUrl(context), headers: sapo.customHeaders?.(context) ?? {} }
}

/**
 * Waits for room in the store's budget: a call under way fewer than
 * MAX_IN_FLIGHT, and a bucket that has drained enough to take one more. The
 * bucket is counted here as Sapo counts it, so a long backfill (months of days)
 * runs flat out without ever being turned away.
 */
async function enter(connectionId: string): Promise<Gate> {
  let gate = gates.get(connectionId)
  if (!gate) {
    gate = { level: 0, at: Date.now(), inFlight: 0 }
    gates.set(connectionId, gate)
  }
  for (;;) {
    const now = Date.now()
    gate.level = Math.max(0, gate.level - ((now - gate.at) / 1000) * DRAIN_PER_SECOND)
    gate.at = now
    if (gate.inFlight < MAX_IN_FLIGHT && gate.level + 1 <= BUCKET_CALLS) {
      gate.level += 1
      gate.inFlight += 1
      return gate
    }
    const drain = ((gate.level + 1 - BUCKET_CALLS) / DRAIN_PER_SECOND) * 1000
    await pause(Math.max(50, gate.inFlight >= MAX_IN_FLIGHT ? 50 : Math.ceil(drain)))
  }
}

/** One GET to the store's admin API, within its budget. */
async function sapoGet(context: ConnectionContext, pathAndQuery: string): Promise<unknown> {
  const { base, headers } = sapoRequest(context)
  const gate = await enter(context.connectionId)
  try {
    const response = await sendRequest({ url: `${base}${pathAndQuery}`, method: 'GET', headers }, { maxRetries: 3, timeoutMs: 60_000 })
    if (!response.ok) throw new Error(`Sapo ${response.status || ''} ${response.error ?? 'request failed'}`.trim())
    return response.data
  } finally {
    gate.inFlight -= 1
  }
}

async function ordersPage(context: ConnectionContext, query: string, page: number): Promise<Order[]> {
  const data = (await sapoGet(context, `/admin/orders.json?limit=${PAGE_SIZE}&page=${page}&${query}`)) as { orders?: Order[] } | null
  return Array.isArray(data?.orders) ? data.orders : []
}

/**
 * Every order matching `query`, handed over a page at a time (a page is about
 * 2 MB; a long read is never held whole). The first page tells whether there
 * are more; those are then asked for PAGE_BATCH at a time, until one comes
 * back short. Pages can come back overlapping when orders arrive mid-read —
 * every caller counts an order once.
 */
async function eachPage(context: ConnectionContext, query: string, take: (orders: Order[]) => void): Promise<void> {
  const first = await ordersPage(context, query, 1)
  take(first)
  if (first.length < PAGE_SIZE) return
  for (let page = 2; ; page += PAGE_BATCH) {
    if (page > MAX_PAGES) throw new Error('Sapo: more orders than one read can reach')
    const pages = Array.from({ length: Math.min(PAGE_BATCH, MAX_PAGES - page + 1) }, (_, i) => page + i)
    const lists = await Promise.all(pages.map((n) => ordersPage(context, query, n)))
    for (const list of lists) take(list)
    if (lists.some((list) => list.length < PAGE_SIZE)) return
  }
}

async function countOrders(context: ConnectionContext, query: string): Promise<number> {
  const data = (await sapoGet(context, `/admin/orders/count.json?${query}`)) as { count?: unknown } | null
  return Number(data?.count) || 0
}

const dayBounds = (day: string) =>
  `processed_on_min=${encodeURIComponent(`${day}T00:00:00+07:00`)}&processed_on_max=${encodeURIComponent(`${day}T23:59:59+07:00`)}`

const channelOf = (order: Order) => (typeof order.source_name === 'string' && order.source_name ? order.source_name : OTHER_CHANNEL)

/** When the revenue report files the order: `processed_on`, or its creation when that is missing. */
function placedAt(order: Order): number {
  const at = Date.parse(String(order.processed_on ?? order.created_on))
  return Number.isNaN(at) ? Date.parse(String(order.created_on)) : at
}

const lineItems = (order: Order) => (Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [])

/**
 * A line's value after discounts: `discounted_total`, price × quantity less
 * the discounts allocated to the line. Over an order's lines it adds up to the
 * order's total_price (measured: 133 orders out of 133), so the products' GMV
 * adds up to the day's. Gifts are lines at 0 ₫.
 */
function lineValue(line: Record<string, unknown>): number {
  if (line.discounted_total !== undefined && line.discounted_total !== null) {
    const total = Number(line.discounted_total)
    if (Number.isFinite(total)) return total
  }
  const allocations = Array.isArray(line.discount_allocations) ? (line.discount_allocations as Array<Record<string, unknown>>) : []
  const allocated = allocations.reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0)
  return (Number(line.price) || 0) * (Number(line.quantity) || 0) - allocated
}

/**
 * The order's lines at list price without VAT — the report's Tiền hàng. This
 * store's prices include VAT (`taxes_included`), and the report takes it out
 * of each line that carries some: price × quantity ÷ (1 + rate). A line with
 * none — a gift, 0 ₫ once discounted — counts at its list price. Within a few
 * đồng an hour of the report, which rounds each line its own way.
 */
function linesOf(order: Order): number {
  let sum = 0
  for (const line of lineItems(order)) {
    const value = (Number(line.price) || 0) * (Number(line.quantity) || 0)
    const taxes = Array.isArray(line.tax_lines) ? (line.tax_lines as Array<Record<string, unknown>>) : []
    const vat = taxes.reduce((s, tax) => s + (Number(tax.price) || 0), 0)
    const rate = taxes.reduce((s, tax) => s + (Number(tax.rate) || 0), 0)
    sum += order.taxes_included !== false && vat > 0 && rate > 0 ? value / (1 + rate) : value
  }
  return sum
}

/**
 * The order's refunds — cancellation or return, Sapo records both as one —
 * each with the time it was made and its amount with VAT and the VAT in it.
 * A refund's lines carry both (`subtotal` includes VAT when prices do).
 */
function refundsOf(order: Order): Array<{ id: string; at: number; amount: number; tax: number }> {
  const refunds = Array.isArray(order.refunds) ? (order.refunds as Array<Record<string, unknown>>) : []
  const out: Array<{ id: string; at: number; amount: number; tax: number }> = []
  for (const refund of refunds) {
    const at = Date.parse(String(refund.created_on ?? refund.processed_at))
    if (Number.isNaN(at)) continue
    const lines = Array.isArray(refund.refund_line_items) ? (refund.refund_line_items as Array<Record<string, unknown>>) : []
    const subtotal = lines.reduce((sum, line) => sum + (Number(line.subtotal) || 0), 0)
    const tax = lines.reduce((sum, line) => sum + (Number(line.total_tax) || 0), 0)
    out.push({ id: String(refund.id ?? `${String(order.id)}@${at}`), at, amount: order.taxes_included === false ? subtotal + tax : subtotal, tax })
  }
  return out
}

function addOrder(
  day: {
    sources: Record<string, Tally>
    products: Record<string, Record<string, ProductDay>>
    refunds: Record<string, Record<string, RefundTally>>
  },
  order: Order,
) {
  const channel = channelOf(order)
  const tally = (day.sources[channel] ??= emptyTally())
  const amount = Number(order.total_price ?? 0) || 0
  const at = placedAt(order)
  const hourly = tally.hours[Number.isNaN(at) ? 0 : vnHour(at)]
  const cancelled = Boolean(order.cancelled_on || order.status === 'cancelled')
  const lines = linesOf(order)
  const tax = Number(order.total_tax ?? 0) || 0
  const shipping = Number(order.total_shipping_price ?? 0) || 0

  tally.created += 1
  tally.gmv += amount
  tally.lines += lines
  tally.tax += tax
  tally.shipping += shipping
  hourly[0] += 1
  hourly[2] += amount
  hourly[4] += lines
  hourly[5] += tax
  hourly[6] += shipping
  if (cancelled) {
    tally.cancelled += 1
    tally.cancelledValue += amount
    hourly[1] += 1
    hourly[3] += amount
  }

  // Its refunds so far, filed under the day each was made.
  for (const refund of refundsOf(order)) {
    const cell = ((day.refunds[vnDate(new Date(refund.at))] ??= {})[channel] ??= [0, 0, 0])
    cell[0] += 1
    cell[1] += refund.amount
    cell[2] += refund.tax
  }

  // The products it held: each counted once per order, whatever its lines. Removed lines are skipped.
  const products = (day.products[channel] ??= {})
  const counted = new Set<string>()
  for (const line of lineItems(order)) {
    if (line.deleted === true) continue
    const key = line.product_id ? String(line.product_id) : typeof line.sku === 'string' && line.sku ? `sku:${line.sku}` : null
    if (!key) continue
    const entry = (products[key] ??= {
      name: String(line.title || line.name || key),
      orders: 0,
      quantity: 0,
      cancelled: 0,
      gmv: 0,
      cancelledGmv: 0,
      last: 0,
    })
    const value = lineValue(line)
    entry.quantity += Number(line.quantity) || 0
    entry.gmv = (entry.gmv ?? 0) + value
    if (cancelled) entry.cancelledGmv = (entry.cancelledGmv ?? 0) + value
    if (!counted.has(key)) {
      entry.orders += 1
      if (cancelled) entry.cancelled = (entry.cancelled ?? 0) + 1
      counted.add(key)
    }
    if (at > entry.last) entry.last = at
  }
}

async function computeDay(context: ConnectionContext, day: string) {
  const sources: Record<string, Tally> = {}
  const products: Record<string, Record<string, ProductDay>> = {}
  const refunds: Record<string, Record<string, RefundTally>> = {}
  const ids = new Set<unknown>()
  await eachPage(context, dayBounds(day), (orders) => {
    for (const order of orders) {
      // New orders arriving mid-sweep can shift a page; an id is counted once.
      if (ids.has(order.id)) continue
      ids.add(order.id)
      addOrder({ sources, products, refunds }, order)
    }
  })
  const stats: DayStats = {
    sources,
    refunds,
    products,
    productsVersion: PRODUCTS_VERSION,
    computedAt: Date.now(),
    final: day <= shiftDay(vnDate(new Date()), -3),
  }
  return { stats, ids }
}

/**
 * Reads today whole: at first, on a new day, and every ten minutes while
 * someone watches (half an hour otherwise). The ledger adds the orders placed
 * in between.
 */
function refreshToday(context: ConnectionContext, state: State, today: string): Promise<void> {
  // One read at a time per connection; requests inside the window share it.
  return memo(`sapo-live:${context.connectionId}`, LIVE_MS, async () => {
    const live = state.live
    const every = Date.now() - state.viewedAt < WATCHED_MS ? FULL_MS : IDLE_FULL_MS
    if (live && live.day === today && hasProducts(state.days[today]) && Date.now() - live.fullAt <= every) return
    const started = Date.now()
    const { stats, ids } = await computeDay(context, today)
    state.days[today] = stats
    state.live = { day: today, ids, at: Date.now(), fullAt: Date.now(), readFrom: started }
    // Orders the ledger added, while this ran, to the day it replaced may be
    // missing from it: the next ledger read goes back to when it started (and
    // a ledger read under way now does the same — see sweepLedger). Each order
    // and refund is still counted once (live.ids, ledger.recent).
    state.ledger.cursor = Math.min(state.ledger.cursor, started)
    await persist(context.connectionId, state)
  })
}

/** Counts the order's refunds the ledger has not counted yet. */
function countRefunds(ledger: Ledger, order: Order) {
  for (const refund of refundsOf(order)) {
    // Older than the remembered ids: an earlier read has counted it.
    if (refund.at < ledger.cursor - RECENT_MS || ledger.recent[refund.id] !== undefined) continue
    const day = vnDate(new Date(refund.at))
    if (day < ledger.since) continue
    ledger.recent[refund.id] = refund.at
    const cell = ((ledger.days[day] ??= {})[channelOf(order)] ??= emptyRefundHours())[vnHour(refund.at)]
    cell[0] += 1
    cell[1] += refund.amount
    cell[2] += refund.tax
  }
}

/**
 * Reads the orders modified since the ledger's mark: their refunds go into the
 * ledger, and those of today's orders not counted yet into today. Usually one
 * small page. A catch-up bigger than Sapo's result window is read in slices
 * of a week of orders placed; one placed more than SLICE_LOOKBACK_DAYS before
 * the mark is then missed — a return that late is rare and small.
 */
async function sweepLedger(context: ConnectionContext, state: State) {
  const started = Date.now()
  const modified = `modified_on_min=${encodeURIComponent(vnIso(state.ledger.cursor - OVERLAP_MS))}`
  const queries = [modified]
  if (started - state.ledger.cursor > 3600_000 && (await countOrders(context, modified)) > MAX_PAGES * PAGE_SIZE * 0.8) {
    queries.length = 0
    for (let from = state.ledger.cursor - SLICE_LOOKBACK_DAYS * DAY_MS; from < started + DAY_MS; from += SLICE_DAYS * DAY_MS) {
      queries.push(
        `${modified}&created_on_min=${encodeURIComponent(vnIso(from))}&created_on_max=${encodeURIComponent(vnIso(from + SLICE_DAYS * DAY_MS - 1000))}`,
      )
    }
  }

  for (const query of queries) {
    await eachPage(context, query, (orders) => {
      // Looked up each page: a full read of today may have replaced them meanwhile.
      const live = state.live
      const today = live ? state.days[live.day] : undefined
      for (const order of orders) {
        countRefunds(state.ledger, order)
        if (!live || !today || live.ids.has(order.id) || vnDate(new Date(placedAt(order))) !== live.day) continue
        live.ids.add(order.id)
        addOrder({ sources: today.sources, products: (today.products ??= {}), refunds: today.refunds }, order)
      }
    })
  }

  const ledger = state.ledger
  const live = state.live
  // A read of today that ended while this one ran replaced the day this one
  // was adding orders to: the next ledger read goes back to when it started.
  ledger.cursor = live && live.fullAt >= started ? Math.min(started, live.readFrom) : started
  for (const [id, at] of Object.entries(ledger.recent)) if (at < ledger.cursor - RECENT_MS) delete ledger.recent[id]
  if (live) {
    live.at = Date.now()
    const today = state.days[live.day]
    if (today) today.computedAt = live.at
  }
  // Written now and then, and after a long read — not on every small one.
  if (Date.now() - state.persistedAt > PERSIST_MS || Date.now() - started > 60_000) await persist(context.connectionId, state)
}

/** Starts a ledger read unless one is running or has just run; the one running, if any. */
function syncLedger(context: ConnectionContext, state: State): Promise<void> | null {
  if (state.sweep) return state.sweep
  if (Date.now() - state.sweptAt < LIVE_MS) return null
  state.sweep = sweepLedger(context, state)
    .then(() => {
      state.sweepError = null
    })
    .catch((error) => {
      state.sweepError = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      state.sweptAt = Date.now()
      state.sweep = null
    })
  return state.sweep
}

function refreshDay(context: ConnectionContext, state: State, day: string): Promise<DayStats> {
  // The short memo only merges concurrent refreshes of the same day.
  return memo(`sapo-day:${context.connectionId}:${day}`, 10_000, async () => {
    const { stats } = await computeDay(context, day)
    state.days[day] = stats
    // Written now and then while many days come in; the last worker writes the rest.
    if (Date.now() - state.persistedAt > BACKFILL_PERSIST_MS) await persist(context.connectionId, state)
    return stats
  })
}

/**
 * Fills in `days` behind the response, DAY_WORKERS at a time, most recent
 * first. The store's gate keeps them all within its call budget together.
 */
function enqueue(context: ConnectionContext, state: State, days: string[]) {
  for (const day of days) if (!state.reading.has(day)) state.queue.add(day)
  while (state.workers < Math.min(DAY_WORKERS, state.queue.size)) {
    state.workers += 1
    void (async () => {
      try {
        while (state.queue.size > 0) {
          // Most recent first: those are the days a reader looks at.
          const day = [...state.queue].sort().at(-1)!
          state.queue.delete(day)
          state.reading.add(day)
          try {
            await refreshDay(context, state, day)
            state.lastError = null
          } catch (error) {
            state.lastError = error instanceof Error ? error.message : String(error)
          } finally {
            state.reading.delete(day)
          }
        }
      } finally {
        state.workers -= 1
        if (state.workers === 0) await persist(context.connectionId, state).catch(() => {})
      }
    })()
  }
}

/** One day's orders placed, over the chosen channels (all of them when `channels` is null). */
function combine(stats: DayStats | undefined, channels: string[] | null): Tally | null {
  if (!stats) return null
  const out = emptyTally()
  for (const [channel, tally] of Object.entries(stats.sources)) {
    if (channels && !channels.includes(channel)) continue
    out.created += tally.created
    out.cancelled += tally.cancelled
    out.gmv += tally.gmv
    out.cancelledValue += tally.cancelledValue
    out.lines += tally.lines
    out.tax += tally.tax
    out.shipping += tally.shipping
    tally.hours.forEach((hour, h) => hour.forEach((value, i) => (out.hours[h][i] += value)))
  }
  return out
}

/** The refunds made on a ledger day in each hour, over the chosen channels; null for a day before the ledger. */
function refundHours(state: State, day: string, channels: string[] | null): RefundTally[] | null {
  if (day < state.ledger.since) return null
  const out = emptyRefundHours()
  for (const [channel, hours] of Object.entries(state.ledger.days[day] ?? {})) {
    if (channels && !channels.includes(channel)) continue
    hours.forEach((cell, h) => cell.forEach((value, i) => (out[h][i] += value)))
  }
  return out
}

/**
 * The refunds made on `day`, over the chosen channels: from the ledger, or
 * for a day before it, from the orders of the days kept (see RETURN_WINDOW_DAYS).
 */
function refundsOn(state: State, day: string, channels: string[] | null): RefundTally {
  const out: RefundTally = [0, 0, 0]
  const hours = refundHours(state, day, channels)
  if (hours) {
    for (const cell of hours) cell.forEach((value, i) => (out[i] += value))
    return out
  }
  for (const stats of Object.values(state.days)) {
    for (const [channel, cell] of Object.entries(stats.refunds?.[day] ?? {})) {
      if (channels && !channels.includes(channel)) continue
      cell.forEach((value, i) => (out[i] += value))
    }
  }
  return out
}

/** The days a day before the ledger counts its returns from; none for a ledger day. */
const returnDaysOf = (state: State, day: string) =>
  day < state.ledger.since ? daysBetween(shiftDay(day, -RETURN_WINDOW_DAYS), shiftDay(day, -1)) : []

type Placed = { orders: number; gmv: number; lines: number; tax: number; shipping: number }

/** The report's row: the orders placed, less the refunds made. */
function salesOf(placed: Placed, refunded: RefundTally): SapoSales {
  const [, refundedAmount, refundedTax] = refunded
  // Lines less discounts, which is what the orders are worth without VAT and shipping.
  const beforeReturns = Math.round(placed.gmv - placed.tax - placed.shipping)
  const lines = Math.round(placed.lines)
  const returns = Math.round(refundedAmount - refundedTax)
  const netRevenue = beforeReturns - returns
  const shipping = Math.round(placed.shipping)
  const tax = Math.round(placed.tax - refundedTax)
  return {
    orders: placed.orders,
    lines,
    discounts: lines - beforeReturns,
    returns,
    netRevenue,
    shipping,
    tax,
    revenue: netRevenue + shipping + tax,
  }
}

const placedOf = (t: Tally): Placed => ({ orders: t.created, gmv: t.gmv, lines: t.lines, tax: t.tax, shipping: t.shipping })
const placedInHour = (hour: HourTally): Placed => ({ orders: hour[0], gmv: hour[2], lines: hour[4], tax: hour[5], shipping: hour[6] })

type Sums = { created: number; cancelled: number; gmv: number; cancelledValue: number; placed: Placed; refunded: RefundTally }

function sumDays(state: State, days: string[], channels: string[] | null): Sums {
  const out: Sums = {
    created: 0,
    cancelled: 0,
    gmv: 0,
    cancelledValue: 0,
    placed: { orders: 0, gmv: 0, lines: 0, tax: 0, shipping: 0 },
    refunded: [0, 0, 0],
  }
  for (const day of days) {
    const tally = combine(state.days[day], channels)
    if (!tally) continue
    out.created += tally.created
    out.cancelled += tally.cancelled
    out.gmv += tally.gmv
    out.cancelledValue += tally.cancelledValue
    out.placed.orders += tally.created
    out.placed.gmv += tally.gmv
    out.placed.lines += tally.lines
    out.placed.tax += tally.tax
    out.placed.shipping += tally.shipping
    refundsOn(state, day, channels).forEach((value, i) => (out.refunded[i] += value))
  }
  return out
}

const totalsOf = (s: Sums): SapoTotals => ({
  created: s.created,
  cancelled: s.cancelled,
  gmv: s.gmv,
  net: s.gmv - s.cancelledValue,
  sales: salesOf(s.placed, s.refunded),
})

const sumsOfDay = (tally: Tally, refunded: RefundTally): Sums => ({
  created: tally.created,
  cancelled: tally.cancelled,
  gmv: tally.gmv,
  cancelledValue: tally.cancelledValue,
  placed: placedOf(tally),
  refunded,
})

/**
 * Yesterday at the same time, for the today view: its whole hours so far,
 * plus the elapsed share of this hour — orders placed and refunds made alike.
 */
function sameTimeYesterday(before: Tally, refunds: RefundTally[] | null, lastHour: number, minuteShare: number): Sums {
  const weight = (hour: number) => (hour < lastHour ? 1 : hour === lastHour ? minuteShare : 0)
  const hours: HourTally = [0, 0, 0, 0, 0, 0, 0]
  before.hours.forEach((hour, h) => hour.forEach((value, i) => (hours[i] += value * weight(h))))
  const refunded: RefundTally = [0, 0, 0]
  refunds?.forEach((cell, h) => cell.forEach((value, i) => (refunded[i] += value * weight(h))))
  return {
    created: hours[0],
    cancelled: hours[1],
    gmv: hours[2],
    cancelledValue: hours[3],
    placed: placedInHour(hours),
    refunded,
  }
}

/**
 * One background round for a store, run whether or not anyone has the
 * dashboard open (see background.ts): today read and kept current through the
 * ledger, and the recent days (WARM_DAYS) filled in and refreshed as they age —
 * so a dashboard opens on figures that are already there. Cheap when nothing
 * is due: a ledger read of what changed, and no day read again before its time.
 */
export async function syncSapoInBackground(context: ConnectionContext): Promise<void> {
  const state = await stateFor(context.connectionId)
  const today = vnDate(new Date())

  try {
    await refreshToday(context, state, today)
    state.todayError = null
  } catch (error) {
    state.todayError = error instanceof Error ? error.message : String(error)
  }
  // Waited for, however long a catch-up takes: the next round starts after it.
  await syncLedger(context, state)

  const recent = daysBetween(shiftDay(today, -(WARM_DAYS - 1)), shiftDay(today, -1))
  const due = new Set(recent.filter((day) => !isFresh(day, state.days[day], today) || !hasProducts(state.days[day])))
  for (const day of recent) for (const earlier of returnDaysOf(state, day)) if (!isFresh(earlier, state.days[earlier], today)) due.add(earlier)
  if (due.size > 0) enqueue(context, state, [...due])
}

/** The channels seen in the last 30 synced days, busiest first. */
export async function listSapoChannels(context: ConnectionContext): Promise<Array<{ name: string; orders: number }>> {
  const state = await stateFor(context.connectionId)
  const since = shiftDay(vnDate(new Date()), -29)
  const counts = new Map<string, number>()
  for (const [day, stats] of Object.entries(state.days)) {
    if (day < since) continue
    for (const [channel, tally] of Object.entries(stats.sources)) {
      counts.set(channel, (counts.get(channel) ?? 0) + tally.created)
    }
  }
  // A chosen channel stays listed even in a quiet month, so it can be unticked.
  for (const channel of selectionOf(context.metadata).sapoChannels ?? []) if (!counts.has(channel)) counts.set(channel, 0)
  return [...counts.entries()].map(([name, orders]) => ({ name, orders })).sort((a, b) => b.orders - a.orders)
}

export async function sapoOverview(context: ConnectionContext, period: Period): Promise<SapoOverview> {
  const range = period.range
  const today = vnDate(new Date())
  const state = await stateFor(context.connectionId)
  state.viewedAt = Date.now()
  const channels = selectionOf(context.metadata).sapoChannels
  const failures: Failure[] = []

  const currentDays = range === 'today' ? [period.start] : period.buckets
  const previousDays = daysBetween(period.previousStart, period.previousEnd)
  const wanted = [...currentDays, ...previousDays]

  // Today's orders are read whole only when the view reaches today. The first
  // read is waited for; the re-read every ten minutes (for cancellations) goes
  // on behind the response, which answers with today as the ledger keeps it.
  if (period.end === today) {
    const read = refreshToday(context, state, today).then(
      () => {
        state.todayError = null
      },
      (error) => {
        state.todayError = error instanceof Error ? error.message : String(error)
      },
    )
    if (state.live?.day !== today || !state.days[today]) await read
    if (state.todayError) failures.push({ source: 'Sapo', message: state.todayError })
  }
  // The refunds — and today's newest orders — through the ledger. A long
  // catch-up (the first run, or after a quiet spell) goes on behind the
  // response; the usual few seconds' worth is waited for.
  const sweep = syncLedger(context, state)
  if (sweep && Date.now() - state.ledger.cursor < CATCH_UP_MS) await sweep
  if (state.sweepError) failures.push({ source: 'Sapo', message: state.sweepError })

  // The earlier days whose orders the view's days before the ledger count their returns from.
  const listed = new Set(wanted)
  const returnDays = (days: string[]) => {
    const out = new Set<string>()
    for (const day of days) for (const d of returnDaysOf(state, day)) if (!listed.has(d)) out.add(d)
    for (const d of out) listed.add(d)
    return [...out]
  }
  const currentReturnDays = returnDays(currentDays)
  const previousReturnDays = returnDays(previousDays)

  // The product lists need the view's own days read with their current product figures; a day kept from before is read once more.
  const stale = [...wanted, ...currentReturnDays, ...previousReturnDays].filter(
    (day) => day !== today && (!isFresh(day, state.days[day], today) || (currentDays.includes(day) && !hasProducts(state.days[day]))),
  )
  const adminUrl = productAdminUrl(context)
  if (stale.length > 0) enqueue(context, state, stale)
  if (state.lastError) failures.push({ source: 'Sapo', message: state.lastError })
  const missing = (days: string[]) => days.filter((day) => !state.days[day]).length
  const pendingDays = missing(wanted)
  const sync = {
    current: missing(currentDays),
    previous: missing(previousDays) + missing(previousReturnDays),
    total: wanted.length + currentReturnDays.length + previousReturnDays.length,
    returns: missing(currentReturnDays),
    catchingUp: Date.now() - state.ledger.cursor > BEHIND_MS,
  }
  const scope = { channels }
  const fetchedAt = state.live?.day === today ? new Date(state.live.at).toISOString() : null

  if (range === 'today') {
    const now = combine(state.days[today], channels)
    const nowRefunds = refundHours(state, today, channels)
    const before = combine(state.days[period.previousStart], channels)
    const beforeRefunds = refundHours(state, period.previousStart, channels)
    const lastHour = period.buckets.length - 1
    const minuteShare = new Date(Date.now() + VN_OFFSET_MS).getUTCMinutes() / 60
    const previous = before ? totalsOf(sameTimeYesterday(before, beforeRefunds, lastHour, minuteShare)) : null
    const noRefund: RefundTally = [0, 0, 0]
    // Yesterday's running totals at each hour, for the comparison line; its last point is `previous` itself.
    const yesterdayRunning = [0, 0, 0, 0]
    const previousByTime = before
      ? period.buckets.map((_at, hour) => {
          if (hour === lastHour) {
            return { created: previous!.created, cancelled: previous!.cancelled, gmv: previous!.gmv, revenue: previous!.sales.revenue }
          }
          yesterdayRunning[0] += before.hours[hour][0]
          yesterdayRunning[1] += before.hours[hour][1]
          yesterdayRunning[2] += before.hours[hour][2]
          yesterdayRunning[3] += before.hours[hour][2] - (beforeRefunds?.[hour][1] ?? 0)
          return { created: yesterdayRunning[0], cancelled: yesterdayRunning[1], gmv: yesterdayRunning[2], revenue: Math.round(yesterdayRunning[3]) }
        })
      : []
    // Today is cumulative: each hour shows the running total, ending at the live figure now.
    const running = [0, 0, 0, 0]
    return {
      currency: 'VND',
      totals: now
        ? totalsOf(sumsOfDay(now, refundsOn(state, today, channels)))
        : totalsOf(sumDays(state, [], channels)),
      previous,
      byTime: period.buckets.map((at, hour) => {
        if (!now) return { at, created: null, cancelled: null, gmv: null, revenue: null, sales: null }
        const refunded = nowRefunds?.[hour] ?? noRefund
        running[0] += now.hours[hour][0]
        running[1] += now.hours[hour][1]
        running[2] += now.hours[hour][2]
        running[3] += now.hours[hour][2] - refunded[1]
        return {
          at,
          created: running[0],
          cancelled: running[1],
          gmv: running[2],
          revenue: Math.round(running[3]),
          sales: salesOf(placedInHour(now.hours[hour]), refunded),
        }
      }),
      previousByTime,
      pendingDays,
      sync,
      scope,
      fetchedAt,
      hours: hoursOf(state, range, today, channels, currentDays, previousDays),
      products: productsOf(state, channels, currentDays, adminUrl, period.end < today ? period.end : null),
      failures,
    }
  }

  const previousComplete = previousDays.every((day) => state.days[day])
  const dayRow = (day: string) => {
    const tally = combine(state.days[day], channels)
    return tally ? totalsOf(sumsOfDay(tally, refundsOn(state, day, channels))) : null
  }

  return {
    currency: 'VND',
    totals: totalsOf(sumDays(state, currentDays, channels)),
    previous: previousComplete ? totalsOf(sumDays(state, previousDays, channels)) : null,
    byTime: currentDays.map((at) => {
      const row = dayRow(at)
      return row
        ? { at, created: row.created, cancelled: row.cancelled, gmv: row.gmv, revenue: row.sales.revenue, sales: row.sales }
        : { at, created: null, cancelled: null, gmv: null, revenue: null, sales: null }
    }),
    // Day i of the previous period sits under day i of this one; unsynced days are gaps.
    previousByTime: previousDays.map((day) => {
      const row = dayRow(day)
      return row
        ? { created: row.created, cancelled: row.cancelled, gmv: row.gmv, revenue: row.sales.revenue }
        : { created: null, cancelled: null, gmv: null, revenue: null }
    }),
    pendingDays,
    sync,
    scope,
    fetchedAt,
    hours: hoursOf(state, range, today, channels, currentDays, previousDays),
    products: productsOf(state, channels, currentDays, adminUrl, period.end < today ? period.end : null),
    failures,
  }
}

/** How long the product catalog is kept between reads. */
const CATALOG_TTL = 30 * 60_000

/**
 * The products the store has for sale (status "active"), by id. Light: this
 * store's 113 products are one page of 130 KB. Kept for half an hour.
 */
function fetchCatalog(context: ConnectionContext): Promise<Array<{ key: string; name: string }>> {
  return memo(`sapo-catalog:${context.connectionId}`, CATALOG_TTL, async () => {
    const out: Array<{ key: string; name: string }> = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = (await sapoGet(context, `/admin/products.json?limit=${PAGE_SIZE}&page=${page}`)) as {
        products?: Array<Record<string, unknown>>
      } | null
      const list = Array.isArray(data?.products) ? data.products : []
      for (const product of list) {
        if (product.status !== undefined && product.status !== 'active') continue
        out.push({ key: String(product.id), name: String(product.name ?? product.title ?? product.id) })
      }
      if (list.length < PAGE_SIZE) break
    }
    return out
  })
}

/**
 * Every product for sale, each with its latest order on the chosen channels
 * among all the days kept with products — for the "all products" view of the
 * quiet list, read only when someone asks for it.
 */
export async function sapoCatalog(context: ConnectionContext): Promise<SapoCatalog> {
  const [state, catalog] = await Promise.all([stateFor(context.connectionId), fetchCatalog(context)])
  const channels = selectionOf(context.metadata).sapoChannels
  const last = new Map<string, number>()
  let earliest: string | null = null
  for (const [day, stats] of Object.entries(state.days)) {
    if (!stats.products) continue
    if (earliest === null || day < earliest) earliest = day
    for (const [channel, list] of Object.entries(stats.products)) {
      if (channels && !channels.includes(channel)) continue
      for (const [key, product] of Object.entries(list)) {
        if (product.last > (last.get(key) ?? 0)) last.set(key, product.last)
      }
    }
  }
  return {
    items: catalog.map((product) => ({ ...product, last: last.get(product.key) ?? null })),
    knownSince: earliest ? Date.parse(`${earliest}T00:00:00+07:00`) : null,
    fetchedAt: new Date().toISOString(),
  }
}

/** The store's product page prefix in Sapo admin; empty when the store address is unknown. */
function productAdminUrl(context: ConnectionContext): string {
  try {
    return `${requirePlugin('sapo').resolveBaseUrl(context)}/admin/products/`
  } catch {
    return ''
  }
}

/**
 * The products sold over the view's days, on the chosen channels: their
 * orders, units, value, the cancelled share of both, and when each was last
 * ordered — what the best-sellers card and the "no new orders for a while"
 * list work from. Windows and rankings are picked on the page, so changing
 * them needs no new read.
 */
function productsOf(
  state: State,
  channels: string[] | null,
  currentDays: string[],
  adminUrl: string,
  /** The view's last day when it stops before today. */
  endedOn: string | null,
): SapoProducts {
  const merged = new Map<string, Required<ProductDay>>()
  for (const day of currentDays) {
    const perChannel = state.days[day]?.products
    if (!perChannel) continue
    for (const [channel, list] of Object.entries(perChannel)) {
      if (channels && !channels.includes(channel)) continue
      for (const [key, product] of Object.entries(list)) {
        const seen = merged.get(key)
        if (!seen) {
          merged.set(key, { cancelled: 0, gmv: 0, cancelledGmv: 0, ...product } as Required<ProductDay>)
          continue
        }
        seen.orders += product.orders
        seen.quantity += product.quantity
        seen.cancelled += product.cancelled ?? 0
        seen.gmv += product.gmv ?? 0
        seen.cancelledGmv += product.cancelledGmv ?? 0
        // The latest order also carries the product's current title.
        if (product.last > seen.last) {
          seen.last = product.last
          seen.name = product.name
        }
      }
    }
  }
  return {
    items: [...merged.entries()]
      .map(([key, p]) => ({
        key,
        name: p.name,
        orders: p.orders,
        quantity: p.quantity,
        cancelled: p.cancelled,
        gmv: p.gmv,
        cancelledGmv: p.cancelledGmv,
        last: p.last,
      }))
      .sort((a, b) => b.orders - a.orders),
    since: Date.parse(`${currentDays[0]}T00:00:00+07:00`),
    pendingDays: currentDays.filter((day) => !hasProducts(state.days[day])).length,
    adminUrl,
    until: endedOn ? Date.parse(`${endedOn}T23:59:59.999+07:00`) : null,
  }
}

/**
 * When in the day orders come in, over exactly the view's days and the chosen
 * channels — the same days every other figure on the page counts.
 *
 * The today view counts today's orders in each hour, the one in progress
 * included; hours still ahead are null. The longer views give the average per
 * day for each hour, and today joins only for the hours it has finished, so a
 * half-over day never drags the evening down. The previous period of the same
 * length is figured the same way, and the weekday rows average the view's
 * days one weekday at a time.
 */
function hoursOf(
  state: State,
  range: DashboardRange,
  today: string,
  channels: string[] | null,
  currentDays: string[],
  previousDays: string[],
): SapoHours {
  const single = range === 'today'
  const hourNow = new Date(Date.now() + VN_OFFSET_MS).getUTCHours()
  // Which of today's hours count: every one so far for the today view, only the finished ones for an average.
  const countsHour = (day: string, hour: number) => day !== today || (single ? hour <= hourNow : hour < hourNow)
  const synced = (days: string[]) =>
    days.flatMap((day) => {
      const tally = combine(state.days[day], channels)
      return tally ? [{ day, tally }] : []
    })
  const perHour = (list: Array<{ day: string; tally: Tally }>) => {
    const totals = Array.from({ length: 24 }, () => 0)
    const days = Array.from({ length: 24 }, () => 0)
    for (const { day, tally } of list) {
      for (let hour = 0; hour < 24; hour++) {
        if (!countsHour(day, hour)) continue
        totals[hour] += tally.hours[hour][0]
        days[hour] += 1
      }
    }
    const values = totals.map((sum, hour) => (days[hour] === 0 ? null : single ? sum : sum / days[hour]))
    return { totals, days, values }
  }

  const own = synced(currentDays)
  const mine = perHour(own)
  const before = synced(previousDays)
  const week = single
    ? []
    : [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
        const row = perHour(own.filter(({ day }) => new Date(`${day}T00:00:00Z`).getUTCDay() === weekday))
        return { weekday, hours: row.values, counts: row.days }
      })

  return {
    profile: mine.values,
    totals: mine.totals,
    counts: mine.days,
    previous: before.length > 0 ? perHour(before).values.map((v) => v ?? 0) : null,
    week,
    currentHour: currentDays.includes(today) ? hourNow : null,
    days: own.length,
  }
}
