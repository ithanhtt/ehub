import type { ComponentType } from 'react'
import type { ReportPeriod } from './period'

/**
 * The frame the four report modules share (booking & video, video & product
 * GMV, cost & ROI, orders & cancellations). Each is a page of widgets over one
 * server answer, like the overview — but over days and months rather than live
 * hours, and drawing on up to four sources joined by product, KOC and video.
 *
 * A module owns its answer's shape (its `types.ts`), how the server builds it
 * (its `report.ts`) and its widgets; this folder owns what they have in
 * common: the period, the sources and their state, the page frame, and the
 * readers each source's data comes through (data/).
 */

/** The data sources, each fed by a connector plugin. */
export type ReportSource = 'booking' | 'tiktokShop' | 'tiktokAds' | 'sapo'

export const REPORT_SOURCES: readonly ReportSource[] = ['booking', 'tiktokShop', 'tiktokAds', 'sapo']

/**
 * The connector plugin behind each source. The booking file is kept in the
 * app itself (src/modules/bookings), so it has no plugin and is always there.
 */
export const SOURCE_PLUGIN: Record<Exclude<ReportSource, 'booking'>, string> = {
  tiktokShop: 'tiktok-shop',
  tiktokAds: 'tiktok-ads',
  sapo: 'sapo',
}

/** Whether a source is on for a project, given the plugins it has connections for. */
export const sourceOn = (source: ReportSource, connectedPlugins: readonly string[]) =>
  source === 'booking' || connectedPlugins.includes(SOURCE_PLUGIN[source])

export type Failure = { source: string; message: string }

/** How one source stands for this answer. */
export interface SourceState {
  /** The project has a connection for it. */
  connected: boolean
  /** Read without trouble. */
  ok: boolean
  /** Days of the period still being read in the background: figures are short until they land. */
  pendingDays: number
  /** What was read, in words for the status popover: a message key of the "reports" messages and its values. */
  note?: { key: string; values?: Record<string, string | number> }
}

/** One report module's answer: its period, its sources' state, and its own data. */
export interface ReportEnvelope<T> {
  moduleId: string
  period: Omit<ReportPeriod, 'days'>
  generatedAt: string
  sources: Record<ReportSource, SourceState>
  failures: Failure[]
  data: T
}

/** The page's bands, top to bottom. */
export type ReportBand = 'notice' | 'headline' | 'trend' | 'insight' | 'table'

export type WidgetSize = Partial<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number>>

export interface ReportWidget {
  id: string
  band: ReportBand
  order: number
  /** The sources it needs; left out while any of them is not connected. */
  sources: ReportSource[]
  size: WidgetSize | ((band: { count: number }) => WidgetSize)
  Component: ComponentType
}
