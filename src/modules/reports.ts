import 'server-only'

import type { ReportPeriod } from './analytics/period'
import type { ReportEnvelope } from './analytics/types'
import { bookingKocReport } from './booking-koc/report'
import { costRoiReport } from './cost-roi/report'
import { orderCancelReport } from './order-cancel/report'
import { videoGmvReport } from './video-gmv/report'

/**
 * How the server builds each report module's answer, by module id — what the
 * reports route (/api/projects/[projectId]/reports/[reportId]) serves. Server
 * only: the page side of a module never imports its report builder.
 */
export const REPORT_BUILDERS: Record<string, (projectId: string, period: ReportPeriod) => Promise<ReportEnvelope<unknown>>> = {
  'booking-koc': bookingKocReport,
  'cost-roi': costRoiReport,
  'order-cancel': orderCancelReport,
  'video-gmv': videoGmvReport,
}
