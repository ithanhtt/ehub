'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import { niceTicks, useChartPointer, useWidth } from './chart-kit'
import { ChartTooltip, TipContent } from './chart-tooltip'

/**
 * Two measures against each other, one dot per day or month — how a
 * relationship ("more booked videos, more GMV?") is seen rather than asserted.
 *
 * One series, one color; each axis names its own measure on its own scale, so
 * nothing is read against the wrong axis. The least-squares line runs in
 * secondary ink behind the dots, only when there are enough of them to mean
 * something (the card states r beside it). Dots are 8px with a surface ring,
 * slightly translucent so stacked days still show as darker. Figures appear
 * on hover, or with the arrow keys stepping through the points in time order.
 */

export type ScatterPoint = { key: string; label: string; x: number; y: number }

const MARGIN = { top: 20, right: 16, bottom: 40, left: 56 }
const MIN_FOR_LINE = 5
const HIT_RADIUS = 18

export function ScatterChart({
  points,
  color,
  height = 240,
  xLabel,
  yLabel,
  formatX,
  formatY,
  tickX,
  tickY,
  ariaLabel,
}: {
  points: ScatterPoint[]
  color: string
  height?: number
  xLabel: string
  yLabel: string
  formatX: (value: number) => string
  formatY: (value: number) => string
  tickX: (value: number) => string
  tickY: (value: number) => string
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const xTicks = niceTicks(Math.max(0, ...points.map((p) => p.x)))
  const yTicks = niceTicks(Math.max(0, ...points.map((p) => p.y)))
  const xTop = xTicks[xTicks.length - 1] || 1
  const yTop = yTicks[yTicks.length - 1] || 1
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const base = MARGIN.top + height
  const sx = (v: number) => MARGIN.left + (v / xTop) * innerW
  const sy = (v: number) => base - (v / yTop) * height

  // The least-squares line, clipped to the plotted range.
  let line: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (points.length >= MIN_FOR_LINE) {
    const n = points.length
    const mx = points.reduce((s, p) => s + p.x, 0) / n
    const my = points.reduce((s, p) => s + p.y, 0) / n
    const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
    if (sxx > 0) {
      const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx
      const at = (x: number) => Math.max(0, Math.min(yTop, my + slope * (x - mx)))
      const x0 = Math.min(...points.map((p) => p.x))
      const x1 = Math.max(...points.map((p) => p.x))
      line = { x1: sx(x0), y1: sy(at(x0)), x2: sx(x1), y2: sy(at(x1)) }
    }
  }

  const nearest = (clientX: number, clientY: number, rect: DOMRect) => {
    let best: number | null = null
    let bestDistance = HIT_RADIUS
    points.forEach((p, i) => {
      const d = Math.hypot(sx(p.x) - (clientX - rect.left), sy(p.y) - (clientY - rect.top))
      if (d <= bestDistance) {
        best = i
        bestDistance = d
      }
    })
    return best
  }

  const svgHeight = base + MARGIN.bottom
  const point = active !== null ? points[active] : null
  const tipX = point ? sx(point.x) : 0
  // Mouse: the point nearest the pointer while it hovers; touch: the one tapped, until the next tap.
  const pointer = useChartPointer(setActive, (event) => nearest(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()))

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
            if (points.length === 0) return
            if (event.key === 'ArrowRight') setActive(Math.min(points.length - 1, (active ?? -1) + 1))
            if (event.key === 'ArrowLeft') setActive(Math.max(0, (active ?? points.length) - 1))
          }}
        >
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(tick)} y2={sy(tick)} stroke="var(--mui-palette-divider)" strokeWidth={1} />
              <text
                x={MARGIN.left - 8}
                y={sy(tick)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--mui-palette-text-disabled)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {tickY(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text
              key={`x-${tick}`}
              x={sx(tick)}
              y={base + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--mui-palette-text-disabled)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {tickX(tick)}
            </text>
          ))}
          <text x={MARGIN.left} y={MARGIN.top - 8} fontSize={11} fill="var(--mui-palette-text-secondary)">
            {yLabel}
          </text>
          <text x={width - MARGIN.right} y={base + 34} textAnchor="end" fontSize={11} fill="var(--mui-palette-text-secondary)">
            {xLabel}
          </text>

          {line ? (
            <line
              {...line}
              stroke="var(--mui-palette-text-secondary)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
          ) : null}

          {points.map((p, i) => (
            <circle
              key={p.key}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={active === i ? 6 : 4.5}
              fill={color}
              fillOpacity={active === null || active === i ? 0.85 : 0.35}
              stroke="var(--mui-palette-background-paper)"
              strokeWidth={2}
            />
          ))}
        </svg>
      ) : null}

      {point && width > 0 ? (
        // Beside the point, level with it but kept inside the chart's height.
        <ChartTooltip x={tipX} gap={12} chartWidth={width} width={180} top={Math.min(Math.max(0, sy(point.y) - 40), Math.max(0, svgHeight - 96))}>
          <TipContent
            title={point.label}
            rows={[
              { key: 'x', label: xLabel, value: formatX(point.x) },
              { key: 'y', label: yLabel, value: formatY(point.y) },
            ]}
          />
        </ChartTooltip>
      ) : null}
    </Box>
  )
}
