import type { ReportWidget } from '@/modules/analytics/types'
import { videoGmvHeadlineWidget } from './headline'
import { videoGmvProductsWidget } from './products'
import { videoGmvRelationWidget } from './relation'
import { videoGmvSheetWidget } from './sheet'
import { videoGmvTrendWidget } from './trend'

/** Every widget of the video & product GMV report. To add one: a folder here with its component and definition, listed below. */
export const VIDEO_GMV_WIDGETS: ReportWidget[] = [
  videoGmvSheetWidget,
  videoGmvHeadlineWidget,
  videoGmvTrendWidget,
  videoGmvRelationWidget,
  videoGmvProductsWidget,
]
