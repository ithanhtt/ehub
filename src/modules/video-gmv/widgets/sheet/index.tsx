'use client'

import { SheetNotice } from '@/modules/analytics/shared/sheet-notice'
import type { ReportWidget } from '@/modules/analytics/types'
import { useVideoGmv } from '../../shared'

/** The booking file's state, above everything it feeds. */
function VideoGmvSheetStatus() {
  const { report, projectId } = useVideoGmv()
  return report.data.sheet ? <SheetNotice sheet={report.data.sheet} projectId={projectId} /> : null
}

export const videoGmvSheetWidget: ReportWidget = {
  id: 'video-gmv-sheet',
  band: 'notice',
  order: 10,
  sources: ['booking'],
  size: { xs: 12 },
  Component: VideoGmvSheetStatus,
}
