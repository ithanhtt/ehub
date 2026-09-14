import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import { requireUser } from '@/core/auth/session'
import { Brand } from '@/components/layout/brand'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

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
            <UserMenu name={user.name} email={user.email} isAdmin={user.role === 'admin'} onColor />
          </Stack>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  )
}
