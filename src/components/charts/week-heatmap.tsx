'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { known, useWidth } from './chart-kit'

/**
 * Orders by weekday and hour: a row per weekday, a cell per hour.
 *
 * A cell's shade is its orders on a single-hue sequential ramp (the
 * --adshub-seq-* tokens), light to dark in six steps relative to the busiest
 * cell; an hour with no orders, or none counted yet, is the plain empty tone.
 * Cells are separated by a 2px surface gap. Figures are read on hover or with
 * the arrow keys; the table view of the card lists them all.
 */

export type HeatRow = {
  key: string
  label: string
  fullLabel: string
  /** 24 values, hour 0 first; null for an hour with no day behind it (yet). */
  values: Array<number | null>
  /** The days behind each hour's value. */
  counts: number[]
}

const LABEL_W = 44
const AXIS_H = 22
const GAP = 2
const STEPS = 6

export function WeekHeatmap({
  rows,
  format,
  text,
  ariaLabel,
}: {
  rows: HeatRow[]
  format: (value: number) => string
  text: {
    value: string
    hourRange: (hour: number) => string
    hourTick: (hour: number) => string
    days: (count: number) => string
    less: string
    more: string
    noData: string
  }
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<{ row: number; hour: number } | null>(null)

  const max = Math.max(0, ...rows.flatMap((row) => row.values.filter(known)))
  const innerW = Math.max(0, width - LABEL_W - 4)
  const cellW = innerW / 24
  const cellH = Math.max(18, Math.min(28, cellW * 0.8))
  const gridH = rows.length * cellH
  const svgHeight = gridH + AXIS_H
  const tickEvery = innerW < 360 ? 6 : 3
  const shade = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.min(STEPS, 1 + Math.floor((v / max) * STEPS * 0.9999)))

  const pick = (clientX: number, clientY: number, rect: DOMRect) => {
    const row = Math.floor((clientY - rect.top) / cellH)
    const hour = Math.floor((clientX - rect.left - LABEL_W) / cellW)
    return row >= 0 && row < rows.length && hour >= 0 && hour < 24 ? { row, hour } : null
  }
  const move = (dRow: number, dHour: number) =>
    setActive((current) => {
      const at = current ?? { row: 0, hour: 0 }
      return {
        row: Math.min(rows.length - 1, Math.max(0, at.row + dRow)),
        hour: Math.min(23, Math.max(0, at.hour + dHour)),
      }
    })

  const activeRow = active ? rows[active.row] : null
  const activeValue = active && activeRow ? activeRow.values[active.hour] : null
  const tipLeft = active ? LABEL_W + (active.hour + 1) * cellW + 8 : 0
  const flip = active !== null && tipLeft > width * 0.65

  return (
    <Box>
      <Box ref={ref} sx={{ position: 'relative', width: '100%', height: svgHeight }}>
        {width > 0 ? (
          <svg
            width={width}
            height={svgHeight}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            style={{ display: 'block', outline: 'none', touchAction: 'pan-y' }}
            onPointerMove={(event) => setActive(pick(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()))}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') move(0, -1)
              if (event.key === 'ArrowRight') move(0, 1)
              if (event.key === 'ArrowUp') move(-1, 0)
              if (event.key === 'ArrowDown') move(1, 0)
            }}
          >
            {rows.map((row, r) => (
              <g key={row.key}>
                <text
                  x={LABEL_W - 8}
                  y={r * cellH + cellH / 2}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--mui-palette-text-secondary)"
                >
                  {row.label}
                </text>
                {Array.from({ length: 24 }, (_, hour) => {
                  const v = row.values[hour] ?? 0
                  const on = active?.row === r && active.hour === hour
                  return (
                    <rect
                      key={hour}
                      x={LABEL_W + hour * cellW + GAP / 2}
                      y={r * cellH + GAP / 2}
                      width={Math.max(1, cellW - GAP)}
                      height={cellH - GAP}
                      rx={3}
                      fill={`var(--adshub-seq-${shade(v)})`}
                      stroke={on ? 'var(--mui-palette-text-primary)' : 'none'}
                      strokeWidth={on ? 2 : 0}
                      style={{ transition: 'fill .6s ease-out' }}
                    />
                  )
                })}
              </g>
            ))}
            {Array.from({ length: 24 }, (_, hour) =>
              hour % tickEvery === 0 ? (
                <text
                  key={`tick-${hour}`}
                  x={LABEL_W + hour * cellW + cellW / 2}
                  y={gridH + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--mui-palette-text-disabled)"
                >
                  {text.hourTick(hour)}
                </text>
              ) : null,
            )}
          </svg>
        ) : null}

        {active && activeRow && width > 0 ? (
          <Box
            role="status"
            sx={{
              position: 'absolute',
              top: Math.max(0, Math.min(active.row * cellH, gridH - 72)),
              left: flip ? undefined : tipLeft,
              right: flip ? width - (LABEL_W + active.hour * cellW) + 8 : undefined,
              minWidth: 170,
              px: 1.5,
              py: 1,
              borderRadius: 2,
              pointerEvents: 'none',
              backgroundColor: 'var(--adshub-surface-floating)',
              boxShadow: '0 12px 32px -18px rgb(0 0 0 / 0.45)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 0.5 }}>
              {`${activeRow.fullLabel} · ${text.hourRange(active.hour)}`}
            </Typography>
            {known(activeValue) ? (
              <>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {format(activeValue)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {text.value}
                  </Typography>
                </Stack>
                <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
                  {text.days(activeRow.counts[active.hour])}
                </Typography>
              </>
            ) : (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                {text.noData}
              </Typography>
            )}
          </Box>
        ) : null}
      </Box>

      {/* The ramp's key: fewer to more, with the busiest cell's figure at the end. */}
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'flex-end', mt: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {text.less}
        </Typography>
        {Array.from({ length: STEPS + 1 }, (_, step) => (
          <Box key={step} sx={{ width: 14, height: 10, borderRadius: '2px', backgroundColor: `var(--adshub-seq-${step})` }} />
        ))}
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {`${text.more} (${format(max)})`}
        </Typography>
      </Stack>
    </Box>
  )
}
