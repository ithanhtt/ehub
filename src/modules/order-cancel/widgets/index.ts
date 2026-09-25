import type { ReportWidget } from '@/modules/analytics/types'
import { orderCancelHeadlineWidget } from './headline'
import { orderCancelHoursWidget } from './hours'
import { orderCancelProductsWidget } from './products'
import { orderCancelRelationWidget } from './relation'
import { orderCancelTrendWidget } from './trend'

/**
 * Every widget of the orders & cancellations report. To add one: a folder
 * here with its component and definition (ReportWidget), listed below.
 */
export const ORDER_CANCEL_WIDGETS: ReportWidget[] = [
  orderCancelHeadlineWidget,
  orderCancelTrendWidget,
  orderCancelHoursWidget,
  orderCancelProductsWidget,
  orderCancelRelationWidget,
]
