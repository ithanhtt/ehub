'use client'

import type { ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import SyncOutlined from '@mui/icons-material/SyncOutlined'

/**
 * "Still syncing — the figures may be short", said above everything they
 * affect, with a line per source still coming in. The same look wherever a
 * page reads data that is still arriving (the overview's TikTok sources, the
 * reports), beside the overview's own Sapo notice: a turning sync icon, a
 * title, the sources one by one, and that the page updates by itself.
 */
export function SyncNotice({ title, lines, footer, severity = 'info' }: { title: string; lines: ReactNode[]; footer?: string; severity?: 'info' | 'warning' }) {
  if (lines.length === 0) return null
  return (
    <Alert
      severity={severity}
      role="status"
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
      <AlertTitle sx={{ fontWeight: 700 }}>{title}</AlertTitle>
      {lines.length === 1 ? (
        <Typography variant="body2">{lines[0]}</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {lines.map((line, i) => (
            <Typography key={i} component="li" variant="body2" sx={{ display: 'list-item' }}>
              {line}
            </Typography>
          ))}
        </Box>
      )}
      {footer ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}>
          {footer}
        </Typography>
      ) : null}
    </Alert>
  )
}
