import 'server-only'

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { sendRequest } from '@/core/plugins/http'
import { requireEndpoint, requirePlugin } from '@/core/plugins/registry'
import type { ConnectionContext } from '@/core/plugins/types'
import { readJsonFile, writeFileAtomic } from '@/core/utils/atomic-write'
import { shiftDay, vnDate } from '../period'
import { kocKey } from '../shared/keys'
import { dayStore, settlingFreshness, type DayRead } from './day-store'
import {
  aggregate,
  applyOrders,
  applyReturns,
  dayOfUnix,
  dayStart,
  emptyLedger,
  findOrder,
  initialCursor,
  inWindow,
  list,
  mergeFull,
  money,
  orderIdOf,
  readSplitting,
  recordOf,
  refundsByDay,
  returnIdOf,
  roll,
  SETTLE_DAYS,
  type LedgerData,
  type OrderRecord,
  type Page,
  type ShopOrderDay,
} from './tiktok-shop-ledger'

export type { ShopHourTally, ShopOrderDay, ShopProductDay } from './tiktok-shop-ledger'

/**
 * TikTok Shop, day by day: the shop's orders, its creators' (affiliate)
 * orders, the videos posted, and the analytics TikTok keeps per product —
 * each kept on disk per day (day-store.ts) and read again only while it can
 * still change.
 *
 * What each holds is summed at read time, so a day on disk is small: per
 * product and per creator, never per order.
 *
 * Two clocks. Orders are live: every few minutes TikTok is asked which orders
 * changed since it was last asked, and the days they were placed are brought
 * up to date order by order (tiktok-shop-ledger.ts) — today is read in full
 * only every couple of hours, as a safety net. The analytics (videos, product
 * performance, ratings) are ready a day or two late — TikTok says up to which
 * date in `latest_available_date` — so a day past that is kept as "not
 * available yet" and asked again a few hours later, and the reports show it
 * as a gap rather than a zero.
 */

const PLUGIN = 'tiktok-shop'
/** TikTok Shop sets no fixed rate; reads start at 3–10 a second. A few at once keeps well inside that. */
const MAX_IN_FLIGHT = 3
const RETRIES = 4
/** Codes worth waiting out: TikTok Shop's rate limit and its internal error. */
const TRANSIENT = new Set([36009002, 36009003])

/**
 * The app lacks the scope an endpoint needs (Partner Center, "Common errors").
 * Not a failure of the source: the shop simply does not share that data with
 * this app — the affiliate orders, for an app without the affiliate scope.
 * Reports go on without it and say nothing; the endpoint is not asked again
 * for a while, since only re-authorising the app can change the answer.
 */
const SCOPE_DENIED = 105005
const DENIED_RETRY_MS = 6 * 3600_000
const denied = ((globalThis as unknown as { __adshubTtsDenied?: Map<string, number> }).__adshubTtsDenied ??= new Map())

/** Whether a read failed only because the app may not use that endpoint. */
export const isScopeDenied = (error: string | null | undefined) => Boolean(error && new RegExp(`\\b${SCOPE_DENIED}\\b`).test(error))

type Body = { code?: number; message?: string; data?: Record<string, unknown> }

const gates = ((globalThis as unknown as { __adshubTtsGates?: Map<string, { inFlight: number }> }).__adshubTtsGates ??= new Map())
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function enter(connectionId: string) {
  let gate = gates.get(connectionId)
  if (!gate) gates.set(connectionId, (gate = { inFlight: 0 }))
  while (gate.inFlight >= MAX_IN_FLIGHT) await pause(60)
  gate.inFlight += 1
  return gate
}

/** One call through the connector (signed, with the connection's shop), its `data`; throws with TikTok's message. */
export async function ttsCall(context: ConnectionContext, endpointId: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const plugin = requirePlugin(PLUGIN)
  const endpoint = requireEndpoint(PLUGIN, endpointId)
  const resolved = plugin.resolveParams ? plugin.resolveParams({ endpoint, params, context }) : params
  const deniedKey = `${context.connectionId}:${endpointId}`
  const deniedAt = denied.get(deniedKey)
  if (deniedAt && Date.now() - deniedAt < DENIED_RETRY_MS) throw new Error(`TikTok Shop ${SCOPE_DENIED}: the app has no scope for ${endpointId}`)
  for (let attempt = 0; ; attempt++) {
    const gate = await enter(context.connectionId)
    let response
    try {
      // Built on each attempt: the signature carries a timestamp.
      response = await sendRequest(plugin.buildRequest({ endpoint, params: resolved, context }), { maxRetries: 1, timeoutMs: 30_000, idempotent: true })
    } finally {
      gate.inFlight -= 1
    }
    const body = (response.data ?? {}) as Body
    if (response.ok && body.code === 0) {
      denied.delete(deniedKey)
      return body.data ?? {}
    }
    if (body.code === SCOPE_DENIED) denied.set(deniedKey, Date.now())
    const transient = response.status === 429 || TRANSIENT.has(body.code ?? -1)
    if (transient && attempt < RETRIES) {
      await pause(1_000 * 2 ** attempt + Math.random() * 500)
      continue
    }
    throw new Error(plugin.parseError?.(response.status, response.data) ?? response.error ?? 'TikTok Shop request failed')
  }
}

/**
 * The pages of a listing, handed over one at a time, up to `maxPages` — and
 * no further, silently: only for listings sorted so that what is cut matters
 * least (the videos and products of a day, by GMV). Orders are read with
 * readSplitting, which never keeps part of a day as all of it.
 */
async function eachPage(
  context: ConnectionContext,
  endpointId: string,
  params: Record<string, unknown>,
  take: (data: Record<string, unknown>) => void,
  maxPages = 200,
) {
  let token: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const data = await ttsCall(context, endpointId, { ...params, page_size: 100, page_token: token })
    take(data)
    token = typeof data.next_page_token === 'string' && data.next_page_token ? data.next_page_token : undefined
    if (!token) return
  }
}

/** A listing's page as readSplitting takes it: the items under `key`, and the next page's token. */
const pageOf = (data: Record<string, unknown>, key: string): Page => ({
  items: list(data[key]),
  next: typeof data.next_page_token === 'string' && data.next_page_token ? data.next_page_token : undefined,
})

/* --------------------------------------------------------------- orders --- */

/**
 * How the orders are kept, in three layers:
 *
 *  · The day store (tts-orders) holds each day's figures, read in full from
 *    orders/search by the day's create_time — what every report reads.
 *  · The ledger (tiktok-shop-ledger.ts; one file per shop beside the store)
 *    holds the orders of the days still changing one by one, and the sweep
 *    keeps it current: every SWEEP_EVERY_MS it asks for the orders changed
 *    since its cursor (update_time, OVERLAP_S back), and applies each to the
 *    day it was placed. For those days the ledger's sum is what is served —
 *    from the first full read of the day on, and only while the sweep keeps
 *    going through (SWEEP_HEALTHY_MS).
 *  · Full reads stay, much rarer, as the safety net any drift heals by: today
 *    every two hours while the sweep is healthy (a quarter hour when it is
 *    not, as before), the week before every three hours, a settled day once.
 *    A settled day the sweep saw change (a late cancellation) is read again.
 *
 * The same sums serve both ways (aggregate): a day summed from the ledger and
 * the same day read in full come to the same figures.
 */
const KEEP_DAYS = 330
const SWEEP_EVERY_MS = 5 * 60_000
/** A sweep that failed is tried again after this. */
const SWEEP_RETRY_MS = 60_000
/** How long a request waits for a sweep due, before answering with what is kept (within its own budget). */
const SWEEP_WAIT_MS = 2_500
/** The ledger's days are served only while a sweep went through this recently. */
const SWEEP_HEALTHY_MS = 20 * 60_000
/** Each sweep asks from this far before the last one began: TikTok's search may index a change a moment late. */
const OVERLAP_S = 120
/** Pages of one query before the window it covers is cut in two (readSplitting): 10,000 orders. */
const PAGE_CAP = 100
/** The return/refund requests are asked about less often: a refund moves slowly. */
const RETURNS_EVERY_MS = 30 * 60_000
const RETURNS_RETRY_MS = 30 * 60_000
/** Orders looked up at once for the day they were placed (order-detail takes 50 ids). */
const LOOKUP_BATCH = 50

/** A day as the store keeps it: its figures, the ledger that stands beside them, and when the read began. */
type StoredOrderDay = ShopOrderDay & { ledger?: string; readAt?: number }

type LedgerState = {
  id: string
  file: string
  data: LedgerData
  loaded: Promise<void> | null
  sweeping: Promise<void> | null
  sweepFailedAt: number
  returnsSweeping: Promise<void> | null
  returnsFailedAt: number
  /** The last failure logged, so an outage is written to the log once, not every few minutes. */
  logged: string | null
  writing: Promise<void> | null
  timer: ReturnType<typeof setTimeout> | null
  dirty: boolean
  /** Per day, its sum from the ledger at a `rev`: summed again only when the day changed. */
  sums: Map<string, { rev: number; value: ShopOrderDay }>
}

const CACHE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'cache')
const LEDGER_SAVE_MS = 5_000
const ledgers = ((globalThis as unknown as { __adshubTtsLedgers?: Map<string, LedgerState> }).__adshubTtsLedgers ??= new Map())

/** The ledger's id: the connection and its shop, as the day store names its file. */
function ledgerIdOf(context: ConnectionContext) {
  const scope = shopScope(context).replace(/[^A-Za-z0-9_-]/g, '')
  return (scope ? `${context.connectionId}-${scope}` : context.connectionId).replace(/[^A-Za-z0-9_-]/g, '')
}

async function ledgerFor(context: ConnectionContext): Promise<LedgerState> {
  const id = ledgerIdOf(context)
  let state = ledgers.get(id)
  if (!state) {
    state = {
      id,
      file: path.join(CACHE_DIR, `tts-order-ledger-${id}.json`),
      data: emptyLedger(),
      loaded: null,
      sweeping: null,
      sweepFailedAt: 0,
      returnsSweeping: null,
      returnsFailedAt: 0,
      logged: null,
      writing: null,
      timer: null,
      dirty: false,
      sums: new Map(),
    }
    ledgers.set(id, state)
  }
  const current = state
  current.loaded ??= readJsonFile<LedgerData>(current.file)
    .then((parsed) => {
      if (parsed && parsed.version === 1 && parsed.days && typeof parsed.days === 'object') {
        current.data = { ...emptyLedger(), ...parsed }
      }
    })
    .catch(() => {
      /* nothing kept yet, or unreadable: start empty — the next full reads fill it */
    })
  await current.loaded
  return current
}

/** Saves the ledger a moment after it changed; one write at a time, a change made during one goes in the next. */
function saveLedger(state: LedgerState) {
  state.dirty = true
  if (state.timer || state.writing) return
  state.timer = setTimeout(() => {
    state.timer = null
    state.writing = (async () => {
      await mkdir(CACHE_DIR, { recursive: true })
      while (state.dirty) {
        state.dirty = false
        await writeFileAtomic(state.file, JSON.stringify(state.data))
      }
    })()
      .catch((error) => console.warn(`[tts-orders] ledger save failed: ${error instanceof Error ? error.message : error}`))
      .finally(() => {
        state.writing = null
        if (state.dirty) saveLedger(state)
      })
  }, LEDGER_SAVE_MS)
}

function logOnce(state: LedgerState, what: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  // A shop that does not share the data with this app is not an outage (see SCOPE_DENIED).
  if (isScopeDenied(message) || state.logged === message) return
  state.logged = message
  console.warn(`[tts-orders] ${what} ${state.id}: ${message}`)
}

const sweepHealthy = (data: LedgerData) => Date.now() - data.sweptAt < SWEEP_HEALTHY_MS

/**
 * The ledger's figures for `day`, when it holds all of the day; else null.
 * Every full read goes into the ledger too (mergeFull), so its figures are
 * never older than the stored read's — served even when the sweep has
 * paused (a quiet dev server, a failing round), so the page never steps back
 * to a read up to two hours old. Only a stored read begun after the ledger's
 * (its file not saved before a restart) wins over it.
 */
function ledgerDay(state: LedgerState, day: string, today: string, storedReadAt: number | undefined): ShopOrderDay | null {
  const entry = inWindow(day, today) ? state.data.days[day] : undefined
  if (!entry?.full) return null
  if (storedReadAt !== undefined && storedReadAt > entry.readAt) return null
  const kept = state.sums.get(day)
  if (kept && kept.rev === entry.rev) return kept.value
  const value = aggregate(Object.values(entry.orders))
  state.sums.set(day, { rev: entry.rev, value })
  return value
}

/** While the sweep keeps the recent days current, a full read is the safety net only. */
const withSweep = settlingFreshness({ todayMs: 2 * 3600_000, recentMs: 3 * 3600_000, settleDays: SETTLE_DAYS })
/** Without it (never swept, or failing): as before — today every quarter hour. */
const withoutSweep = settlingFreshness({ todayMs: 15 * 60_000, recentMs: 3 * 3600_000, settleDays: SETTLE_DAYS })

function orderDayFresh(day: string, computedAt: number, today: string, value: StoredOrderDay) {
  const state = value.ledger ? ledgers.get(value.ledger) : undefined
  if (state) {
    // A day read before this code kept no start time: its read is taken to have begun ten minutes before it ended.
    const readAt = value.readAt ?? computedAt - 10 * 60_000
    const touched = state.data.touched[day]
    if (touched !== undefined && touched > readAt - OVERLAP_S * 1000) return false
    if (inWindow(day, today) && state.data.days[day]?.full && sweepHealthy(state.data)) return withSweep(day, computedAt, today)
  }
  return withoutSweep(day, computedAt, today)
}

const ordersStore = dayStore<StoredOrderDay>({
  name: 'tts-orders',
  // 2: hours by the hour placed, for the shop and each product. (`ledger`, `readAt` and the
  // missing-create_time rule came later without changing the shape: days kept stand.)
  version: 2,
  scopeOf: shopScope,
  keepDays: KEEP_DAYS,
  isFresh: orderDayFresh,
  workers: 2,
  async compute(context, day) {
    const readAt = Date.now()
    const records = new Map<string, OrderRecord>()
    await readSplitting(
      async (from, to, token) =>
        pageOf(
          await ttsCall(context, 'orders-search', { sort_field: 'create_time', sort_order: 'ASC', create_time_ge: from, create_time_lt: to, page_size: 100, page_token: token }),
          'orders',
        ),
      dayStart(day),
      dayStart(shiftDay(day, 1)),
      (orders) => {
        for (const order of orders) {
          const id = orderIdOf(order)
          if (!id) continue
          const record = recordOf(order)
          const kept = records.get(id)
          if (!kept || record.u >= kept.u) records.set(id, record)
        }
      },
      { pageCap: PAGE_CAP, what: `orders placed on ${day}` },
    )
    const state = await ledgerFor(context)
    const merged = mergeFull(state.data, day, records, vnDate(new Date()), readAt, KEEP_DAYS)
    saveLedger(state)
    return { ...aggregate(merged), ledger: state.id, readAt }
  },
})

/**
 * Asks TikTok for the orders changed since the cursor and applies them
 * (applyOrders). The cursor moves only when every change up to the sweep's
 * start is in; a sweep that fails leaves it, and the next asks again.
 */
function sweepOrders(context: ConnectionContext, state: LedgerState): Promise<void> {
  if (state.sweeping) return state.sweeping
  state.sweeping = (async () => {
    const started = Math.floor(Date.now() / 1000)
    const today = vnDate(new Date())
    roll(state.data, today, KEEP_DAYS)
    const from = (state.data.cursor ?? initialCursor(state.data, started)) - OVERLAP_S
    await readSplitting(
      async (windowFrom, windowTo, token) =>
        pageOf(
          await ttsCall(context, 'orders-search', {
            sort_field: 'update_time',
            sort_order: 'ASC',
            update_time_ge: windowFrom,
            update_time_lt: windowTo,
            page_size: 100,
            page_token: token,
          }),
          'orders',
        ),
      from,
      started + 60,
      (orders) => {
        applyOrders(state.data, orders, today, KEEP_DAYS)
      },
      { pageCap: PAGE_CAP, what: 'changed orders' },
    )
    state.data.cursor = started
    state.data.sweptAt = Date.now()
    state.sweepFailedAt = 0
    state.logged = null
    saveLedger(state)
  })()
    .catch((error) => {
      state.sweepFailedAt = Date.now()
      logOnce(state, 'order sweep', error)
    })
    .finally(() => {
      state.sweeping = null
    })
  return state.sweeping
}

const sweepDue = (state: LedgerState) =>
  !state.sweeping && Date.now() - state.data.sweptAt >= SWEEP_EVERY_MS && Date.now() - state.sweepFailedAt >= SWEEP_RETRY_MS

const returnsDue = (state: LedgerState) =>
  !state.returnsSweeping && Date.now() - (state.data.returns?.sweptAt ?? 0) >= RETURNS_EVERY_MS && Date.now() - state.returnsFailedAt >= RETURNS_RETRY_MS

/**
 * The return/refund requests changed since the last time (returns-search),
 * each filed under the day its order was placed: found in the ledger, or looked
 * up (order-detail). The first read goes back KEEP_DAYS; until it went through
 * no refund figure is shown. An app without the return/refund scope gets
 * TikTok's 105005: the figure is simply absent, nothing is reported.
 */
const RETURNS_PAGE_SIZE = 50

function sweepReturns(context: ConnectionContext, state: LedgerState): Promise<void> {
  if (state.returnsSweeping) return state.returnsSweeping
  state.returnsSweeping = (async () => {
    const started = Math.floor(Date.now() / 1000)
    const returns = state.data.returns ?? { cursor: null, from: dayStart(shiftDay(vnDate(new Date()), -KEEP_DAYS)), sweptAt: 0, items: {} }
    const rows: Array<Record<string, unknown>> = []
    await readSplitting(
      async (windowFrom, windowTo, token) =>
        pageOf(
          await ttsCall(context, 'returns-search', {
            sort_field: 'update_time',
            sort_order: 'ASC',
            update_time_ge: windowFrom,
            update_time_lt: windowTo,
            // This search takes 10 to 50 a page (98001004 otherwise), unlike the orders' 100.
            page_size: RETURNS_PAGE_SIZE,
            page_token: token,
          }),
          'return_orders',
        ),
      (returns.cursor ?? returns.from) - OVERLAP_S,
      started + 60,
      (items) => {
        // A request made before `from` is on an order placed before it: outside the days kept.
        for (const row of items) if (returnIdOf(row) && !(Number(row.create_time) < returns.from)) rows.push(row)
      },
      { pageCap: PAGE_CAP, what: 'return requests' },
    )
    // The day each request's order was placed: in the ledger, kept from before, or asked.
    const orders = new Map<string, { day: string | null; cancelled: boolean }>()
    const knownDay = new Map(Object.values(returns.items).filter((item) => item.d).map((item) => [item.o, item]))
    const unknown: string[] = []
    for (const row of rows) {
      const orderId = String(row.order_id ?? '')
      if (!orderId || orders.has(orderId)) continue
      const found = findOrder(state.data, orderId)
      const known = knownDay.get(orderId)
      if (found) orders.set(orderId, found)
      // Known from an earlier request on the same order: a new request (a new return id) takes its day from there.
      else if (known?.d) orders.set(orderId, { day: known.d, cancelled: known.c === 1 })
      else if (!unknown.includes(orderId)) unknown.push(orderId)
    }
    for (let i = 0; i < unknown.length; i += LOOKUP_BATCH) {
      const data = await ttsCall(context, 'order-detail', { ids: unknown.slice(i, i + LOOKUP_BATCH).join(',') })
      for (const order of list(data.orders)) {
        orders.set(orderIdOf(order), { day: dayOfUnix(order.create_time), cancelled: order.status === 'CANCELLED' })
      }
    }
    state.data.returns = returns
    applyReturns(state.data, rows, orders)
    returns.cursor = started
    returns.sweptAt = Date.now()
    state.returnsFailedAt = 0
    saveLedger(state)
  })()
    .catch((error) => {
      state.returnsFailedAt = Date.now()
      logOnce(state, 'returns sweep', error)
    })
    .finally(() => {
      state.returnsSweeping = null
    })
  return state.returnsSweeping
}

/**
 * The store's read, with the ledger laid over it: the days it keeps current
 * are served from it, and each day gets its refunds when they are known. The
 * store's own days are tagged with the ledger (orderDayFresh finds it by that).
 */
function withLedger(state: LedgerState, read: DayRead<StoredOrderDay>): DayRead<ShopOrderDay> {
  const today = vnDate(new Date())
  const refunds = refundsByDay(state.data)
  const values: Record<string, ShopOrderDay> = {}
  for (const [day, value] of Object.entries(read.values)) {
    value.ledger ??= state.id
    let out: ShopOrderDay = ledgerDay(state, day, today, value.readAt) ?? value
    if (refunds && day >= refunds.from) {
      const refunded = refunds.days[day]
      out = { ...out, refunded: refunded?.amount ?? 0, refundedOrders: refunded?.orders ?? 0 }
    }
    values[day] = out
  }
  return { ...read, values }
}

/**
 * The shop's orders over `days`. A sweep due is waited for a moment, and a
 * today not kept yet up to the rest of `budgetMs` (15 s): the whole never
 * waits longer than that, and a day kept — stale or not — is answered at once.
 */
export async function shopOrderDays(context: ConnectionContext, days: string[], options: { budgetMs?: number } = {}): Promise<DayRead<ShopOrderDay>> {
  const deadline = Date.now() + (options.budgetMs ?? 15_000)
  const state = await ledgerFor(context)
  if (sweepDue(state)) {
    const sweep = sweepOrders(context, state)
    const wait = Math.max(0, Math.min(SWEEP_WAIT_MS, deadline - Date.now()))
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([sweep, new Promise((resolve) => (timer = setTimeout(resolve, wait)))])
    clearTimeout(timer)
  }
  if (returnsDue(state)) void sweepReturns(context, state)
  const read = await ordersStore.read(context, days, { wait: [vnDate(new Date())], waitMs: Math.max(0, deadline - Date.now()) })
  return withLedger(state, read)
}

/* ------------------------------------------------------------ affiliate --- */

export type CreatorDay = {
  /** Orders (once each), units, their value at sale price, and the commission owed on them — estimated until settled. */
  orders: number
  units: number
  gmv: number
  commission: number
  /** Value of units fully returned: no commission is paid on them. */
  returnedGmv: number
  products: Record<string, { orders: number; units: number; gmv: number; commission: number }>
  /** The videos the orders came through. */
  videos: string[]
}

export type AffiliateDay = {
  creators: Record<string, CreatorDay>
  /** Per video: its creator, the products sold through it, orders and value. */
  videos: Record<string, { creator: string; products: string[]; orders: number; gmv: number }>
}

const affiliateStore = dayStore<AffiliateDay>({
  name: 'tts-affiliate',
  version: 1,
  scopeOf: shopScope,
  keepDays: 330,
  // Commission settles after delivery and the return window: about a month.
  isFresh: settlingFreshness({ todayMs: 30 * 60_000, recentMs: 12 * 3600_000, settleDays: 30 }),
  workers: 2,
  async compute(context, day) {
    const out: AffiliateDay = { creators: {}, videos: {} }
    const seen = new Set<string>()
    // Read in parts when a day holds more than PAGE_CAP pages, never cut short (each line is counted once by `seen`).
    const take = (orders: Array<Record<string, unknown>>) => {
      for (const order of orders) {
        const orderId = String(order.id ?? '')
        for (const sku of list(order.skus)) {
          const creatorName = kocKey(sku.creator_username)
          if (!creatorName) continue
          const productId = String(sku.product_id ?? '')
          // One row per SKU of an order: a creator's order is counted once, each of its products once.
          const lineKey = `${orderId}:${sku.sku_id ?? ''}:${creatorName}`
          if (seen.has(lineKey)) continue
          seen.add(lineKey)
          const quantity = Number(sku.quantity) || 1
          const value = money(sku.estimated_commission_base) || money(sku.price) * quantity
          const commission = money(sku.estimated_paid_commission) + money(sku.estimated_paid_partner_commission)
          const creator = (out.creators[creatorName] ??= { orders: 0, units: 0, gmv: 0, commission: 0, returnedGmv: 0, products: {}, videos: [] })
          if (!seen.has(`${orderId}:${creatorName}`)) {
            seen.add(`${orderId}:${creatorName}`)
            creator.orders += 1
          }
          creator.units += quantity
          creator.gmv += value
          creator.commission += commission
          if (String(sku.fully_return).toLowerCase() === 'yes') creator.returnedGmv += value
          if (productId) {
            const product = (creator.products[productId] ??= { orders: 0, units: 0, gmv: 0, commission: 0 })
            if (!seen.has(`${orderId}:${creatorName}:${productId}`)) {
              seen.add(`${orderId}:${creatorName}:${productId}`)
              product.orders += 1
            }
            product.units += quantity
            product.gmv += value
            product.commission += commission
          }
          const videoId = sku.content_type === 'VIDEO' ? String(sku.content_id ?? '') : ''
          if (videoId) {
            if (!creator.videos.includes(videoId)) creator.videos.push(videoId)
            const video = (out.videos[videoId] ??= { creator: creatorName, products: [], orders: 0, gmv: 0 })
            if (productId && !video.products.includes(productId)) video.products.push(productId)
            if (!seen.has(`${orderId}:video:${videoId}`)) {
              seen.add(`${orderId}:video:${videoId}`)
              video.orders += 1
            }
            video.gmv += value
          }
        }
      }
    }
    await readSplitting(
      async (from, to, token) =>
        pageOf(await ttsCall(context, 'affiliate-orders-search', { create_time_ge: from, create_time_lt: to, page_size: 100, page_token: token }), 'orders'),
      dayStart(day),
      dayStart(shiftDay(day, 1)),
      take,
      { pageCap: PAGE_CAP, what: `affiliate orders placed on ${day}` },
    )
    return out
  },
})

export function affiliateDays(context: ConnectionContext, days: string[]) {
  return affiliateStore.read(context, days, { wait: [vnDate(new Date())], waitMs: 15_000 })
}

/* ------------------------------------------------------------ analytics --- */

/**
 * Analytics a day or two behind: the last few days are re-asked every few
 * hours (TikTok fills them in, then revises them for a while), the week
 * before that daily, anything older kept.
 */
function analyticsFreshness(day: string, computedAt: number, today: string, value: { available: boolean }) {
  const age = Date.now() - computedAt
  // TikTok did not have the day when it was read: ask again now and then, for a month.
  if (!value.available) return day < shiftDay(today, -30) || age < 6 * 3600_000
  if (day >= shiftDay(today, -3)) return age < 3 * 3600_000
  if (day >= shiftDay(today, -10)) return age < 24 * 3600_000
  return computedAt >= Date.parse(`${shiftDay(day, 4)}T00:00:00+07:00`)
}

/** The shop a connection reads: its days are kept apart from another shop's. */
function shopScope(context: ConnectionContext) {
  return String(context.credentials.shopCipher || context.metadata.shopId || context.metadata.shopCipher || '')
}

/** Analytics exist for finished days only: today is never asked. */
function pastDays(days: string[]) {
  const today = vnDate(new Date())
  return days.filter((day) => day < today)
}

export type VideoDay = {
  /** TikTok had this day's figures when it was read. */
  available: boolean
  /** The videos posted that day, with the products attached and their creator. */
  videos: Array<{ id: string; creator: string; authorType: string; products: string[]; gmv: number; views: number }>
}

/** How far into a day's video list is read: sorted by GMV, so what is cut is the videos that sold nothing that day. */
const VIDEO_PAGES = 30

const videoStore = dayStore<VideoDay>({
  name: 'tts-videos',
  version: 1,
  scopeOf: shopScope,
  keepDays: 330,
  isFresh: analyticsFreshness,
  workers: 1,
  async compute(context, day) {
    const out: VideoDay = { available: false, videos: [] }
    await eachPage(
      context,
      'analytics-shop-videos',
      { start_date_ge: day, end_date_lt: shiftDay(day, 1), account_type: 'ALL', currency: 'LOCAL' },
      (data) => {
        const latest = String(data.latest_available_date ?? '')
        out.available = latest >= day
        for (const video of list(data.videos)) {
          if (String(video.video_post_time ?? '').slice(0, 10) !== day) continue
          const creator = (video.creator ?? {}) as Record<string, unknown>
          out.videos.push({
            id: String(video.id ?? ''),
            creator: kocKey(creator.user_name ?? video.username),
            authorType: String(creator.author_type ?? ''),
            products: list(video.products).map((product) => String(product.id ?? '')).filter(Boolean),
            gmv: money(video.gmv),
            views: Number(video.views) || 0,
          })
        }
      },
      VIDEO_PAGES,
    )
    return out
  },
})

export function videoDays(context: ConnectionContext, days: string[]) {
  return videoStore.read(context, pastDays(days))
}

export type ProductPerformanceDay = {
  available: boolean
  products: Record<
    string,
    {
      gmv: number
      orders: number
      units: number
      /** New videos that day: by creators (affiliate), and by the shop's own accounts. */
      affiliateNewVideos: number
      sellerNewVideos: number
      refunds: number
    }
  >
}

const performanceStore = dayStore<ProductPerformanceDay>({
  name: 'tts-product-perf',
  version: 1,
  scopeOf: shopScope,
  keepDays: 330,
  isFresh: analyticsFreshness,
  workers: 1,
  async compute(context, day) {
    const out: ProductPerformanceDay = { available: false, products: {} }
    await eachPage(
      context,
      'analytics-shop-products',
      { start_date_ge: day, end_date_lt: shiftDay(day, 1), sort_field: 'gmv', currency: 'LOCAL' },
      (data) => {
        out.available = String(data.latest_available_date ?? '') >= day
        for (const row of list(data.products)) {
          const id = String(row.id ?? '')
          if (!id) continue
          const total = (row.total_performance ?? {}) as Record<string, unknown>
          const affiliate = (row.affiliate_video_performance ?? {}) as Record<string, unknown>
          const seller = (row.seller_video_performance ?? {}) as Record<string, unknown>
          const figures = {
            gmv: money(total.gmv),
            orders: Number(total.orders) || 0,
            units: Number(total.items_sold) || 0,
            affiliateNewVideos: Number(affiliate.new_video_count) || 0,
            sellerNewVideos: Number(seller.new_video_count) || 0,
            refunds: money(total.refunds),
          }
          // Only products with something that day: a catalogue of thousands, 330 days over, would not fit a small server.
          if (figures.gmv > 0 || figures.orders > 0 || figures.affiliateNewVideos > 0 || figures.sellerNewVideos > 0) out.products[id] = figures
        }
      },
      50,
    )
    return out
  },
})

export function productPerformanceDays(context: ConnectionContext, days: string[]) {
  return performanceStore.read(context, pastDays(days))
}

export type RatingDay = {
  available: boolean
  /** Per product read: reviews left that day, and how many of them 1 or 2 stars. */
  products: Record<string, { reviews: number; bad: number }>
}

/**
 * Ratings come one product at a time (there is no API listing reviews, only
 * a product's star counts over a period), so each day asks about its best
 * sellers — the products a bad review can move — rather than the whole list.
 */
const RATED_PRODUCTS = 25

const ratingStore = dayStore<RatingDay>({
  name: 'tts-ratings',
  version: 1,
  scopeOf: shopScope,
  keepDays: 330,
  isFresh: analyticsFreshness,
  workers: 1,
  async compute(context, day) {
    const perf = await performanceStore.read(context, [day], { wait: [day], waitMs: 120_000 })
    const known = perf.values[day]
    // Without the day's best sellers there is nothing to ask about: fail, and try again later — an empty day kept would read as "no bad reviews".
    if (!known) throw new Error(perf.error ?? `Product performance for ${day} is not available yet`)
    const products = Object.entries(known.products)
      .sort((a, b) => b[1].gmv - a[1].gmv)
      .slice(0, RATED_PRODUCTS)
      .map(([id]) => id)
    const out: RatingDay = { available: known.available, products: {} }
    if (!known.available) return out
    for (const id of products) {
      // A product that cannot be read fails the day, rather than leaving a hole that looks like no reviews.
      const data = await ttsCall(context, 'analytics-product', {
        product_id: id,
        start_date_ge: day,
        end_date_lt: shiftDay(day, 1),
        granularity: 'ALL',
        currency: 'LOCAL',
      })
      const ratings = list((data.performance as Record<string, unknown> | undefined)?.ratings)
      let reviews = 0
      let bad = 0
      for (const rating of ratings) {
        const count = Number(rating.count) || 0
        reviews += count
        if (rating.stars === '1_STAR' || rating.stars === '2_STAR') bad += count
      }
      out.products[id] = { reviews, bad }
    }
    return out
  },
})

export function ratingDays(context: ConnectionContext, days: string[]) {
  return ratingStore.read(context, pastDays(days))
}

/** Keeps the recent days of every store ready, for the background round. */
export async function warmTiktokShop(context: ConnectionContext) {
  const today = vnDate(new Date())
  const recent = Array.from({ length: 35 }, (_, i) => shiftDay(today, -i))
  // The sweeps first: what they mark touched is queued by the read that follows.
  const ledger = await ledgerFor(context)
  if (sweepDue(ledger)) await sweepOrders(context, ledger)
  // Not waited for: the first read of the returns goes back months, and must not hold the round up.
  if (returnsDue(ledger)) void sweepReturns(context, ledger)
  await Promise.all([
    // Read rather than warmed: the same queueing, and the days it hands back are tagged with the ledger (withLedger).
    ordersStore.read(context, recent).then((read) => withLedger(ledger, read)),
    affiliateStore.warm(context, recent),
    videoStore.warm(context, recent.slice(1, 15)),
    performanceStore.warm(context, recent.slice(1, 15)),
  ])
}
