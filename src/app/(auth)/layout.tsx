import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { getCurrentUser } from '@/core/auth/session'
import { resumePath } from '@/features/projects/resume'
import { Brand } from '@/components/layout/brand'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import { ThemeToggle } from '@/components/layout/theme-toggle'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Someone already signed in has no business on the sign-in screen.
  if (await getCurrentUser()) redirect(await resumePath())
  const t = await getTranslations('common')

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
        <Box sx={{ width: '100%', maxWidth: 420 }}>{children}</Box>
      </Box>

      <Typography variant="caption" sx={{ pb: 3, textAlign: 'center', color: 'text.secondary' }}>
        {t('tagline')}
      </Typography>
    </Box>
  )
}
