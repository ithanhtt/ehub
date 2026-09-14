'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { known, niceTicks, roundedTop, useTweened, useWidth } from './chart-kit'

/**
 * Orders by hour of the day: 24 columns, midnight to midnight.
 *
 * The busiest stretch (`peak`) is drawn in the full series color and every
 * other hour in a tint of it, so the peak is seen before anything is read. A
 * reference day — the usual one, in the today view — is a tick across each
 * column, in ink. The hour still in progress has a dashed outline. Figures are
 * read on hover or with the arrow keys, not printed on the chart.
 */

const MARGIN = { top: 22, right: 12, bottom: 26, left: 44 }

export function HourColumns({
  values,
  reference = null,
  peak = null,
  currentHour = null,
  detail,
  color,
  height = 190,
  format,
  formatTick,
  text,
  ariaLabel,
}: {
  /** 24 values, hour 0 first; null for an hour still ahead. */
  values: Array<number | null>
  /** A comparison for each hour, drawn as ticks. */
  reference?: number[] | null
  /** The hours to emphasise, first and last inclusive. */
  peak?: { start: number; end: number } | null
  /** The hour still in progress, if any. */
  currentHour?: number | null
  /** An extra tooltip line for an hour (the total behind an average). */
  detail?: (hour: number) => string | null
  color: string
  height?: number
  format: (value: number) => string
  formatTick: (value: number) => string
  text: {
    unit: string
    value: string
    reference: string
    inProgress: string
    inPeak: string
    hourRange: (hour: number) => string
    hourTick: (hour: number) => string
  }
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const max = Math.max(0, ...values.filter(known), ...(reference ?? []))
  const ticks = niceTicks(max)
  const frame = useTweened(
    [{ key: 'values', values }, ...(reference ? [{ key: 'reference', values: reference }] : [])],
    [ticks[ticks.length - 1] || 1],
  )
  const eased = (key: string) => frame.tracks.find((t) => t.key === key)?.values ?? []
  const top = frame.tops[0] || 1

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const base = MARGIN.top + height
  const step = innerW / 24
  const cx = (hour: number) => MARGIN.left + step * (hour + 0.5)
  const y = (v: number) => base - (v / top) * height
  const barW = Math.max(2, Math.min(22, step * 0.7))
  const tickEvery = innerW < 360 ? 6 : 3
  const inPeak = (hour: number) => peak !== null && hour >= peak.start && hour <= peak.end
  const svgHeight = base + MARGIN.bottom
  const nearest = (clientX: number, rect: DOMRect) =>
    step > 0 ? Math.min(23, Math.max(0, Math.floor((clientX - rect.left - MARGIN.left) / step))) : null
  const tooltipLeft = active === null ? 0 : cx(active)
  const flip = tooltipLeft > width * 0.6
  const extra = active !== null && detail ? detail(active) : null

  return (
    <Box ref={ref} sx={{ position: 'relative', width: '100%', height: svgHeight }}>
      {width > 0 ? (
        <svg
          width={width}
          height={svgHeight}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          style={{ display: 'block', outline: 'none', touchAction: 'pan-y' }}
          onPointerMove={(event) => setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(peak?.start ?? 0)}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setActive(Math.max(0, (active ?? 1) - 1))
            if (event.key === 'ArrowRight') setActive(Math.min(23, (active ?? -1) + 1))
          }}
        >
          {/* Left-aligned from the chart's edge, so a longer unit ("đơn/ngày") is never clipped. */}
          <text x={0} y={MARGIN.top - 10} textAnchor="start" fontSize={11} fill="var(--mui-palette-text-disabled)">
            {text.unit}
          </text>

          {/* Hairline solid grid and tick labels; tabular figures so the column aligns. */}
          {ticks.map((tick) => {
            const gy = base - (tick / top) * height
            return (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={gy}
                  y2={gy}
                  stroke="var(--mui-palette-divider)"
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 8}
                  y={gy}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--mui-palette-text-disabled)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatTick(tick)}
                </text>
              </g>
            )
          })}

          {Array.from({ length: 24 }, (_, hour) =>
            hour % tickEvery === 0 ? (
              <text
                key={hour}
                x={cx(hour)}
                y={base + 18}
                textAnchor="middle"
                fontSize={11}
                fill="var(--mui-palette-text-disabled)"
              >
                {text.hourTick(hour)}
              </text>
            ) : null,
          )}

          {active !== null ? (
            <rect
              x={MARGIN.left + step * active}
              y={MARGIN.top}
              width={step}
              height={height}
              fill="var(--mui-palette-action-hover)"
            />
          ) : null}

          {eased('values').map((v, hour) => {
            if (!known(v) || v <= 0) return null
            const topY = y(v)
            const ongoing = hour === currentHour
            return (
              <path
                key={hour}
                d={roundedTop(cx(hour) - barW / 2, topY, barW, base - topY, 3)}
                fill={color}
                fillOpacity={inPeak(hour) ? 1 : 0.45}
                stroke={ongoing ? color : 'none'}
                strokeWidth={ongoing ? 1.5 : 0}
                strokeDasharray={ongoing ? '3 2' : undefined}
                opacity={active !== null && active !== hour ? 0.5 : 1}
              />
            )
          })}

          {/* The reference day: a tick across each column, in ink over a surface halo. */}
          {reference
            ? eased('reference').map((v, hour) => {
                if (!known(v) || v <= 0) return null
                const ty = y(v)
                const x1 = cx(hour) - barW / 2 - 2
                const x2 = cx(hour) + barW / 2 + 2
                return (
                  <g key={`reference-${hour}`} opacity={active !== null && active !== hour ? 0.5 : 1}>
                    <line x1={x1} x2={x2} y1={ty} y2={ty} stroke="var(--mui-palette-background-paper)" strokeWidth={4} />
                    <line x1={x1} x2={x2} y1={ty} y2={ty} stroke="var(--mui-palette-text-primary)" strokeWidth={2} />
                  </g>
                )
              })
            : null}
        </svg>
      ) : null}

      {active !== null && width > 0 ? (
        <Box
          role="status"
          sx={{
            position: 'absolute',
            top: 0,
            left: flip ? undefined : tooltipLeft + step / 2 + 8,
            right: flip ? width - tooltipLeft + step / 2 + 8 : undefined,
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
            {text.hourRange(active)}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '2px', backgroundColor: color, flexShrink: 0, mx: '2px' }} />
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {known(values[active]) ? format(values[active] as number) : '—'}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {text.value}
            </Typography>
          </Stack>
          {reference ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 12, height: 0, borderTop: '2px solid', borderColor: 'text.primary', flexShrink: 0 }} />
              <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {format(reference[active])}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {text.reference}
              </Typography>
            </Stack>
          ) : null}
          {extra ? (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
              {extra}
            </Typography>
          ) : null}
          {inPeak(active) ? (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
              {text.inPeak}
            </Typography>
          ) : null}
          {active === currentHour ? (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
              {text.inProgress}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}
