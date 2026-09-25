import Box from '@mui/material/Box'
import { requireSystemAdmin } from '@/core/auth/session'
import { titled } from '@/core/metadata'
import { systemSnapshot } from '@/modules/system-admin/data/system-info'
import { SystemPanel } from '@/modules/system-admin/ui/system-panel'

export const generateMetadata = titled('system', 'title')

/**
 * System — platform Administrators only: the machine, the app and its
 * database at a glance, live CPU and memory, and the maintenance buttons
 * (clean-up, VACUUM, clear the in-memory cache, snapshot).
 */
export default async function SystemPage() {
  await requireSystemAdmin()
  const snapshot = await systemSnapshot()
  return (
    <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 }, maxWidth: 1400, mx: 'auto' }}>
      <SystemPanel initial={snapshot} />
    </Box>
  )
}
