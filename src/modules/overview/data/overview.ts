import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { connections } from '@/core/db/schema/connections'
import { decryptJson } from '@/core/crypto/secrets'
import type { ConnectionContext } from '@/core/plugins/types'
import { warnThrottled } from '@/core/utils/log'
import { gmvProductHours } from '@/modules/analytics/data/gmv-max'
import { freshContext } from '@/core/plugins/fresh-credentials'
import { withAdjustments } from '@/modules/metric-adjustments/data/apply'
import { advertisersOf, gmvMaxOverview, listGmvPairs } from './gmv-max'
import { tiktokShopOverview } from './tiktok-shop'
import { listSapoChannels, sapoCatalog, sapoOverview } from './sapo'
import { pairKey, selectionOf } from './selection'
import type { Period } from './period'
import type { DashboardData, DashboardSources, GmvMaxOverview, SapoCatalog, SapoOverview, TiktokShopOverview } from './types'

/**
 * Everything the overview dashboard shows, for one project and period.
 *
 * Each source is read through its first working connection (a project with
 * two TikTok connections shows the first that tests green), limited to the
 * shops and channels chosen for the project (see selection.ts). The provider
 * calls are not written to the API log: the dashboard refreshes itself every
 * couple of minutes and would bury the calls people make on purpose.
 *
 * A failing source never blanks the other — it comes back empty, carrying the
 * reason, and the page says which source is behind.
 */

type ConnectionRow = typeof connections.$inferSelect

function contextOf(row: ConnectionRow): ConnectionContext {
  return {
    credentials: row.credentials ? decryptJson(row.credentials) : {},
    metadata: row.metadata ?? {},
    connectionId: row.id,
    projectId: row.projectId,
  }
}

function pick(rows: ConnectionRow[], pluginId: string): ConnectionRow | undefined {
  const own = rows.filter((row) => row.pluginId === pluginId)
  return own.find((row) => row.status === 'connected') ?? own[0]
}

async function projectConnections(projectId: string) {
  const rows = await db.select().from(connections).where(eq(connections.projectId, projectId))
  return { tiktok: pick(rows, 'tiktok-ads'), tiktokShop: pick(rows, 'tiktok-shop'), sapo: pick(rows, 'sapo') }
}

/** The Sapo connection each project's dashboard reads — the ones the background keeps in sync. */
export async function dashboardSapoContexts(): Promise<ConnectionContext[]> {
  const rows = await db.select().from(connections).where(eq(connections.pluginId, 'sapo'))
  const byProject = new Map<string, ConnectionRow[]>()
  for (const row of rows) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row])
  const out: ConnectionContext[] = []
  for (const own of byProject.values()) {
    const row = pick(own, 'sapo')
    if (!row || row.status !== 'connected') continue
    try {
      out.push(contextOf(row))
    } catch {
      /* credentials no longer readable: the dashboard shows why when opened */
    }
  }
  return out
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function failedGmv(error: unknown): GmvMaxOverview {
  return {
    currency: 'VND',
    totals: { cost: 0, revenue: 0, orders: 0 },
    previous: null,
    byTime: [],
    previousByTime: [],
    byStore: [],
    dataThrough: null,
    hours: { values: [], totals: [], counts: [], currentHour: null },
    products: { items: [], hourly: false, total: 0, failures: [] },
    scope: { selected: 0, total: 0 },
    fetchedAt: new Date().toISOString(),
    failures: [{ source: 'TikTok', message: message(error) }],
  }
}

function failedSapo(error: unknown): SapoOverview {
  return {
    currency: 'VND',
    totals: {
      created: 0,
      cancelled: 0,
      gmv: 0,
      net: 0,
      sales: { orders: 0, lines: 0, discounts: 0, returns: 0, netRevenue: 0, shipping: 0, tax: 0, revenue: 0 },
    },
    previous: null,
    byTime: [],
    previousByTime: [],
    pendingDays: 0,
    sync: { current: 0, previous: 0, total: 0, returns: 0, catchingUp: false },
    scope: { channels: null },
    fetchedAt: null,
    hours: { profile: [], revenue: [], currentHour: null },
    products: { items: [], since: Date.now(), pendingDays: 0, adminUrl: '', until: null },
    failures: [{ source: 'Sapo', message: message(error) }],
  }
}

function failedShop(error: unknown): TiktokShopOverview {
  return {
    totals: { orders: 0, cancelled: 0, gmv: 0, net: 0 },
    previous: null,
    byTime: [],
    hours: { values: [], totals: [], counts: [], currentHour: null },
    productCount: 0,
    products: [],
    pendingDays: 0,
    fetchedAt: new Date().toISOString(),
    failures: [{ source: 'TikTok Shop', message: message(error) }],
  }
}

/** A connection the project has left off its overview reads as none there (selection.ts, `hidden`). */
const shown = (row: ConnectionRow | undefined) => (row && !selectionOf(row.metadata).hidden ? row : undefined)

/** The overview's plugins whose source the project has hidden — the page leaves them out as if not connected. */
export async function hiddenDashboardPlugins(projectId: string): Promise<string[]> {
  const all = await projectConnections(projectId)
  return Object.values(all).flatMap((row) => (row && selectionOf(row.metadata).hidden ? [row.pluginId] : []))
}

/**
 * How long a reply waits for the per-product report. It is the slowest read
 * (every product by every hour, page after page) and the least urgent: past
 * this, the page gets everything else now and the products on a later
 * refresh — the read carries on meanwhile, held by its memo.
 */
const PRODUCTS_BUDGET_MS = 8_000

/** The promise's value if it settles within `ms`, else `fallback` — the promise runs on regardless. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/**
 * The product reads under way, by what they read, and when each began: the
 * budget is the read's, not each request's. A page asking every few seconds
 * while one long read runs then gets its answer at once, the products still
 * pending, instead of waiting out the whole budget again on every ask.
 */
const productReads = ((globalThis as unknown as { __adshubProductReads?: Map<string, { promise: Promise<GmvMaxOverview['products']>; began: number }> }).__adshubProductReads ??= new Map())

function productsWithin(context: ConnectionContext, period: Period): Promise<GmvMaxOverview['products']> {
  const key = `${context.connectionId}:${JSON.stringify(context.metadata.dashboard ?? null)}:${period.start}:${period.end}`
  let read = productReads.get(key)
  if (!read) {
    const promise = gmvProductHours(context, period.start, period.end).catch(
      (error): GmvMaxOverview['products'] => ({ items: [], hourly: false, total: 0, failures: [{ source: 'TikTok', message: message(error) }] }),
    )
    const began = Date.now()
    read = { promise, began }
    productReads.set(key, read)
    void promise.finally(() => {
      if (productReads.get(key)?.promise === promise) productReads.delete(key)
      const took = Date.now() - began
      if (took > 30_000) warnThrottled(`gmv-products:${context.connectionId}`, `[gmv] product report took ${Math.round(took / 1000)} s`)
    })
  }
  const left = Math.max(0, read.began + PRODUCTS_BUDGET_MS - Date.now())
  return within(read.promise, left, { items: [], hourly: false, total: 0, failures: [], pending: true })
}

export async function dashboardData(projectId: string, period: Period): Promise<DashboardData> {
  const all = await projectConnections(projectId)
  const tiktok = shown(all.tiktok)
  const tiktokShop = shown(all.tiktokShop)
  const sapo = shown(all.sapo)

  const [gmvMax, products, sapoData, shopData] = await Promise.all([
    tiktok ? gmvMaxOverview(contextOf(tiktok), period).catch(failedGmv) : Promise.resolve(null),
    // Per product, read beside the totals: a slow product report never holds the headline up.
    tiktok ? productsWithin(contextOf(tiktok), period) : Promise.resolve(null),
    sapo ? sapoOverview(contextOf(sapo), period).catch(failedSapo) : Promise.resolve(null),
    // Its token renews itself: the context is taken fresh (fresh-credentials.ts).
    tiktokShop
      ? freshContext(tiktokShop)
          .then((context) => tiktokShopOverview(context, period))
          .catch(failedShop)
      : Promise.resolve(null),
  ])
  if (gmvMax && products) gmvMax.products = products
  // A GMV Max product still showing its id takes its name from the TikTok Shop's orders — the same product id on both.
  if (gmvMax && shopData) {
    const shopNames = new Map(shopData.products.map((p) => [p.id, p.name]))
    for (const item of gmvMax.products.items) if (item.name === item.id && shopNames.has(item.id)) item.name = shopNames.get(item.id)!
  }

  // The amounts an Administrator set for the project are folded in last, as if read with the rest.
  return withAdjustments(projectId, period, {
    range: period.range,
    period: { start: period.start, end: period.end, days: period.days },
    generatedAt: new Date().toISOString(),
    gmvMax,
    tiktokShop: shopData,
    sapo: sapoData,
  })
}

/** The Sapo catalog for the quiet-products list's "all products" view; null without a Sapo connection. */
export async function dashboardCatalog(projectId: string): Promise<SapoCatalog | null> {
  const { sapo } = await projectConnections(projectId)
  return sapo ? sapoCatalog(contextOf(sapo)) : null
}

/** What can be chosen for the dashboard, and what is chosen now. */
export async function dashboardSources(projectId: string): Promise<DashboardSources> {
  const { tiktok, tiktokShop, sapo } = await projectConnections(projectId)
  const described = (row: ConnectionRow) => ({
    connectionId: row.id,
    connectionName: row.name,
    status: row.status,
    hidden: selectionOf(row.metadata).hidden,
  })

  const tiktokPart = async (row: ConnectionRow): Promise<NonNullable<DashboardSources['tiktok']>> => {
    const context = contextOf(row)
    const base = {
      ...described(row),
      selected: selectionOf(context.metadata).gmvStores,
    }
    try {
      const { pairs, failures } = await listGmvPairs(context)
      const withShops = new Set(pairs.map((p) => p.advertiserId)).size
      return {
        ...base,
        shops: pairs.map((p) => ({ key: pairKey(p.advertiserId, p.storeId), ...p })),
        accountsWithoutShops: Math.max(0, advertisersOf(context.metadata).length - withShops),
        failures,
      }
    } catch (error) {
      return { ...base, shops: [], accountsWithoutShops: 0, failures: [{ source: 'TikTok', message: message(error) }] }
    }
  }

  const [tiktokSources, sapoSources] = await Promise.all([
    tiktok ? tiktokPart(tiktok) : Promise.resolve(null),
    sapo
      ? listSapoChannels(contextOf(sapo)).then((channels) => ({
          ...described(sapo),
          channels,
          selected: selectionOf(sapo.metadata).sapoChannels,
        }))
      : Promise.resolve(null),
  ])

  return { tiktok: tiktokSources, tiktokShop: tiktokShop ? shopPart(tiktokShop) : null, sapo: sapoSources }

  /** The shops the TikTok Shop app is authorised for (found by the connection test), and the one it reads. */
  function shopPart(row: ConnectionRow): NonNullable<DashboardSources['tiktokShop']> {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>
    const shops = (Array.isArray(metadata.shops) ? (metadata.shops as Array<Record<string, unknown>>) : [])
      .map((shop) => ({ cipher: String(shop.cipher ?? ''), name: String(shop.name ?? shop.id ?? ''), region: String(shop.region ?? '') }))
      .filter((shop) => shop.cipher)
    let selected: string | null = typeof metadata.shopCipher === 'string' ? metadata.shopCipher : null
    try {
      // A cipher typed into the connection's form wins over the one the test chose (plugins/tiktok-shop, shopCipherOf).
      selected = contextOf(row).credentials.shopCipher || selected
    } catch {
      /* credentials unreadable: the connection page says why */
    }
    return { ...described(row), shops, selected }
  }
}
