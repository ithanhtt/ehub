import type { ComponentType } from 'react'
import type { OverviewContextValue } from './context'

/**
 * The overview page is a stack of bands, each a row of widgets (see
 * OverviewDashboard). A widget is self-contained: it says which data sources
 * it needs, where it sits and how wide it is, and draws itself from the
 * page's shared context (useOverview) — nothing passes between widgets, and
 * one that fails is contained without taking the page down with it.
 */

/** The data sources the page reads, each fed by a connector plugin (see sources.ts). */
export type OverviewSource = 'tiktok' | 'sapo'

/** The page's bands, top to bottom: notices, headline numbers, trends, then smaller cards. */
export type WidgetBand = 'notice' | 'headline' | 'trend' | 'insight'

/** A width on the page's 12-column grid, per breakpoint. */
export type WidgetSize = Partial<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number>>

export interface OverviewWidget {
  /** Stable and unique: the widget's key on the page, and the name its failures are reported under. */
  id: string
  band: WidgetBand
  /** Its place within the band, lowest first — spaced (10, 20…) so others can slot in between. */
  order: number
  /** The sources it needs; it is left out while any of them is not connected. */
  sources: OverviewSource[]
  /** Its width — or, told how many widgets share its band, one that fills the row. */
  size: WidgetSize | ((band: { count: number }) => WidgetSize)
  /** Whether it has anything to show right now (a notice, only while there is something to say); shown if left out. */
  when?: (context: OverviewContextValue) => boolean
  Component: ComponentType
}
