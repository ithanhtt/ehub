'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import Alert, { type AlertColor } from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

/**
 * Small pieces the System and Database pages share: a card heading, a meter,
 * a live sparkline, a label/value list, a confirmation dialog and a toast.
 */

export function CardTitle({ icon, children, action }: { icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, minHeight: 32 }}>
      {icon}
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }} noWrap>
        {children}
      </Typography>
      {action}
    </Stack>
  )
}

/** Past this share a meter turns amber; past WARN_DISK_PERCENT (85) red. */
export function Meter({ percent, warnAt = 70, dangerAt = 85 }: { percent: number | null; warnAt?: number; dangerAt?: number }) {
  const value = percent === null ? 0 : Math.min(100, Math.max(0, percent))
  const color = percent === null ? 'inherit' : value >= dangerAt ? 'error' : value >= warnAt ? 'warning' : 'primary'
  return <LinearProgress variant="determinate" value={value} color={color} sx={{ height: 8, borderRadius: 4, my: 1 }} aria-valuenow={value} />
}

/**
 * The last minutes of a percentage, 0–100 on a fixed scale (so a quiet
 * machine looks quiet rather than every wobble filling the box). Fills its
 * width; the newest point is marked.
 */
export function Spark({ values, color = 'var(--mui-palette-primary-main)', label }: { values: number[]; color?: string; label: string }) {
  const w = 300
  const h = 48
  if (values.length < 2) return <Box sx={{ height: h }} aria-hidden />
  const step = w / Math.max(1, values.length - 1)
  const y = (v: number) => h - 2 - (Math.min(100, Math.max(0, v)) / 100) * (h - 4)
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`)
  const line = `M${points.join('L')}`
  const area = `${line}L${((values.length - 1) * step).toFixed(1)},${h}L0,${h}Z`
  return (
    <Box component="svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label} sx={{ width: '100%', height: h, display: 'block' }}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </Box>
  )
}

export function KeyValues({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'minmax(110px, max-content) minmax(0, 1fr)', columnGap: 2, rowGap: 0.75, m: 0 }}>
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" sx={{ color: 'text.secondary' }}>
            {label}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  children: React.ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const tc = useTranslations('common')
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          {tc('cancel')}
        </Button>
        <Button
          variant="contained"
          color={danger ? 'error' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export type Toast = { severity: AlertColor; message: string }

/** One toast at a time, bottom centre, as the rest of the app shows them. */
export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const [open, setOpen] = useState(false)
  const show = useCallback((severity: AlertColor, message: string) => {
    setToast({ severity, message })
    setOpen(true)
  }, [])
  const element = (
    <Snackbar
      open={open}
      autoHideDuration={toast?.severity === 'error' ? 10_000 : 6_000}
      onClose={(_event, reason) => {
        if (reason !== 'clickaway') setOpen(false)
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity={toast?.severity ?? 'info'} variant="filled" onClose={() => setOpen(false)} sx={{ maxWidth: 640, whiteSpace: 'pre-line' }}>
        {toast?.message}
      </Alert>
    </Snackbar>
  )
  return { show, element }
}

/** Seconds as "3 ngày 4 giờ", "5 giờ 12 phút", "40 giây" — the two largest parts. */
export function useDuration() {
  const t = useTranslations('system')
  return (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds))
    const parts: Array<[number, 'days' | 'hours' | 'minutes' | 'seconds']> = [
      [Math.floor(s / 86_400), 'days'],
      [Math.floor((s % 86_400) / 3_600), 'hours'],
      [Math.floor((s % 3_600) / 60), 'minutes'],
      [s % 60, 'seconds'],
    ]
    const first = parts.findIndex(([n]) => n > 0)
    if (first < 0) return t('units.seconds', { n: 0 })
    return parts
      .slice(first, first + 2)
      .filter(([n]) => n > 0)
      .map(([n, unit]) => t(`units.${unit}`, { n }))
      .join(' ')
  }
}
