import type { ReportWidget } from '@/modules/analytics/types'
import { costRoiHeadlineWidget } from './headline'
import { costRoiKocWidget } from './koc-costs'
import { costRoiRelationWidget } from './relation'
import { costRoiReviewProductsWidget, costRoiReviewTrendWidget } from './reviews'
import { costRoiTargetsWidget } from './roi-targets'
import { costRoiTrendWidget } from './trend'

/** Every widget of the cost & ROI report. To add one: a folder here with its component and definition, listed below. */
export const COST_ROI_WIDGETS: ReportWidget[] = [
  costRoiHeadlineWidget,
  costRoiTrendWidget,
  costRoiRelationWidget,
  costRoiKocWidget,
  costRoiReviewTrendWidget,
  costRoiReviewProductsWidget,
  costRoiTargetsWidget,
]
