import AppBar from '@mui/material/AppBar'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import { requireUser } from '@/core/auth/session'
import { Brand } from '@/components/layout/brand'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { getTranslations } from 'next-intl/server'
import { maintenanceState } from '@/modules/site-settings/data/settings'
import { MaintenanceNotice } from '@/modules/site-settings/ui/maintenance-notice'
import { MaintenanceWatcher } from '@/modules/site-settings/ui/maintenance-watcher'
import { SiteCorner } from '@/modules/site-settings/ui/site-corner'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const isAdmin = user.role === 'admin'
  // Closed for maintenance (an update running, or switched on by hand): everyone but Administrators sees the notice instead.
  const maintenance = await maintenanceState()
  const closed = maintenance.active && !isAdmin
  const t = await getTranslations('siteSettings')

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* Solid green with faint light discs; the colour and the gradients
          come from the MuiAppBar override in the theme. */}
      <AppBar position="sticky">
        <Toolbar variant="dense" sx={{ minHeight: 56, gap: 2, px: { xs: 2, md: 3 } }}>
          <Brand href="/projects" />
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <ThemeToggle onColor />
            <LocaleSwitcher onColor />
            <Divider
              orientation="vertical"
              flexItem
              sx={{ mx: 0.5, my: 1, borderColor: 'rgba(255,255,255,0.28)' }}
            />
            <UserMenu name={user.name} email={user.email} isAdmin={isAdmin} onColor />
          </Stack>
        </Toolbar>
      </AppBar>

      {maintenance.active && isAdmin ? (
        <Alert
          severity="warning"
          square
          action={
            <Button color="inherit" size="small" href="/admin/settings">
              {t('banner.open')}
            </Button>
          }
        >
          {maintenance.updating ? t('banner.updating') : t('banner.manual')}
        </Alert>
      ) : null}

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        {closed ? <MaintenanceNotice updating={maintenance.updating} message={maintenance.message} /> : children}
      </Box>
      <SiteCorner placement="footer" />
      {!isAdmin && !closed ? <MaintenanceWatcher /> : null}
    </Box>
  )
}
