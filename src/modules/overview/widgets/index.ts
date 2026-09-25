import type { OverviewWidget } from '../types'
import { hourlyPerformanceWidget } from './hourly-performance'
import { productHoursWidget } from './product-hours'
import { scorecardWidget } from './scorecard'
import { sapoSyncWidget } from './sapo-sync'
import { sapoTrendWidget } from './sapo-trend'
import { silentProductsWidget } from './silent-products'
import { tiktokSyncWidget } from './tiktok-sync'
import { tiktokTrendWidget } from './tiktok-trend'
import { topProductsWidget } from './top-products'

/**
 * Every widget the overview can show.
 *
 * To add one: give it a folder here holding its component and its definition
 * (see OverviewWidget — the sources it needs, its band, its order, its width),
 * and list it below. Its band and order place it; nothing else on the page
 * changes. To take one away, drop it from the list.
 */
export const OVERVIEW_WIDGETS: OverviewWidget[] = [
  sapoSyncWidget,
  tiktokSyncWidget,
  scorecardWidget,
  tiktokTrendWidget,
  sapoTrendWidget,
  hourlyPerformanceWidget,
  productHoursWidget,
  topProductsWidget,
  silentProductsWidget,
]
