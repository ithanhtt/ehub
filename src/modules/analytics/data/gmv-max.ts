import 'server-only'

import { mkdir, readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@/core/utils/atomic-write'
import path from 'node:path'
import { buildQueryString } from '@/core/plugins/http'
import type { ConnectionContext } from '@/core/plugins/types'
import { BASE_URL, authHeaders } from '@/plugins/tiktok-ads/context'
import { sendPatiently } from '@/plugins/tiktok-ads/gmv-max'
import { memo } from '@/modules/overview/data/cache'
import { listGmvPairs, type GmvPair } from '@/modules/overview/data/gmv-max'
import { pairKey, selectionOf } from '@/modules/overview/data/selection'
import { daysBetween, shiftDay, vnDate } from '../period'
import type { Failure } from '../types'

/**
 * GMV Max (TikTok Ads) below the shop: spend, revenue and orders per product
 * per day, per video per day, and the ROI target each campaign runs at — for
 * the shops the project counts (the overview's shop choice).
 *
 * TikTok's reporting levels (GMV Max report doc) decide the shape of the
 * reads: a product breakdown needs the campaigns named (`campaign_ids`), a
 * video breakdown the campaign and its products (`item_group_ids`, at most 100
 * a call). A daily report spans at most 30 days, so reads go in fixed 30-day
 * windows — fixed, so any period reuses the windows another period read — and
 * a window is kept for hours once it is past, for minutes while it reaches
 * today (spend lags up to 11 hours, so the last days keep moving).
 *
 * `item_group_id` is TikTok's product (SPU) id: the TikTok Shop product id.
 *
 * ROI targets have no history in the API — only the value now. Each read
 * files today's targets on disk, so the relation between a target and what it
 * delivered builds up day by day from the first read on.
 */

const PAGE_SIZE = 1000
const WINDOW_DAYS = 30
const EPOCH = '2024-01-01'
const CAMPAIGN_TTL = 30 * 60_000
const CAMPAIGN_STALE = 6 * 3600_000
const PAST_TTL = 6 * 3600_000
const RECENT_TTL = 15 * 60_000
/**
 * How long past its TTL a window's report is still served while a fresh read
 * runs behind it (cache.ts): a report page never waits on a re-read of weeks
 * it already has; the figures catch up on its next refresh.
 */
const WINDOW_STALE = 6 * 3600_000
const CONCURRENCY = 3
const METRICS = ['cost', 'gross_revenue', 'orders']

type Row = { dimensions?: Record<string, string>; metrics?: Record<string, string | number> }
type Envelope = { code?: number; message?: string; data?: Record<string, unknown> }

export type Figures = { cost: number; revenue: number; orders: number }
const zero = (): Figures => ({ cost: 0, revenue: 0, orders: 0 })
function addRow(target: Figures, row: Row) {
  target.cost += Number(row.metrics?.cost ?? 0) || 0
  target.revenue += Number(row.metrics?.gross_revenue ?? 0) || 0
  target.orders += Number(row.metrics?.orders ?? 0) || 0
}

async function get(context: ConnectionContext, apiPath: string, params: Record<string, unknown>) {
  const response = await sendPatiently({ url: `${BASE_URL}${apiPath}${buildQueryString(params)}`, method: 'GET', headers: authHeaders(context) })
  const body = response.data as Envelope | null
  if (!response.ok || !body || body.code !== 0) {
    throw new Error(body?.message ? `TikTok ${body.code}: ${body.message}` : (response.error ?? 'TikTok request failed'))
  }
  return body.data ?? {}
}

async function pool<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await run(items[i])
      }
    }),
  )
  return out
}

const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

/**
 * One shop's GMV Max report. TikTok answers a report split by hour for one
 * day at most ("max time span is 1 day when use 'stat_time_hour'"), so such a
 * report over several days is asked for day by day, in order, each day
 * memoised on its own — views over overlapping ranges share the days they
 * have in common, and a settled day is not asked for again for hours.
 */
async function report(context: ConnectionContext, pair: GmvPair, params: Record<string, unknown>): Promise<Row[]> {
  const start = String(params.start_date ?? '')
  const end = String(params.end_date ?? '')
  const byHour = Array.isArray(params.dimensions) && params.dimensions.includes('stat_time_hour')
  if (byHour && start && end && start < end) {
    const today = vnDate(new Date())
    const rows: Row[] = []
    for (const day of daysBetween(start, end)) {
      const ttl = day >= today ? LIVE_TTL : day >= shiftDay(today, -3) ? RECENT_TTL : PAST_TTL
      const one = { ...params, start_date: day, end_date: day }
      rows.push(
        ...(await memo(`gmv-report-day:${context.connectionId}:${pair.advertiserId}:${pair.storeId}:${JSON.stringify(one)}`, ttl, () => report(context, pair, one), {
          staleMs: ttl,
        })),
      )
    }
    return rows
  }
  const rows: Row[] = []
  for (let page = 1; ; page++) {
    const data = await get(context, '/gmv_max/report/get/', {
      advertiser_id: pair.advertiserId,
      store_ids: [pair.storeId],
      metrics: METRICS,
      page,
      page_size: PAGE_SIZE,
      ...params,
    })
    rows.push(...(Array.isArray(data.list) ? (data.list as Row[]) : []))
    if (page >= Number((data.page_info as { total_page?: number } | undefined)?.total_page ?? 1)) return rows
  }
}

/** The shops the project counts. */
async function chosenPairs(context: ConnectionContext) {
  const selected = selectionOf(context.metadata).gmvStores
  const { pairs, failures } = await listGmvPairs(context)
  // A copy: callers add their own failures to it, and the list itself is memoised (listGmvPairs).
  return { pairs: selected ? pairs.filter((p) => selected.includes(pairKey(p.advertiserId, p.storeId))) : pairs, failures: [...failures] }
}

/* ------------------------------------------------------------ campaigns --- */

export type Campaign = {
  campaignId: string
  name: string
  advertiserId: string
  storeId: string
  /** The ROI target (roas_bid), null when the campaign bids without one. */
  roasBid: number | null
  /** The products it promotes; null for "all products" of the shop. */
  items: string[] | null
  /** The campaign's detail was read: its target and products are known, not just missing. */
  known: boolean
}

function productCampaigns(context: ConnectionContext, pair: GmvPair): Promise<Campaign[]> {
  return memo(`gmv-campaigns:${context.connectionId}:${pair.advertiserId}:${pair.storeId}`, CAMPAIGN_TTL, async () => {
    const listed: Array<Record<string, unknown>> = []
    for (let page = 1; ; page++) {
      const data = await get(context, '/gmv_max/campaign/get/', {
        advertiser_id: pair.advertiserId,
        filtering: { gmv_max_promotion_types: ['PRODUCT_GMV_MAX'], store_ids: [pair.storeId] },
        page,
        page_size: 100,
      })
      listed.push(...(Array.isArray(data.list) ? (data.list as Array<Record<string, unknown>>) : []))
      if (page >= Number((data.page_info as { total_page?: number } | undefined)?.total_page ?? 1)) break
    }
    return pool(listed, async (row) => {
      const campaignId = String(row.campaign_id ?? '')
      const info = await get(context, '/campaign/gmv_max/info/', { advertiser_id: pair.advertiserId, campaign_id: campaignId }).catch(() => null)
      const bid = Number(info?.roas_bid)
      if (!info) {
        return { campaignId, name: String(row.campaign_name ?? campaignId), advertiserId: pair.advertiserId, storeId: pair.storeId, roasBid: null, items: null, known: false }
      }
      return {
        known: true,
        campaignId,
        name: String(row.campaign_name ?? campaignId),
        advertiserId: pair.advertiserId,
        storeId: pair.storeId,
        roasBid: Number.isFinite(bid) && bid > 0 ? bid : null,
        items: info.product_specific_type === 'CUSTOMIZED_PRODUCTS' && Array.isArray(info.item_group_ids) ? info.item_group_ids.map(String) : null,
      }
    })
    // Campaigns and their targets change rarely: past the TTL the last list is served while a fresh one is read.
  }, { staleMs: CAMPAIGN_STALE })
}

/* --------------------------------------------------------------- windows --- */

/** The fixed 30-day windows covering `start`…`end`, each clipped to today. */
export function windowsOf(start: string, end: string, today: string): Array<{ from: string; to: string }> {
  // Days since EPOCH (EPOCH itself is 0), so window k is days 30k … 30k + 29.
  const index = (day: string) => Math.floor(Math.max(0, daysBetween(EPOCH, day).length - 1) / WINDOW_DAYS)
  const out: Array<{ from: string; to: string }> = []
  for (let k = index(start); k <= index(end); k++) {
    const from = shiftDay(EPOCH, k * WINDOW_DAYS)
    if (from > today) break
    const last = shiftDay(from, WINDOW_DAYS - 1)
    out.push({ from, to: last < today ? last : today })
  }
  return out
}

const ttlFor = (to: string, today: string) => (to >= shiftDay(today, -2) ? RECENT_TTL : PAST_TTL)

export type ProductDays = Record<string, Record<string, Figures & { byCampaign: Record<string, Figures> }>>

/** Per day, per product: spend, revenue, orders — and their split by campaign (what ROI targets are matched against). */
export async function gmvProductDays(
  context: ConnectionContext,
  start: string,
  end: string,
): Promise<{ days: ProductDays; campaigns: Campaign[]; failures: Failure[]; failedDays: Set<string> }> {
  const today = vnDate(new Date())
  const { pairs, failures } = await chosenPairs(context)
  const days: ProductDays = {}
  const campaigns: Campaign[] = []
  // Days some shop could not be read for: a gap on the page, never a zero.
  const failedDays = new Set<string>()
  const markFailed = (from: string, to: string) => {
    for (const day of daysBetween(from < start ? start : from, to > end ? end : to)) failedDays.add(day)
  }

  await pool(pairs, async (pair) => {
    let own: Campaign[]
    try {
      own = await productCampaigns(context, pair)
    } catch (error) {
      failures.push({ source: pair.storeName, message: error instanceof Error ? error.message : String(error) })
      markFailed(start, end)
      return
    }
    campaigns.push(...own)
    if (own.length === 0) return
    for (const window of windowsOf(start, end, today)) {
      try {
        const rows = await memo(
          `gmv-product-days:${context.connectionId}:${pair.advertiserId}:${pair.storeId}:${window.from}:${window.to}`,
          ttlFor(window.to, today),
          async () => {
            const all: Row[] = []
            for (const ids of chunks(own.map((c) => c.campaignId), 100)) {
              all.push(
                ...(await report(context, pair, {
                  start_date: window.from,
                  end_date: window.to,
                  dimensions: ['campaign_id', 'item_group_id', 'stat_time_day'],
                  filtering: { campaign_ids: ids },
                })),
              )
            }
            return all
          },
          { staleMs: WINDOW_STALE },
        )
        for (const row of rows) {
          const day = String(row.dimensions?.stat_time_day ?? '').slice(0, 10)
          if (day < start || day > end) continue
          const item = String(row.dimensions?.item_group_id ?? '')
          const campaign = String(row.dimensions?.campaign_id ?? '')
          if (!item) continue
          const cell = ((days[day] ??= {})[item] ??= { ...zero(), byCampaign: {} })
          addRow(cell, row)
          addRow((cell.byCampaign[campaign] ??= zero()), row)
        }
      } catch (error) {
        failures.push({ source: pair.storeName, message: error instanceof Error ? error.message : String(error) })
        markFailed(window.from, window.to)
      }
    }
  })

  return { days, campaigns, failures, failedDays }
}

export type VideoDays = Record<string, Record<string, Figures & { product: string }>>

/**
 * Per day, per video (item_id): spend, revenue, orders, and the product it
 * promoted — for the products that spent in the period. `item_id` −1 is a
 * product card, not a video, and is left out.
 */
export async function gmvVideoDays(
  context: ConnectionContext,
  start: string,
  end: string,
  productDays: ProductDays,
  campaigns: Campaign[],
): Promise<{ days: VideoDays; failures: Failure[] }> {
  const today = vnDate(new Date())
  const failures: Failure[] = []
  const days: VideoDays = {}
  const { pairs } = await chosenPairs(context)

  /*
   * The products each campaign spent on, window by window. Each window asks
   * for its own products only: a product that starts spending today changes
   * the recent window's request, not those of the weeks before — whose reads
   * (memoised by what they ask for) are then kept, instead of every window
   * being read again whenever one new product appears.
   */
  const windows = windowsOf(start, end, today)
  const spent = new Map<string, Set<string>>()
  for (const [day, products] of Object.entries(productDays)) {
    const window = windows.findIndex((w) => day >= w.from && day <= w.to)
    if (window < 0) continue
    for (const [item, figures] of Object.entries(products)) {
      for (const [campaign, own] of Object.entries(figures.byCampaign)) {
        if (own.cost <= 0) continue
        const key = `${campaign}|${window}`
        ;(spent.get(key) ?? spent.set(key, new Set()).get(key)!).add(item)
      }
    }
  }

  const jobs = campaigns.flatMap((campaign) => {
    const pair = pairs.find((p) => p.advertiserId === campaign.advertiserId && p.storeId === campaign.storeId)
    if (!pair) return []
    return windows.flatMap((window, i) => {
      // With the window before's: revenue landing just after a boundary, on a product whose spend was just before it, still counts.
      const items = [...new Set([...(spent.get(`${campaign.campaignId}|${i}`) ?? []), ...(spent.get(`${campaign.campaignId}|${i - 1}`) ?? [])])].sort()
      return chunks(items, 100).map((ids) => ({ pair, campaign, ids, window }))
    })
  })

  await pool(jobs, async ({ pair, campaign, ids, window }) => {
    {
      try {
        const rows = await memo(
          `gmv-video-days:${context.connectionId}:${campaign.campaignId}:${ids.join(',')}:${window.from}:${window.to}`,
          ttlFor(window.to, today),
          () =>
            report(context, pair, {
              start_date: window.from,
              end_date: window.to,
              dimensions: ['campaign_id', 'item_group_id', 'item_id', 'stat_time_day'],
              filtering: { campaign_ids: [campaign.campaignId], item_group_ids: ids },
            }),
          { staleMs: WINDOW_STALE },
        )
        for (const row of rows) {
          const day = String(row.dimensions?.stat_time_day ?? '').slice(0, 10)
          const video = String(row.dimensions?.item_id ?? '')
          if (day < start || day > end || !video || video === '-1') continue
          const cell = ((days[day] ??= {})[video] ??= { ...zero(), product: String(row.dimensions?.item_group_id ?? '') })
          addRow(cell, row)
        }
      } catch (error) {
        failures.push({ source: campaign.name, message: error instanceof Error ? error.message : String(error) })
      }
    }
  })

  return { days, failures }
}

/* ---------------------------------------------------------- ROI targets --- */

/** Files today's ROI targets for the shops the project counts — the background round, so days nobody opens the report still count. */
export async function fileTodayTargets(context: ConnectionContext): Promise<void> {
  const { pairs } = await chosenPairs(context)
  const campaigns = (await pool(pairs, (pair) => productCampaigns(context, pair).catch(() => [] as Campaign[]))).flat()
  await roiTargetHistory(context, campaigns)
}

type TargetFile = { version: 1; days: Record<string, Record<string, { roasBid: number | null; items: string[] | null }>> }

const CACHE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'cache')
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const targetFiles = ((globalThis as unknown as { __adshubGmvTargets?: Map<string, Promise<TargetFile>> }).__adshubGmvTargets ??= new Map())
const targetWrites = new Map<string, Promise<void>>()

function targetFile(connectionId: string) {
  if (!SAFE_ID.test(connectionId)) throw new Error('Unexpected connection id')
  return path.join(CACHE_DIR, `gmv-targets-${connectionId}.json`)
}

/**
 * The ROI target each campaign ran at, per day seen — today's filed from
 * `campaigns` as they are now, earlier days as they were filed then.
 */
export async function roiTargetHistory(context: ConnectionContext, campaigns: Campaign[]): Promise<TargetFile['days']> {
  const file = targetFile(context.connectionId)
  let loading = targetFiles.get(context.connectionId)
  if (!loading) {
    loading = readFile(file, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text) as TargetFile
        return parsed.version === 1 && parsed.days ? parsed : { version: 1 as const, days: {} }
      })
      .catch(() => ({ version: 1 as const, days: {} }))
    targetFiles.set(context.connectionId, loading)
  }
  const state = await loading
  const today = vnDate(new Date())
  // Merged into what today already holds: a shop or a campaign that failed to read this time keeps what was filed.
  const merged = { ...(state.days[today] ?? {}) }
  for (const campaign of campaigns) if (campaign.known) merged[campaign.campaignId] = { roasBid: campaign.roasBid, items: campaign.items }
  const snapshot = Object.fromEntries(Object.keys(merged).sort().map((id) => [id, merged[id]]))
  if (Object.keys(snapshot).length > 0 && JSON.stringify(state.days[today]) !== JSON.stringify(snapshot)) {
    state.days[today] = snapshot
    const oldest = shiftDay(today, -400)
    for (const day of Object.keys(state.days)) if (day < oldest) delete state.days[day]
    // One write at a time: two at once would race on the temporary file.
    const previous = targetWrites.get(context.connectionId) ?? Promise.resolve()
    const writing = previous.then(async () => {
      await mkdir(CACHE_DIR, { recursive: true })
      await writeFileAtomic(file, JSON.stringify(state))
    })
    targetWrites.set(context.connectionId, writing.catch(() => {}))
    await writing.catch(() => {})
  }
  return state.days
}

/* --------------------------------------------------------- product names --- */

const NAME_TTL = 6 * 3600_000

/**
 * Product titles from the shop's product list (/store/product/get/), asked
 * through the Business Center the shop is authorised to, ten ids at a time
 * (the most the filter takes). Each batch is kept for hours: titles rarely
 * change. A batch that cannot be read is skipped — the product shows its id.
 */
async function shopProductNames(context: ConnectionContext, pair: GmvPair, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!pair.bcId || ids.length === 0) return out
  for (const batch of chunks([...ids].sort(), 10)) {
    const found = await memo(`gmv-product-names:${context.connectionId}:${pair.storeId}:${batch.join(',')}`, NAME_TTL, async () => {
      const data = await get(context, '/store/product/get/', {
        bc_id: pair.bcId,
        store_id: pair.storeId,
        filtering: { item_group_ids: batch },
        page: 1,
        page_size: 100,
      })
      const products = Array.isArray(data.store_products) ? (data.store_products as Array<Record<string, unknown>>) : []
      return products.map((product) => [String(product.item_group_id ?? ''), String(product.title ?? product.product_name ?? '')] as const)
    }).catch(() => [] as ReadonlyArray<readonly [string, string]>)
    for (const [id, name] of found) if (id && name) out.set(id, name)
  }
  return out
}

/* --------------------------------------------------- products by hour --- */

export type ProductHours = {
  items: Array<{ id: string; name: string; totals: Figures; hours: Figures[] | null }>
  /** TikTok broke the products down by hour; else only their totals are known. */
  hourly: boolean
  /** Products that spent — `items` holds the top ones only. */
  total: number
  failures: Failure[]
}

const LIVE_TTL = 5 * 60_000
/** The products shown: the ones spending most. */
const PRODUCT_LIMIT = 60

/**
 * GMV Max per product over `start`…`end`, summed by hour of the day (Vietnam
 * time) — the table an ads reviewer reads to see which product pays at which
 * hour. Product reports need their campaigns named (as gmvProductDays does).
 *
 * The hour is asked for first. Should TikTok refuse an hourly split by
 * product, the products are read again without it, and `hourly` says so:
 * their totals still stand, the hours are left empty rather than guessed.
 * Names come from the product-level `product_name` attribute; a product whose
 * name cannot be read shows its id.
 */
/**
 * Pairs whose hourly split by product TikTok refused, and until when that is
 * taken as its answer: asking again on every refresh only to fall back each
 * time doubles the reads.
 */
const hourlyRefused = ((globalThis as unknown as { __adshubGmvHourlyRefused?: Map<string, number> }).__adshubGmvHourlyRefused ??= new Map())
const REFUSED_MS = 6 * 3600_000
/** How long a product report past its TTL is still shown while a fresh one runs behind it. */
const PRODUCT_STALE = 30 * 60_000

export async function gmvProductHours(context: ConnectionContext, start: string, end: string): Promise<ProductHours> {
  const today = vnDate(new Date())
  // A range reaching today moves by the minute; one ending in the last few days still settles (TikTok keeps
  // attributing orders, as the overview's day store assumes); an older one is read again only for hours.
  const ttl = end >= today ? LIVE_TTL : end >= shiftDay(today, -3) ? RECENT_TTL : PAST_TTL
  // A settled range is served as it was, at once, while it is read again: it can hardly have changed.
  const staleMs = ttl === PAST_TTL ? PAST_TTL : PRODUCT_STALE
  const { pairs, failures } = await chosenPairs(context)
  const items = new Map<string, { id: string; name: string; totals: Figures; hours: Figures[] }>()
  let hourly = true

  const itemOf = (id: string) => {
    let own = items.get(id)
    if (!own) items.set(id, (own = { id, name: '', totals: zero(), hours: Array.from({ length: 24 }, zero) }))
    return own
  }

  await pool(pairs, async (pair) => {
    let own: Campaign[]
    try {
      own = await productCampaigns(context, pair)
    } catch (error) {
      failures.push({ source: pair.storeName, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if (own.length === 0) return
    const batches = chunks(own.map((c) => c.campaignId), 100)
    const read = (dimensions: string[], metrics = METRICS) =>
      memo(`gmv-product-hours:${context.connectionId}:${pair.advertiserId}:${pair.storeId}:${start}:${end}:${dimensions.join(',')}:${metrics.join(',')}`, ttl, async () => {
        const all: Row[] = []
        for (const ids of batches) {
          all.push(...(await report(context, pair, { start_date: start, end_date: end, dimensions, metrics, filtering: { campaign_ids: ids } })))
        }
        return all
      }, { staleMs })

    try {
      let rows: Row[]
      const refusedKey = `${context.connectionId}:${pair.advertiserId}:${pair.storeId}`
      const refused = (hourlyRefused.get(refusedKey) ?? 0) > Date.now()
      try {
        if (refused) throw new Error('hourly refused')
        rows = await read(['campaign_id', 'item_group_id', 'stat_time_hour'])
      } catch (error) {
        // A refusal is remembered; a busy or slow TikTok is not one, and the next refresh asks again.
        const reason = error instanceof Error ? error.message : String(error)
        if (!refused && !/(40100|40132|40133|50000|50002|51305)|timed out|fetch failed/i.test(reason)) hourlyRefused.set(refusedKey, Date.now() + REFUSED_MS)
        hourly = false
        rows = await read(['campaign_id', 'item_group_id'])
      }
      for (const row of rows) {
        const id = String(row.dimensions?.item_group_id ?? '')
        if (!id) continue
        const item = itemOf(id)
        addRow(item.totals, row)
        const at = String(row.dimensions?.stat_time_hour ?? '')
        if (at) addRow(item.hours[Number(at.slice(11, 13))], row)
      }
    } catch (error) {
      failures.push({ source: pair.storeName, message: error instanceof Error ? error.message : String(error) })
      return
    }

    // Names: first the product level's own attribute; what it leaves out, from the shop's product list.
    const names = await read(['campaign_id', 'item_group_id'], ['product_name']).catch(() => [] as Row[])
    for (const row of names) {
      const id = String(row.dimensions?.item_group_id ?? '')
      const name = String(row.metrics?.product_name ?? '')
      if (id && name && items.has(id)) items.get(id)!.name = name
    }
    const unnamed = [...items.values()].filter((item) => !item.name).map((item) => item.id)
    for (const [id, name] of await shopProductNames(context, pair, unnamed)) if (items.has(id)) items.get(id)!.name = name
  })

  const active = [...items.values()].filter((item) => item.totals.cost > 0 || item.totals.revenue > 0)
  return {
    total: active.length,
    items: active
      .sort((a, b) => b.totals.cost - a.totals.cost)
      .slice(0, PRODUCT_LIMIT)
      .map((item) => ({ ...item, name: item.name || item.id, hours: hourly ? item.hours : null })),
    hourly,
    failures,
  }
}
