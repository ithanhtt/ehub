'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ConstructionOutlined from '@mui/icons-material/ConstructionOutlined'
import SystemUpdateAltOutlined from '@mui/icons-material/SystemUpdateAltOutlined'

/** How often the notice asks whether the app has reopened. */
const POLL_MS = 20_000

/**
 * What everyone but an Administrator sees in place of the app while it is
 * closed for maintenance — an update being applied, or maintenance switched
 * on by hand. It asks every little while and reloads by itself once the app
 * is open again.
 */
export function MaintenanceNotice({ updating, message }: { updating: boolean; message: string }) {
  const t = useTranslations('siteSettings.notice')

  useEffect(() => {
    let stopped = false
    const check = async () => {
      if (document.hidden) return
      try {
        const response = await fetch('/api/maintenance', { cache: 'no-store' })
        if (!response.ok) return
        const { active } = (await response.json()) as { active: boolean }
        if (!active && !stopped) window.location.reload()
      } catch {
        /* the server restarting mid-update: asked again shortly */
      }
    }
    const timer = setInterval(() => void check(), POLL_MS)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', px: 2, py: { xs: 6, md: 12 } }}>
      <Card sx={{ maxWidth: 520, width: '100%' }}>
        <LinearProgress />
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            {updating ? (
              <SystemUpdateAltOutlined color="primary" sx={{ fontSize: 48 }} />
            ) : (
              <ConstructionOutlined color="primary" sx={{ fontSize: 48 }} />
            )}
            <Typography variant="h4" component="h1">
              {updating ? t('updatingTitle') : t('title')}
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>
              {t('body')}
            </Typography>
            {message ? (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                {message}
              </Typography>
            ) : null}
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              {t('autoReload')}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
