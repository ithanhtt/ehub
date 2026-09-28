import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { getCurrentUser } from '@/core/auth/session'
import { resumePath } from '@/features/projects/resume'
import { Brand } from '@/components/layout/brand'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { maintenanceState } from '@/modules/site-settings/data/settings'
import { SiteCorner } from '@/modules/site-settings/ui/site-corner'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Someone already signed in has no business on the sign-in screen.
  if (await getCurrentUser()) redirect(await resumePath())
  const t = await getTranslations('common')
  const ts = await getTranslations('siteSettings.notice')
  // Sign-in stays open (an Administrator must get in); everyone else is turned away by it (login/actions.ts).
  const maintenance = await maintenanceState()

  // No background of its own: the colour wash comes from AmbientBackground in
  // the root layout, so the sign-in card frosts the same backdrop as the app.
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        sx={{ px: { xs: 2, sm: 3 }, py: 2, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Brand />
        <Stack direction="row" spacing={0.5}>
          <ThemeToggle />
          <LocaleSwitcher />
        </Stack>
      </Stack>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
          pb: 8,
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 420 }}>
          {maintenance.active ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle>{maintenance.updating ? ts('updatingTitle') : ts('title')}</AlertTitle>
              {ts('body')}
              {maintenance.message ? <Box sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>{maintenance.message}</Box> : null}
              <Box sx={{ mt: 0.5, opacity: 0.8 }}>{ts('adminOnly')}</Box>
            </Alert>
          ) : null}
          {children}
        </Box>
      </Box>

      <Typography variant="caption" sx={{ pb: 3, textAlign: 'center', color: 'text.secondary' }}>
        {t('tagline')}
      </Typography>
      <SiteCorner placement="footer" />
    </Box>
  )
}
