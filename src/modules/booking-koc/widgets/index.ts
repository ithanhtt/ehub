import type { ReportWidget } from '@/modules/analytics/types'
import { bookingKocHeadlineWidget } from './headline'
import { bookingKocKocsWidget } from './kocs'
import { bookingKocProductsWidget } from './products'
import { bookingKocRelationWidget } from './relation'
import { bookingSheetWidget } from './sheet'
import { bookingKocTrendWidget } from './trend'

/** Every widget of the booking & KOC report. To add one: a folder here with its component and definition, listed below. */
export const BOOKING_KOC_WIDGETS: ReportWidget[] = [
  bookingSheetWidget,
  bookingKocHeadlineWidget,
  bookingKocTrendWidget,
  bookingKocRelationWidget,
  bookingKocProductsWidget,
  bookingKocKocsWidget,
]
