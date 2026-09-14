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

export const OVERVIEW_SOURCES: OverviewSourceSpec[] = [
  {
    id: 'tiktok',
    name: 'TikTok GMV Max',
    pluginId: 'tiktok-ads',
    slice: (data) => data.gmvMax,
    status: (data, isToday) => {
      const gmv = data?.gmvMax ?? null
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
    id: 'sapo',
    name: 'Sapo',
    pluginId: 'sapo',
    slice: (data) => data.sapo,
    status: (data) => {
      const sapo = data?.sapo ?? null
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
