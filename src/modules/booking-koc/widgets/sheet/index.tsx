'use client'

import { SheetNotice } from '@/modules/analytics/shared/sheet-notice'
import type { ReportWidget } from '@/modules/analytics/types'
import { useBookingKoc } from '../../shared'

/** The booking file's state, above everything it feeds. */
function BookingSheetStatus() {
  const { report, projectId } = useBookingKoc()
  return report.data.sheet ? <SheetNotice sheet={report.data.sheet} projectId={projectId} /> : null
}

export const bookingSheetWidget: ReportWidget = {
  id: 'booking-koc-sheet',
  band: 'notice',
  order: 10,
  sources: ['booking'],
  size: { xs: 12 },
  Component: BookingSheetStatus,
}
