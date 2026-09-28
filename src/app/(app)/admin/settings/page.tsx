import Box from '@mui/material/Box'
import { requireSystemAdmin } from '@/core/auth/session'
import { titled } from '@/core/metadata'
import { maintenanceState, readSiteSettings, templateValues } from '@/modules/site-settings/data/settings'
import { SettingsPanel } from '@/modules/site-settings/ui/settings-panel'

export const generateMetadata = titled('siteSettings', 'title')

/**
 * Settings — platform Administrators only: maintenance mode and the note in
 * the corner of every page (see src/modules/site-settings).
 */
export default async function SettingsPage() {
  await requireSystemAdmin()
  const [settings, state, values] = await Promise.all([readSiteSettings(), maintenanceState(), templateValues()])
  return (
    <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 }, maxWidth: 1400, mx: 'auto' }}>
      <SettingsPanel initial={settings} updating={state.updating} values={values} />
    </Box>
  )
}
