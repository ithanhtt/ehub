'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'

/**
 * "● LIVE · updated 8 s ago", and behind it how fresh each source is. The dot
 * pulses while updates arrive on time and turns amber and still once they
 * stop, next to words that say the same; a warning icon joins it when a
 * source needs attention — so state never rests on animation or color alone.
 */
export function StatusBadge({
  stale,
  warn,
  warnLabel,
  label,
  detail,
  title,
  children,
}: {
  stale: boolean
  warn: boolean
  warnLabel: string
  label: string
  detail: string
  title?: string
  children: React.ReactNode
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="dialog"
        title={title}
        sx={{
          gap: 0.75,
          px: 1,
          py: 0.5,
          borderRadius: 999,
          '&:hover': { backgroundColor: 'action.hover' },
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' },
        }}
      >
        <Box sx={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
          <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', bgcolor: stale ? 'warning.main' : 'error.main' }} />
          {stale ? null : (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                bgcolor: 'error.main',
                animation: 'adshub-live 1.6s ease-out infinite',
                '@keyframes adshub-live': {
                  '0%': { transform: 'scale(1)', opacity: 0.6 },
                  '100%': { transform: 'scale(2.8)', opacity: 0 },
                },
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            />
          )}
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {detail}
        </Typography>
        {warn ? <ReportProblemOutlined aria-label={warnLabel} sx={{ fontSize: 16, color: 'warning.main' }} /> : null}
      </ButtonBase>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, width: 300, maxWidth: 'calc(100vw - 32px)' }}>{children}</Box>
      </Popover>
    </>
  )
}

/** A status line: the dot pairs with the words, so state never rests on color alone. */
export function SourceLine({ name, ok, detail }: { name: string; ok: boolean; detail: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          transform: 'translateY(-1px)',
          backgroundColor: ok ? 'success.main' : 'warning.main',
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {name}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {detail}
        </Typography>
      </Box>
    </Stack>
  )
}
