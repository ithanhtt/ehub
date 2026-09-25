import 'server-only'

import { mkdir } from 'node:fs/promises'
import { writeFileAtomic, readJsonFile } from '@/core/utils/atomic-write'
import path from 'node:path'
import { sendRequest } from '@/core/plugins/http'
import { requirePlugin } from '@/core/plugins/registry'
import type { ConnectionContext } from '@/core/plugins/types'
import { memo } from './cache'
import { OTHER_CHANNEL } from './channels'
import { daysBetween, shiftDay, vnDate, type Period } from './period'
import {
  changesKeptDay,
  channelOf as channelOfOrder,
  currentFailure,
  emptyTally,
  factsOf,
  foldDay,
  keepNewer,
  markRecheck,
  mayRetry,
  newestModified,
  newRechecks,
  nextCursor,
  placedAt,
  readWhole,
  recordFailure,
  refundsOf,
  settleRecheck,
  signaturesOf,
  takeRecheck,
  vnDay,
  vnHour,
  type DayFailure,
  type HourTally,
  type Order,
  type OrderFacts,
  type ProductDay,
  type Rechecks,
  type RefundTally,
  type Tally,
} from './sapo-orders'
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
 * refresh is out of the question. Today is read whole once, and kept order by
 * order after that: what each of its orders adds (its facts, sapo-orders.ts)
 * is held in memory, and an order the ledger sees modified — new, cancelled,
 * its total or lines edited — replaces its own facts, once, so today stays
 * what a full read would give. A full read every half hour (an hour when no
 * one watches) remains, as a safety net. Earlier days are summed once and
 * kept in .data/cache; yesterday is re-read every half hour, two days ago
 * every six hours, anything older only when the ledger sees one of its orders
 * change what it counts (cancellations land within 1.4 days, and later
 * returns are the ledger's). Missing days are filled in behind the response,
 * most recent first; a day that fails waits ten minutes or so before the next
 * try.
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
 * value; 3 their SKUs and their orders and cancellations by hour (for the
 * order and cancellation report); 4 the value of each product's hours (the
 * overview's products by hour, in sales). A day kept with older ones keeps its
 * totals; its products are read again when a view needs them — from version 3,
 * which has everything but the hours' value, meanwhile still served
 * (PRODUCTS_SERVED), and read again behind.
 */
const PRODUCTS_VERSION = 4
/** The oldest product figures still served while a newer read is on its way. */
const PRODUCTS_SERVED = 3

/** How often the ledger reads what changed. The page polls every 15 s. */
const LIVE_MS = 10_000
/**
 * How often today is read whole. The ledger keeps it current order by order in
 * between (cancellations and edits included); this read is the safety net
 * that would put right anything it missed.
 */
const FULL_MS = 30 * 60_000
/** …and when nobody has the dashboard open: the background keeps it close, without reading 2 MB pages for no one. */
const IDLE_FULL_MS = 60 * 60_000
/** After a failed read of today, the next waits this long — the page asks every few seconds while it syncs. */
const TODAY_RETRY_MS = 60_000
/**
 * How long a dashboard request waits on Sapo: for the first read of today, and
 * the ledger's few seconds. Past it the response goes out with what is there,
 * the missing figures marked as still syncing (the page asks again every few
 * seconds until they land), rather than hanging on a 14 MB read.
 */
const RESPONSE_BUDGET_MS = 10_000
/**
 * The earlier days whose orders' fingerprints are kept in memory once read,
 * so a later change to one of their orders can be told from a delivery update
 * (see changesKeptDay). About 1,700 small numbers a day.
 */
const SIGN_DAYS = 14
/** A store's figures no one has asked for in this long are dropped from memory (the file keeps them). */
const IDLE_STATE_MS = 3600_000
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

// Tally, HourTally, RefundTally and ProductDay — what a day keeps — are defined with the arithmetic, in sapo-orders.ts.

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
  /**
   * Orders modified up to here have been read, epoch ms — by Sapo's clock: the
   * latest `modified_on` seen (see nextCursor), so a server clock off from
   * Sapo's cannot make a read start after changes it missed. Files from before
   * held this server's clock at the read's start; either way the next read
   * starts OVERLAP_MS before it.
   */
  cursor: number
  /**
   * When the last read of what changed began that came back whole, epoch ms,
   * this server's clock: how current the ledger is. The cursor cannot say — it
   * stands still while nothing changes, all night. Missing in files from
   * before it was kept; the cursor stands in (it was the same clock then).
   */
  readAt?: number
  /** Per day made, per channel, per hour (Vietnam time). */
  days: Record<string, Record<string, RefundTally[]>>
  /** The refunds counted in the last RECENT_MS, id → time made. */
  recent: Record<string, number>
}

/**
 * In memory only: what each of the live day's orders adds to it, by id — so the
 * ledger replaces an order's part (new, cancelled, edited) exactly once and the
 * day, folded again, is what a full read would give.
 */
type Live = {
  day: string
  orders: Map<string, OrderFacts>
  at: number
  /** When today was last read whole, and when that read started. */
  fullAt: number
  readFrom: number
  /** The ledger's cursor when that read started: the next ledger read goes back to it (see refreshToday). */
  fromCursor: number
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
  /** Days whose last read failed, each with its error: a failed day waits before it is tried again (see mayRetry). */
  failed: Map<string, DayFailure>
  /** Why the last read of today failed, when it did, and when. */
  todayError: string | null
  todayFailedAt: number
  /** When the read of today under way began; 0 when none is. */
  todayReadSince: number
  /** Earlier days a change to one of their orders was seen on, to be read again (see takeRecheck). */
  rechecks: Rechecks
  /** The fingerprints of the orders of the earlier days read in this run (the last SIGN_DAYS), by day. */
  signatures: Map<string, Map<string, number>>
  /** Whether Sapo's order count can be checked a day's read against (see readDay); off once it proved not comparable. */
  countTrusted: boolean
  /**
   * The refunds on the kept days' orders, by the day made, for the days before
   * the ledger — gathered once instead of scanning every kept day for every
   * day asked. Dropped whenever a day before the ledger changes.
   */
  refundIndex: Map<string, Array<[string, RefundTally]>> | null
  /** When anything last asked for this store's figures. */
  seenAt: number
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

// A new key, so a hot reload does not hand this code an older in-memory shape (and the older one is let go).
delete (globalThis as unknown as { __adshubSapoDaysV8?: unknown }).__adshubSapoDaysV8
const states = ((globalThis as unknown as { __adshubSapoDaysV9?: Map<string, State> }).__adshubSapoDaysV9 ??= new Map())

/** The call budget of one store, shared by every read of it (see BUCKET_CALLS). */
type Gate = { level: number; at: number; inFlight: number }
const gates = ((globalThis as unknown as { __adshubSapoGates?: Map<string, Gate> }).__adshubSapoGates ??= new Map())

const CACHE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'cache')
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const VN_OFFSET_MS = 7 * 3600_000
const DAY_MS = 86_400_000

const emptyRefundHours = (): RefundTally[] => Array.from({ length: 24 }, (): RefundTally => [0, 0, 0])

/** A ledger starting on the day before today. */
const newLedger = (): Ledger => {
  const since = shiftDay(vnDate(new Date()), -1)
  const start = Date.parse(`${since}T00:00:00+07:00`)
  return { since, cursor: start, readAt: start, days: {}, recent: {} }
}

/** How current the ledger is, by this server's clock (see Ledger.readAt). */
const ledgerReadAt = (ledger: Ledger) => ledger.readAt ?? ledger.cursor

/**
 * Puts a day's figures in place. Every change to `days` goes through here, so
 * the refunds gathered for the days before the ledger are gathered again when
 * one of the days they come from changes.
 */
function setDay(state: State, day: string, stats: DayStats) {
  state.days[day] = stats
  // Any day, not only those before the ledger: gathering again is a few thousand cells, and never wrong.
  state.refundIndex = null
}

/** A day's figures from its orders' facts, as kept. */
const statsOf = (orders: Map<string, OrderFacts>, day: string, computedAt: number): DayStats => ({
  ...foldDay(orders.values()),
  productsVersion: PRODUCTS_VERSION,
  computedAt,
  final: day <= shiftDay(vnDate(new Date()), -3),
})

/** Keeps the fingerprints of an earlier day's orders while the day is recent enough to be worth it (SIGN_DAYS). */
function keepSignatures(state: State, day: string, orders: Map<string, OrderFacts>) {
  const oldest = shiftDay(vnDate(new Date()), -SIGN_DAYS)
  if (day >= oldest) state.signatures.set(day, signaturesOf(orders.values()))
  for (const kept of state.signatures.keys()) if (kept < oldest) state.signatures.delete(kept)
}

/**
 * Lets go of the stores nothing has asked about for IDLE_STATE_MS — a
 * connection removed, or a project no longer opened — once nothing of theirs
 * is running, their last changes written first. Their file stays: coming back
 * reads it again.
 */
let forgotAt = 0
function forgetIdle(keep: string) {
  const now = Date.now()
  if (now - forgotAt < 5 * 60_000) return
  forgotAt = now
  for (const [connectionId, state] of states) {
    if (connectionId === keep || now - state.seenAt < IDLE_STATE_MS) continue
    if (state.sweep || state.workers > 0 || state.reading.size > 0 || state.writing || state.todayReadSince) continue
    states.delete(connectionId)
    const gate = gates.get(connectionId)
    if (gate && gate.inFlight === 0) gates.delete(connectionId)
    if (state.dirty || state.persistedAt < state.seenAt) void persist(connectionId, state).catch(() => {})
  }
}

/** The day's products are kept, with the figures served (a version-3 day lacks only its hours' value). */
const hasProducts = (stats: DayStats | undefined) => !!stats?.products && (stats.productsVersion ?? 0) >= PRODUCTS_SERVED
/** …and with every figure the current version has: its products' hours in value too. */
const hasHourValues = (stats: DayStats | undefined) => !!stats?.products && stats.productsVersion === PRODUCTS_VERSION

/** An instant as Sapo's bounds accept it: local Vietnam time with its offset. */
const vnIso = (ms: number) => `${new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 19)}+07:00`

function fileFor(connectionId: string): string {
  // Our own generated ids; checked anyway, since they become a file name.
  if (!SAFE_ID.test(connectionId)) throw new Error('Unexpected connection id')
  return path.join(CACHE_DIR, `sapo-days-${connectionId}.json`)
}

async function stateFor(connectionId: string): Promise<State> {
  forgetIdle(connectionId)
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
      failed: new Map(),
      todayError: null,
      todayFailedAt: 0,
      todayReadSince: 0,
      rechecks: newRechecks(),
      signatures: new Map(),
      countTrusted: true,
      refundIndex: null,
      seenAt: Date.now(),
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
  state.seenAt = Date.now()
  const current = state
  current.loaded ??= readJsonFile<{ version?: number; days?: Record<string, DayStats>; ledger?: Ledger }>(fileFor(connectionId))
    .then((parsed) => {
      if (!parsed) return
      // The days and the ledger are one: a day's refunds before the ledger are
      // whole only when the ledger has run since the day was read, so a day
      // never outlives its ledger.
      if (parsed.version === CACHE_VERSION && parsed.days && typeof parsed.days === 'object' && parsed.ledger?.since) {
        current.days = { ...parsed.days, ...current.days }
        // A file from before `readAt` was kept: its cursor was this server's clock, which is what readAt is.
        current.ledger = { ...parsed.ledger, readAt: parsed.ledger.readAt ?? parsed.ledger.cursor }
        current.refundIndex = null
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
  for (const day of Object.keys(state.days)) {
    if (day >= oldest) continue
    delete state.days[day]
    state.refundIndex = null
  }
  for (const day of Object.keys(state.ledger.days)) if (day < oldest) delete state.ledger.days[day]
  for (const day of state.failed.keys()) if (day < oldest) state.failed.delete(day)
  for (const day of state.rechecks.marks.keys()) if (day < oldest) state.rechecks.marks.delete(day)

  await mkdir(CACHE_DIR, { recursive: true })
  const file = fileFor(connectionId)
  state.persistedAt = Date.now()
  await writeFileAtomic(file, JSON.stringify({ version: CACHE_VERSION, days: state.days, ledger: state.ledger }))
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

/** Attempts at one call; each goes back through the gate, so a retry is counted in the bucket like any call. */
const SAPO_ATTEMPTS = 3
const SAPO_RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504])

/**
 * One GET to the store's admin API, within its budget. Retried here rather
 * than inside sendRequest: a retry there would slip past the bucket, and
 * after a 429 the bucket is taken as full — Sapo said so — whatever the count
 * here thought.
 */
async function sapoGet(context: ConnectionContext, pathAndQuery: string): Promise<unknown> {
  const { base, headers } = sapoRequest(context)
  for (let attempt = 1; ; attempt++) {
    const gate = await enter(context.connectionId)
    let response
    try {
      response = await sendRequest({ url: `${base}${pathAndQuery}`, method: 'GET', headers }, { maxRetries: 0, timeoutMs: 45_000 })
    } finally {
      gate.inFlight -= 1
    }
    if (response.ok) return response.data
    if (response.status === 429) gate.level = BUCKET_CALLS
    if (attempt >= SAPO_ATTEMPTS || !SAPO_RETRYABLE.has(response.status)) {
      throw new Error(`Sapo ${response.status || ''} ${response.error ?? 'request failed'}`.trim())
    }
    await pause(Math.min(8_000, 1_000 * 2 ** (attempt - 1) + Math.random() * 300))
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

const channelOf = (order: Order) => channelOfOrder(order, OTHER_CHANNEL)

/**
 * A day's orders, each as what it adds to the day (its facts), by id. Pages are
 * asked for by number, and an order that moves up a page between two of them
 * would be skipped; so the read is checked against Sapo's count of the day's
 * orders, taken just before it (orders placed meanwhile can only add), and
 * read once more when it comes back short (see readWhole). One small call a
 * day. Should the count turn out not to count what the list returns, it is no
 * longer asked for.
 */
async function readDay(context: ConnectionContext, state: State, day: string): Promise<Map<string, OrderFacts>> {
  const bounds = dayBounds(day)
  const expected = state.countTrusted ? await countOrders(context, bounds).catch(() => null) : null
  const read = async () => {
    const orders = new Map<string, OrderFacts>()
    await eachPage(context, bounds, (page) => {
      // New orders arriving mid-read can shift a page: an order is counted once, at its latest version.
      for (const order of page) keepNewer(orders, factsOf(order, OTHER_CHANNEL))
    })
    return orders
  }
  const result = await readWhole(read, expected, 2 * PAGE_SIZE)
  if (!result.comparable) {
    state.countTrusted = false
    console.warn(`[sapo] ${day}: Sapo counts ${expected} orders, the read found ${result.orders.size}; reads are no longer checked against the count`)
  } else if (result.short) {
    console.warn(`[sapo] ${day}: Sapo counts ${expected} orders, two reads found ${result.orders.size}`)
  }
  return result.orders
}

/**
 * Reads today whole: at first, on a new day, and every half hour while someone
 * watches (an hour otherwise). The ledger keeps it current in between, order
 * by order (see sweepLedger).
 */
function refreshToday(context: ConnectionContext, state: State, today: string): Promise<void> {
  // One read at a time per connection; requests inside the window share it.
  return memo(`sapo-live:${context.connectionId}`, LIVE_MS, async () => {
    const live = state.live
    const every = Date.now() - state.viewedAt < WATCHED_MS ? FULL_MS : IDLE_FULL_MS
    if (live && live.day === today && hasProducts(state.days[today]) && Date.now() - live.fullAt <= every) return
    // A read that has just failed is not started again for every ask of a page waiting on it.
    if (Date.now() - state.todayFailedAt < TODAY_RETRY_MS) throw new Error(state.todayError ?? 'Sapo: reading today failed')
    const started = Date.now()
    const fromCursor = state.ledger.cursor
    state.todayReadSince = started
    let orders: Map<string, OrderFacts>
    try {
      orders = await readDay(context, state, today)
    } catch (error) {
      state.todayFailedAt = Date.now()
      throw error
    } finally {
      state.todayReadSince = 0
    }
    state.todayFailedAt = 0

    const previous = state.live
    // An order the ledger saw change after this read took it keeps the ledger's (later) version.
    // One placed today that the read's pages had already passed (the ledger added it meanwhile) stays too:
    // dropping it until the next ledger read would make today's count dip and come back.
    if (previous?.day === today) {
      for (const [id, facts] of previous.orders) {
        if (orders.has(id)) keepNewer(orders, facts)
        else if (Number.isFinite(facts.at) && vnDay(facts.at) === today) orders.set(id, facts)
      }
    }
    // The day just ended is an earlier day now: its orders' fingerprints tell a later change to one of them.
    if (previous && previous.day !== today) keepSignatures(state, previous.day, previous.orders)
    const now = Date.now()
    state.live = { day: today, orders, at: now, fullAt: now, readFrom: started, fromCursor }
    setDay(state, today, statsOf(orders, today, now))
    // Orders placed while this ran may be missing from it (and the ledger's
    // additions meanwhile went to the day it replaced): the next ledger read
    // goes back to where the ledger stood when it started — and a ledger read
    // under way now does the same (see sweepLedger). Each order and refund is
    // still counted once (live.orders by id, ledger.recent).
    state.ledger.cursor = Math.min(state.ledger.cursor, fromCursor)
    await persist(context.connectionId, state)
  })
}

/** Counts the order's refunds the ledger has not counted yet. */
function countRefunds(ledger: Ledger, order: Order) {
  for (const refund of refundsOf(order)) {
    // Older than the remembered ids: an earlier read has counted it.
    if (refund.at < ledger.cursor - RECENT_MS || ledger.recent[refund.id] !== undefined) continue
    const day = vnDay(refund.at)
    if (day < ledger.since) continue
    ledger.recent[refund.id] = refund.at
    const cell = ((ledger.days[day] ??= {})[channelOf(order)] ??= emptyRefundHours())[vnHour(refund.at)]
    cell[0] += 1
    cell[1] += refund.amount
    cell[2] += refund.tax
  }
}

/**
 * Reads the orders modified since the ledger's mark. Each does up to three
 * things:
 *
 * - its refunds not counted yet go into the ledger, under the day made;
 * - if it was placed on the live day (today), its facts replace the ones
 *   counted — a new order is added, a cancelled or edited one counted anew,
 *   exactly once — and the day is summed again from them: the same figures a
 *   full read would give, within seconds instead of at the next one;
 * - if it was placed on an earlier day kept on file and changes what that day
 *   counts (see changesKeptDay), the day is marked to be read again — once
 *   for any number of changes, and not too often (see takeRecheck). Read, not
 *   patched: those days keep their sums, not their orders. The refunds stay
 *   apart either way — a day's own figures are its orders placed; its refunds
 *   are the ledger's, so reading a day again never counts one twice.
 *
 * Usually one small page. A catch-up bigger than Sapo's result window is read
 * in slices of a week of orders placed; one placed more than
 * SLICE_LOOKBACK_DAYS before the mark is then missed — a return that late is
 * rare and small. The mark then moves to the latest `modified_on` seen: Sapo's
 * clock, never this server's (see nextCursor).
 */
async function sweepLedger(context: ConnectionContext, state: State) {
  const started = Date.now()
  const from = state.ledger.cursor
  const modified = `modified_on_min=${encodeURIComponent(vnIso(from - OVERLAP_MS))}`
  const queries = [modified]
  if (started - ledgerReadAt(state.ledger) > 3600_000 && (await countOrders(context, modified)) > MAX_PAGES * PAGE_SIZE * 0.8) {
    queries.length = 0
    for (let at = from - SLICE_LOOKBACK_DAYS * DAY_MS; at < Math.max(started, from) + DAY_MS; at += SLICE_DAYS * DAY_MS) {
      queries.push(
        `${modified}&created_on_min=${encodeURIComponent(vnIso(at))}&created_on_max=${encodeURIComponent(vnIso(at + SLICE_DAYS * DAY_MS - 1000))}`,
      )
    }
  }

  const seen = { newest: NaN, untimed: false }
  const today = vnDate(new Date())
  for (const query of queries) {
    await eachPage(context, query, (orders) => {
      newestModified(orders, seen)
      // Looked up each page: a full read of today may have replaced it meanwhile.
      const live = state.live
      let changed = false
      for (const order of orders) {
        countRefunds(state.ledger, order)
        const at = placedAt(order)
        if (Number.isNaN(at)) continue
        const day = vnDay(at)
        if (live && day === live.day) {
          if (keepNewer(live.orders, factsOf(order, OTHER_CHANNEL))) changed = true
          continue
        }
        const kept = day < today ? state.days[day] : undefined
        if (kept && changesKeptDay(factsOf(order, OTHER_CHANNEL), order, kept.computedAt, state.signatures.get(day))) {
          markRecheck(state.rechecks, day, Date.now())
        }
      }
      if (live && changed) setDay(state, live.day, statsOf(live.orders, live.day, Date.now()))
    })
  }

  const ledger = state.ledger
  const live = state.live
  let cursor = nextCursor(from, seen, started)
  // A read of today that ended while this one ran replaced the day this one
  // was adding orders to: the next ledger read goes back to where the ledger
  // stood when that read began.
  if (live && live.fullAt >= started) cursor = Math.min(cursor, live.fromCursor)
  ledger.cursor = cursor
  ledger.readAt = started
  for (const [id, at] of Object.entries(ledger.recent)) if (at < ledger.cursor - RECENT_MS) delete ledger.recent[id]
  if (live) {
    live.at = Date.now()
    const day = state.days[live.day]
    if (day) day.computedAt = live.at
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
    const began = Date.now()
    const orders = await readDay(context, state, day)
    // The live day, read again as an earlier one (just after midnight): its
    // orders the ledger saw change later keep that version, and the ledger
    // goes on from these.
    const live = state.live
    if (live?.day === day) {
      for (const [id, facts] of live.orders) if (orders.has(id)) keepNewer(orders, facts)
      live.orders = orders
    }
    const stats = statsOf(orders, day, Date.now())
    setDay(state, day, stats)
    keepSignatures(state, day, orders)
    settleRecheck(state.rechecks, day, began)
    // Written now and then while many days come in; the last worker writes the rest.
    if (Date.now() - state.persistedAt > BACKFILL_PERSIST_MS) await persist(context.connectionId, state)
    return stats
  })
}

/**
 * Fills in `days` behind the response, DAY_WORKERS at a time, most recent
 * first. The store's gate keeps them all within its call budget together. A
 * day whose last read failed is left out until it has waited (see mayRetry),
 * so a failing store is not asked for the same days round after round.
 */
function enqueue(context: ConnectionContext, state: State, days: string[]) {
  const now = Date.now()
  for (const day of days) if (!state.reading.has(day) && mayRetry(state.failed, day, now)) state.queue.add(day)
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
            state.failed.delete(day)
          } catch (error) {
            recordFailure(state.failed, day, error instanceof Error ? error.message : String(error), Date.now())
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

/** Lets one earlier day marked by the ledger through to be read again, when one is due (see takeRecheck). */
function admitRecheck(context: ConnectionContext, state: State) {
  if (state.rechecks.marks.size === 0) return
  const now = Date.now()
  const today = vnDate(new Date())
  const day = takeRecheck(
    state.rechecks,
    now,
    (d) => state.days[d]?.computedAt,
    (d) => d >= today || !state.days[d] || state.reading.has(d) || state.queue.has(d) || !mayRetry(state.failed, d, now),
  )
  if (day) enqueue(context, state, [day])
}

/** Waits for `work`, but no later than `until` (epoch ms); whether it finished. */
async function within(work: Promise<unknown>, until: number): Promise<boolean> {
  const left = until - Date.now()
  if (left <= 0) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), left)
  })
  try {
    return await Promise.race([work.then(() => true), late])
  } finally {
    clearTimeout(timer)
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
  for (const [channel, cell] of refundIndexOf(state).get(day) ?? []) {
    if (channels && !channels.includes(channel)) continue
    cell.forEach((value, i) => (out[i] += value))
  }
  return out
}

/**
 * The refunds on the kept days' orders, gathered by the day made — for the days
 * before the ledger, which count their returns from them. Once for all the days
 * asked, rather than every kept day scanned for each (a year of days, for each
 * of a view's days). The cells stay in the order the kept days are, so the sums
 * are the same to the last bit as a scan would give.
 */
function refundIndexOf(state: State): Map<string, Array<[string, RefundTally]>> {
  if (state.refundIndex) return state.refundIndex
  const index = new Map<string, Array<[string, RefundTally]>>()
  for (const stats of Object.values(state.days)) {
    for (const [day, perChannel] of Object.entries(stats.refunds ?? {})) {
      if (day >= state.ledger.since) continue
      const list = index.get(day) ?? index.set(day, []).get(day)!
      for (const entry of Object.entries(perChannel)) list.push(entry)
    }
  }
  state.refundIndex = index
  return index
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
  const due = new Set(recent.filter((day) => !isFresh(day, state.days[day], today) || !hasHourValues(state.days[day])))
  for (const day of recent) for (const earlier of returnDaysOf(state, day)) if (!isFresh(earlier, state.days[earlier], today)) due.add(earlier)
  if (due.size > 0) enqueue(context, state, [...due])
  // An earlier day the ledger saw one of its orders change on, read again when its turn comes.
  admitRecheck(context, state)
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

  // Nothing here waits on Sapo longer than this — nor past RESPONSE_BUDGET_MS
  // into a read of today already under way, so a page asking every few
  // seconds is not held each time by the same long read.
  const until = Date.now() + RESPONSE_BUDGET_MS
  const budget = () => Math.min(until, (state.todayReadSince || Date.now()) + RESPONSE_BUDGET_MS)

  // Today's orders are read whole only when the view reaches today. The first
  // read is waited for, within the budget: past it the response goes out with
  // today marked as still syncing. The safety-net re-read goes on behind the
  // response, which answers with today as the ledger keeps it.
  if (period.end === today) {
    const read = refreshToday(context, state, today).then(
      () => {
        state.todayError = null
      },
      (error) => {
        state.todayError = error instanceof Error ? error.message : String(error)
      },
    )
    if (state.live?.day !== today || !state.days[today]) await within(read, budget())
    if (state.todayError) failures.push({ source: 'Sapo', message: state.todayError })
  }
  // The refunds — and today's newest orders — through the ledger. A long
  // catch-up (the first run, or after a quiet spell) goes on behind the
  // response; the usual few seconds' worth is waited for.
  const sweep = syncLedger(context, state)
  if (sweep && Date.now() - ledgerReadAt(state.ledger) < CATCH_UP_MS) await within(sweep, until)
  if (state.sweepError) failures.push({ source: 'Sapo', message: state.sweepError })
  admitRecheck(context, state)

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
    (day) => day !== today && (!isFresh(day, state.days[day], today) || (currentDays.includes(day) && !hasHourValues(state.days[day]))),
  )
  const adminUrl = productAdminUrl(context)
  if (stale.length > 0) enqueue(context, state, stale)
  const failedDays = currentFailure(state.failed, Date.now())
  if (failedDays) failures.push({ source: 'Sapo', message: failedDays })
  // Today counts as missing until it has been read whole in this run: what the
  // file kept of it may be hours old, and is never shown as final.
  const unread = (day: string) => !state.days[day] || (day === today && state.live?.day !== today)
  const missing = (days: string[]) => days.filter(unread).length
  const pendingDays = missing(wanted)
  const sync = {
    current: missing(currentDays),
    previous: missing(previousDays) + missing(previousReturnDays),
    total: wanted.length + currentReturnDays.length + previousReturnDays.length,
    returns: missing(currentReturnDays),
    catchingUp: Date.now() - ledgerReadAt(state.ledger) > BEHIND_MS,
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
      hours: hoursOf(state, range, today, channels, currentDays),
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
    hours: hoursOf(state, range, today, channels, currentDays),
    products: productsOf(state, channels, currentDays, adminUrl, period.end < today ? period.end : null),
    failures,
  }
}

/** One product's orders on one day, over the chosen channels — see sapoProductDays. */
export type SapoProductDay = {
  name: string
  orders: number
  quantity: number
  cancelled: number
  gmv: number
  cancelledGmv: number
  skus: string[]
  /** Hour of the day (Vietnam time) → [orders, cancelled]; hours without orders left out. */
  hours: Record<string, [number, number]>
}

/**
 * The products sold on each of `days`, over the channels chosen for the
 * project — for the reports that look at products day by day (orders and
 * cancellations per product, and when in the day they come). Read from the
 * same day store as the overview, so nothing is fetched twice: days missing,
 * or kept from before products carried their SKUs and hours, are filled in
 * behind the response and counted in `pendingDays` until they land.
 */
export async function sapoProductDays(
  context: ConnectionContext,
  days: string[],
): Promise<{
  days: Record<string, Record<string, SapoProductDay>>
  /** The day's orders as orders (an order holding two products counts once): created, cancelled, and both by hour. */
  totals: Record<string, { created: number; cancelled: number; hours: Array<[number, number]> }>
  pendingDays: number
  failures: Failure[]
}> {
  const today = vnDate(new Date())
  const state = await stateFor(context.connectionId)
  state.viewedAt = Date.now()
  const channels = selectionOf(context.metadata).sapoChannels
  const failures: Failure[] = []

  const until = Date.now() + RESPONSE_BUDGET_MS
  if (days.includes(today)) {
    const read = refreshToday(context, state, today).then(
      () => {
        state.todayError = null
      },
      (error) => {
        state.todayError = error instanceof Error ? error.message : String(error)
      },
    )
    // Within the budget, as for the overview: past it today is counted as still pending.
    if (state.live?.day !== today || !hasProducts(state.days[today])) {
      await within(read, Math.min(until, (state.todayReadSince || Date.now()) + RESPONSE_BUDGET_MS))
    }
    if (state.todayError) failures.push({ source: 'Sapo', message: state.todayError })
    const sweep = syncLedger(context, state)
    if (sweep && Date.now() - ledgerReadAt(state.ledger) < CATCH_UP_MS) await within(sweep, until)
  }

  const stale = days.filter((day) => day !== today && (!isFresh(day, state.days[day], today) || !hasProducts(state.days[day])))
  if (stale.length > 0) enqueue(context, state, stale)
  const failedDays = currentFailure(state.failed, Date.now())
  if (failedDays) failures.push({ source: 'Sapo', message: failedDays })

  const out: Record<string, Record<string, SapoProductDay>> = {}
  const totals: Record<string, { created: number; cancelled: number; hours: Array<[number, number]> }> = {}
  for (const day of days) {
    const stats = state.days[day]
    if (!hasProducts(stats)) continue
    const tally = combine(stats, channels)!
    totals[day] = { created: tally.created, cancelled: tally.cancelled, hours: tally.hours.map((hour): [number, number] => [hour[0], hour[1]]) }
    const merged: Record<string, SapoProductDay> = {}
    for (const [channel, list] of Object.entries(stats!.products!)) {
      if (channels && !channels.includes(channel)) continue
      for (const [key, product] of Object.entries(list)) {
        const into = (merged[key] ??= { name: product.name, orders: 0, quantity: 0, cancelled: 0, gmv: 0, cancelledGmv: 0, skus: [], hours: {} })
        into.orders += product.orders
        into.quantity += product.quantity
        into.cancelled += product.cancelled ?? 0
        into.gmv += product.gmv ?? 0
        into.cancelledGmv += product.cancelledGmv ?? 0
        for (const sku of product.skus ?? []) if (!into.skus.includes(sku)) into.skus.push(sku)
        for (const [hour, [orders, cancelled]] of Object.entries(product.hours ?? {})) {
          const cell = (into.hours[hour] ??= [0, 0])
          cell[0] += orders
          cell[1] += cancelled
        }
      }
    }
    out[day] = merged
  }
  // Today stays pending until read whole in this run (see sapoOverview).
  const pending = (day: string) => !hasProducts(state.days[day]) || (day === today && state.live?.day !== today)
  return { days: out, totals, pendingDays: days.filter(pending).length, failures }
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
  // Orders by the hour placed, summed over the days that kept hours (products version 3 on).
  const byHour = new Map<string, number[]>()
  // Their sales (value less the cancelled orders'): only once every day of the view has them
  // (version 4) — a sum over some of the days would read as the whole view's.
  const byHourSales = new Map<string, number[]>()
  const salesKnown = currentDays.every((day) => !state.days[day]?.products || hasHourValues(state.days[day]))
  for (const day of currentDays) {
    const perChannel = state.days[day]?.products
    if (!perChannel) continue
    for (const [channel, list] of Object.entries(perChannel)) {
      if (channels && !channels.includes(channel)) continue
      for (const [key, product] of Object.entries(list)) {
        if (product.hours) {
          const hours = byHour.get(key) ?? byHour.set(key, Array.from({ length: 24 }, () => 0)).get(key)!
          for (const [hour, [orders]] of Object.entries(product.hours)) hours[Number(hour)] += orders
          if (salesKnown) {
            const sales = byHourSales.get(key) ?? byHourSales.set(key, Array.from({ length: 24 }, () => 0)).get(key)!
            for (const [hour, cell] of Object.entries(product.hours)) sales[Number(hour)] += (cell[2] ?? 0) - (cell[3] ?? 0)
          }
        }
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
        hours: byHour.get(key) ?? null,
        hourSales: salesKnown ? (byHourSales.get(key) ?? null) : null,
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
 * half-over day never drags the evening down.
 */
function hoursOf(
  state: State,
  range: DashboardRange,
  today: string,
  channels: string[] | null,
  currentDays: string[],
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
    const sales = Array.from({ length: 24 }, () => 0)
    const days = Array.from({ length: 24 }, () => 0)
    for (const { day, tally } of list) {
      for (let hour = 0; hour < 24; hour++) {
        if (!countsHour(day, hour)) continue
        totals[hour] += tally.hours[hour][0]
        // The hour's value less its cancelled orders' (HourTally: gmv at 2, cancelled value at 3).
        sales[hour] += tally.hours[hour][2] - tally.hours[hour][3]
        days[hour] += 1
      }
    }
    const per = (sums: number[]) => sums.map((sum, hour) => (days[hour] === 0 ? null : single ? sum : sum / days[hour]))
    return { values: per(totals), salesValues: per(sales) }
  }

  const mine = perHour(synced(currentDays))
  return {
    profile: mine.values,
    revenue: mine.salesValues,
    currentHour: currentDays.includes(today) ? hourNow : null,
  }
}
