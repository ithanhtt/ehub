'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import TrendingDownOutlined from '@mui/icons-material/TrendingDownOutlined'
import TrendingFlatOutlined from '@mui/icons-material/TrendingFlatOutlined'
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined'
import SyncOutlined from '@mui/icons-material/SyncOutlined'
import { AnimatedNumber } from './animated-number'

/**
 * A headline number: label, value, change against the previous period, and a
 * small trend.
 *
 * The value counts to each new confirmed figure (AnimatedNumber), so a live
 * total visibly climbs. The delta carries an arrow as well as a color, and
 * the color follows whether the move is good — spend going up is not good
 * news the way revenue going up is — so direction and meaning are never told
 * by hue alone. The sparkline is de-emphasis gray with only the latest point
 * in the accent.
 */
export type Delta = { ratio: number; upIsGood: boolean }

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const w = 88
  const h = 28
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)])
  const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg width={w} height={h} aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <path
        d={d}
        fill="none"
        stroke="var(--mui-palette-text-disabled)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        style={{ transition: 'd .6s ease-out' }}
      />
      <circle
        cx={lx}
        cy={ly}
        r={3}
        fill={color}
        stroke="var(--mui-palette-background-paper)"
        strokeWidth={1.5}
        style={{ transition: 'cx .6s ease-out, cy .6s ease-out' }}
      />
    </svg>
  )
}

export function StatTile({
  label,
  value,
  format,
  formatStep,
  integer,
  exact,
  delta,
  deltaLabel,
  trend,
  accent = 'var(--adshub-series-1)',
  footnote,
  pending,
}: {
  label: string
  /** null shows a dash — for a ratio with nothing to divide by. */
  value: number | null
  /** Display form while counting and at rest (12,9 Tr). */
  format: (value: number) => string
  /** Form of the "+…" badge shown on an increase; omit for none. */
  formatStep?: (step: number) => string
  integer?: boolean
  /** The exact figure, on hover. */
  exact?: string
  delta?: Delta | null
  /** "vs previous 7 days" — names the comparison so a percentage is never bare. */
  deltaLabel?: string
  trend?: number[]
  accent?: string
  footnote?: string
  /** Set while the figure's data is still syncing: why it may be short, shown on a sync icon by the label. */
  pending?: string
}) {
  // While the pointer rests on the tile, the "+…" of the latest increase stays up.
  const [hovered, setHovered] = useState(false)
  const hasDelta = delta && Number.isFinite(delta.ratio)
  const flat = hasDelta && Math.abs(delta.ratio) < 0.005
  const up = hasDelta && delta.ratio > 0
  const good = hasDelta && !flat && up === delta.upIsGood
  const Icon = flat ? TrendingFlatOutlined : up ? TrendingUpOutlined : TrendingDownOutlined

  return (
    <Card sx={{ height: '100%' }} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }} noWrap>
            {label}
          </Typography>
          {pending ? (
            <Tooltip title={pending}>
              <SyncOutlined aria-label={pending} sx={{ fontSize: 14, color: 'warning.main', flexShrink: 0 }} />
            </Tooltip>
          ) : null}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', justifyContent: 'space-between', mt: 0.5 }}>
          <Tooltip title={exact ?? ''} disableHoverListener={!exact} placement="top-start">
            <Typography
              variant="h2"
              component="p"
              sx={{ typography: { xs: 'h3', sm: 'h2' }, lineHeight: 1.1, fontWeight: 700, minWidth: 0 }}
            >
              {value === null ? (
                '—'
              ) : (
                <AnimatedNumber value={value} format={format} formatStep={formatStep} integer={integer} pinned={hovered} />
              )}
            </Typography>
          </Tooltip>
          {trend ? <Sparkline values={trend} color={accent} /> : null}
        </Stack>
        {/*
          Two fixed lines under the value — the change, then a footnote — kept
          even when empty, so every tile in a row stands the same height.
        */}
        <Box sx={{ mt: 0.75 }}>
          {hasDelta ? (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minHeight: 20, minWidth: 0 }}>
              <Icon
                sx={{
                  fontSize: 16,
                  color: flat ? 'text.disabled' : good ? 'success.main' : 'error.main',
                }}
              />
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, color: flat ? 'text.secondary' : good ? 'success.main' : 'error.main' }}
              >
                {`${up ? '+' : ''}${(delta.ratio * 100).toFixed(Math.abs(delta.ratio) < 0.1 ? 1 : 0)}%`}
              </Typography>
              {deltaLabel ? (
                <Typography variant="caption" sx={{ color: 'text.disabled' }} noWrap>
                  {deltaLabel}
                </Typography>
              ) : null}
            </Stack>
          ) : (
            <Box sx={{ minHeight: 20 }} />
          )}
          <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', minHeight: 18 }} noWrap>
            {footnote ?? ' '}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}
