import Box from '@mui/material/Box'
import { requireSystemAdmin } from '@/core/auth/session'
import { titled } from '@/core/metadata'
import { adjustmentsOverview } from '@/modules/metric-adjustments/data/queries'
import { AdjustmentsPanel } from '@/modules/metric-adjustments/ui/adjustments-panel'

export const generateMetadata = titled('adjustments', 'title')

/**
 * Metric adjustments — platform Administrators only: amounts added to or
 * taken off a project's overview figures (see src/modules/metric-adjustments).
 */
export default async function AdjustmentsPage() {
  await requireSystemAdmin()
  const overview = await adjustmentsOverview()
  return (
    <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 }, maxWidth: 1400, mx: 'auto' }}>
      <AdjustmentsPanel initial={overview} />
    </Box>
  )
}
