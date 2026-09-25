import type { DashboardData, Failure } from './data/types'
import type { OverviewSource } from './types'

/**
 * The sources the overview reads, each fed by a connector plugin. A widget
 * names the sources it needs (see OverviewWidget); the page shows it only
 * while they are connected, and lists each source's state behind the "live"
 * badge. Adding a source is one entry here, plus its part of the server's
 * answer (see data/overview.ts).
 */

/** Something to say, as a message key of the "dashboard" messages and its values. */
export type SourceText = { message: string; values?: Record<string, string | number> }

export interface OverviewSourceSpec {
  id: OverviewSource
  /** As people know it. */
  name: string
  /** The connector plugin that feeds it. */
  pluginId: string
  /** Its part of the answer; null when the server has none for it. */
  slice: (data: DashboardData) => { failures: Failure[] } | null
  /** Whether all is well with it, and how fresh it is — before the first answer too. */
  status: (data: DashboardData | null, isToday: boolean) => SourceText & { ok: boolean }
  /** What part of it the numbers cover, when not all of it. */
  scope: (data: DashboardData) => SourceText | null
}

/** A source that failed says so, rather than the healthy line it would otherwise show over figures of zero. */
const failed = (slice: { failures: Failure[] } | null) => {
  if (!slice || slice.failures.length === 0) return null
  const reason = slice.failures[0].message
  // TikTok's rate limit is a wait, not a fault: say so in words, not its code.
  if (/4013[23]|40100|too many requests/i.test(reason)) return { ok: false, message: 'sourceThrottled' }
  return { ok: false, message: 'sourceFailed', values: { reason: reason.slice(0, 120) } }
}

export const OVERVIEW_SOURCES: OverviewSourceSpec[] = [
  {
    id: 'tiktok',
    name: 'TikTok GMV Max',
    pluginId: 'tiktok-ads',
    // The per-product report is read apart (overview.ts); its failures count for the source too.
    slice: (data) => (data.gmvMax ? { failures: [...data.gmvMax.failures, ...data.gmvMax.products.failures] } : null),
    status: (data, isToday) => {
      const gmv = data?.gmvMax ?? null
      const broken = failed(gmv ? { failures: [...gmv.failures, ...gmv.products.failures] } : null)
      if (broken) return broken
      const through = isToday && gmv?.dataThrough ? gmv.dataThrough.slice(11, 16) : null
      return {
        ok: (gmv?.failures.length ?? 0) === 0,
        ...(through ? { message: 'tiktokThrough', values: { time: through } } : { message: 'tiktokLag' }),
      }
    },
    scope: (data) =>
      data.gmvMax && data.gmvMax.scope.selected < data.gmvMax.scope.total
        ? { message: 'scopeShops', values: { selected: data.gmvMax.scope.selected, total: data.gmvMax.scope.total } }
        : null,
  },
  {
    id: 'tiktokShop',
    name: 'TikTok Shop',
    pluginId: 'tiktok-shop',
    slice: (data) => data.tiktokShop,
    status: (data) => {
      const shop = data?.tiktokShop ?? null
      const broken = failed(shop)
      if (broken) return broken
      const pending = shop?.pendingDays ?? 0
      return {
        ok: (shop?.failures.length ?? 0) === 0 && pending === 0,
        ...(pending > 0 ? { message: 'syncing', values: { count: pending } } : { message: 'shopSynced' }),
      }
    },
    scope: () => null,
  },
  {
    id: 'sapo',
    name: 'Sapo',
    pluginId: 'sapo',
    slice: (data) => data.sapo,
    status: (data) => {
      const sapo = data?.sapo ?? null
      const broken = failed(sapo)
      if (broken) return broken
      const pending = sapo?.pendingDays ?? 0
      return {
        ok: (sapo?.failures.length ?? 0) === 0 && pending === 0,
        ...(pending > 0 ? { message: 'syncing', values: { count: pending } } : { message: 'sapoSynced' }),
      }
    },
    scope: (data) =>
      data.sapo?.scope.channels ? { message: 'scopeChannels', values: { count: data.sapo.scope.channels.length } } : null,
  },
]
