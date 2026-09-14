'use client'

import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import SyncOutlined from '@mui/icons-material/SyncOutlined'
import { useOverview } from '../../context'
import type { OverviewWidget } from '../../types'

/**
 * Sapo figures still coming in, said plainly above everything they affect.
 * How much it matters decides the tone: days of the period itself missing (a
 * warning — its numbers, charts and lists may be short), only days of the
 * comparison period (information — this period is whole, only the changes are
 * not), or only product lines being filled in. Refunds still coming in — the
 * earlier days a period's returns are counted from, or the latest
 * cancellations — leave the orders whole but the revenue high: a warning too.
 * A bar shows how far the fetch has come; the page updates itself as days land.
 */
function SapoSync() {
  const t = useTranslations('dashboard')
  const sapo = useOverview().data.sapo
  if (!sapo) return null

  const { sync } = sapo
  const missing = sync.current + sync.previous + sync.returns
  const done = Math.max(0, sync.total - missing)
  return (
    <Alert
      severity={sync.current > 0 || sync.returns > 0 || sync.catchingUp ? 'warning' : 'info'}
      icon={
        <SyncOutlined
          sx={{
            animation: 'adshub-sync 1.6s linear infinite',
            '@keyframes adshub-sync': { to: { transform: 'rotate(-360deg)' } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      }
    >
      <AlertTitle sx={{ fontWeight: 700 }}>{t('syncTitle')}</AlertTitle>
      {sync.current > 0
        ? t('syncCurrent', { count: sync.current })
        : sync.returns > 0
          ? t('syncReturns', { count: sync.returns })
          : sync.catchingUp
            ? t('syncLedger')
            : sync.previous > 0
              ? t('syncPrevious', { count: sync.previous })
              : t('syncProducts', { count: sapo.products.pendingDays })}
      {missing > 0 && sync.total > 0 ? (
        <Box sx={{ mt: 1, maxWidth: 480 }}>
          <LinearProgress
            variant="determinate"
            value={(done / sync.total) * 100}
            color="inherit"
            aria-label={t('syncProgress', { done, total: sync.total })}
            sx={{ height: 6, borderRadius: 3 }}
          />
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
            {t('syncProgress', { done, total: sync.total })}
          </Typography>
        </Box>
      ) : null}
    </Alert>
  )
}

export const sapoSyncWidget: OverviewWidget = {
  id: 'sapo-sync',
  band: 'notice',
  order: 10,
  sources: ['sapo'],
  size: { xs: 12 },
  // Only while something is still coming in.
  when: ({ data }) =>
    data.sapo !== null &&
    (data.sapo.sync.current > 0 ||
      data.sapo.sync.previous > 0 ||
      data.sapo.sync.returns > 0 ||
      data.sapo.sync.catchingUp ||
      data.sapo.products.pendingDays > 0),
  Component: SapoSync,
}
