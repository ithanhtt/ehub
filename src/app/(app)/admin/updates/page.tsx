import Box from '@mui/material/Box'
import { requireSystemAdmin } from '@/core/auth/session'
import { updateOverview } from '@/modules/system-update/data/overview'
import { UpdatePanel } from '@/modules/system-update/ui/update-panel'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('systemUpdate', 'title')

/**
 * System update — platform Administrators only. On the development machine
 * it sends the code to the server; on the server it takes the confirmation
 * code and applies the update (see src/modules/system-update).
 */
export default async function SystemUpdatePage() {
  await requireSystemAdmin()
  const overview = await updateOverview()
  return (
    <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 }, maxWidth: 1100, mx: 'auto' }}>
      <UpdatePanel initial={overview} />
    </Box>
  )
}
