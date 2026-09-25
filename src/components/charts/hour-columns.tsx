'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import { known, niceTicks, roundedTop, useChartPointer, useTweened, useWidth } from './chart-kit'
import { ChartTooltip, TipContent, type TipRow } from './chart-tooltip'

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
  rows: rowsFor,
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
  /**
   * The tooltip's figures for an hour, in place of the single value row —
   * for a chart that is one measure of several read together (the chart's own
   * row marked by the caller). The reference then goes in the notes.
   */
  rows?: (hour: number) => TipRow[]
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
  const extra = active !== null && detail ? detail(active) : null
  const pointer = useChartPointer<number>(setActive, (event) => nearest(event.clientX, event.currentTarget.getBoundingClientRect()), () => setActive(peak?.start ?? 0))

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
          {...pointer}
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
        <ChartTooltip x={tooltipLeft} gap={step / 2 + 8} chartWidth={width} width={rowsFor ? 270 : 190} top={0}>
          {/* The hour, its figure and the comparison as rows; what else is true of the hour as notes. */}
          <TipContent
            title={text.hourRange(active)}
            tag={active === currentHour ? text.inProgress : undefined}
            rows={
              rowsFor
                ? rowsFor(active)
                : [
                    { key: 'value', mark: 'bar', color, label: text.value, value: known(values[active]) ? format(values[active] as number) : '—', strong: true },
                    ...(reference ? [{ key: 'reference', mark: 'line' as const, color: 'var(--mui-palette-text-primary)', label: text.reference, value: format(reference[active]) }] : []),
                  ]
            }
            notes={[rowsFor && reference ? `${text.reference}: ${format(reference[active])}` : null, extra, inPeak(active) ? text.inPeak : null]}
          />
        </ChartTooltip>
      ) : null}
    </Box>
  )
}
