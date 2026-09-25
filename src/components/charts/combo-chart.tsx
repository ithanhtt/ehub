'use client'

import { useId, useState } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { known, niceTicks, roundedTop, useChartPointer, useTweened, useWidth } from './chart-kit'
import { ChartTooltip, TipContent } from './chart-tooltip'

/**
 * A source's money and its orders in one chart: lines for amounts, columns for counts.
 *
 * The lines (GMV, spend) are read against the ₫ axis on the left, the
 * columns (orders) against the order axis on the right. The two axes share
 * the gridlines — the right one takes as many steps as the left, each a round
 * number of orders — and it is stretched so the columns top out around 60% of
 * the height, leaving the upper part to the lines. Where a line crosses a
 * column top means nothing; each mark is read only against its own axis. A
 * column can hold a part of itself drawn from the baseline — the cancelled
 * among the orders created. With every line switched off, the columns take
 * the whole height and only the order axis remains.
 *
 * One crosshair: pointing at a position highlights its column and lists every
 * figure there; the arrow keys do the same. Figures appear only there, so the
 * chart at rest stays clean. The legend chips switch lines and
 * columns on and off, and turn on the previous period — dashed lines, and a
 * tick across each column at the previous count. Lines and columns ease to new
 * data; reduced motion skips the easing.
 */

export type ComboLine = {
  key: string
  label: string
  /** A CSS color, normally one of the --adshub-series-* tokens. */
  color: string
  values: Array<number | null>
  /** The previous period, lined up with `values` position by position. */
  previous: Array<number | null>
}

export type ComboBars = {
  key: string
  label: string
  color: string
  values: Array<number | null>
  previous: Array<number | null>
  /** A part of each column (the cancelled of the created), drawn from the baseline in its own color. */
  part?: { key: string; label: string; color: string; values: Array<number | null> }
  /** Positions whose column gathers several periods not broken down yet (TikTok's lagging hours). */
  lumped?: boolean[]
}

const MARGIN = { top: 24, right: 16, bottom: 26, left: 52 }
/** With lines on screen, the order axis is stretched so columns reach at most about this share of the height. */
const BAR_SHARE = 0.6
/** The surface gap between the two parts of a column. */
const GAP = 2

/**
 * Ticks for the order axis on the gridlines of the money axis: `intervals`
 * equal steps, each a round whole number of orders (1, 2, 2.5 or 5 × 10ⁿ —
 * 2.5 only where it stays whole, as 25 or 250), reaching past `max / share` so
 * the tallest column stays below that share of the height without the axis
 * overshooting far past it.
 */
function alignedTicks(max: number, intervals: number, share: number): number[] {
  const rough = Math.max(max / share, 1) / intervals
  const power = 10 ** Math.floor(Math.log10(rough))
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * power).filter((s) => Number.isInteger(s))
  const step = Math.max(1, steps.find((s) => s >= rough) ?? 10 * power)
  return Array.from({ length: intervals + 1 }, (_, i) => i * step)
}

function lastIndex(values: Array<number | null>) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i
  return -1
}

export function ComboChart({
  labels,
  pointLabels,
  lines,
  bars,
  connectGaps = false,
  height = 250,
  formats,
  text,
  ariaLabel,
  hidden: hiddenProp,
  onHiddenChange,
  compare: compareProp,
  onCompareChange,
}: {
  /** Short x labels, one per position. */
  labels: string[]
  /** The fuller label of each position, for the tooltip ("To 14:00", "Mon 08/09"). */
  pointLabels: string[]
  lines: ComboLine[]
  bars: ComboBars | null
  /**
   * Draw lines straight across null positions — for running totals, where
   * joining two known totals claims nothing about the positions between.
   */
  connectGaps?: boolean
  /** Plot height; the axis bands are added on top. */
  height?: number
  formats: {
    /** Exact, for the tooltip. */
    moneyExact: (value: number) => string
    count: (value: number) => string
    tick: (value: number) => string
  }
  /** `current` and `previous` head the tooltip's two columns when comparing ("Today" / "Yesterday"). */
  text: { compare: string; current: string; previous: string; toggle: string; unitMoney: string; unitCount: string; lumped: string }
  ariaLabel: string
  /** The series switched off — held by the caller when passed, to share it (card and dialog) or remember it. */
  hidden?: string[]
  onHiddenChange?: (hidden: string[]) => void
  /** Whether the previous period is drawn beside, the same way. */
  compare?: boolean
  onCompareChange?: (compare: boolean) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const hatch = `combo-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  // Kept here unless the caller holds them.
  const [ownHidden, setOwnHidden] = useState<string[]>([])
  const [ownCompare, setOwnCompare] = useState(false)
  const [pointed, setActive] = useState<number | null>(null)
  const chosenHidden = hiddenProp ?? ownHidden
  const compare = compareProp ?? ownCompare

  const count = labels.length
  const active = pointed !== null && pointed < count ? pointed : null
  // A saved choice that would leave nothing on screen shows everything instead.
  const keys = [...lines.map((line) => line.key), ...(bars ? [bars.key] : [])]
  const hidden = keys.every((key) => chosenHidden.includes(key)) ? [] : chosenHidden
  const shownLines = lines.filter((line) => !hidden.includes(line.key))
  const columns = bars && !hidden.includes(bars.key) ? bars : null
  const visibleCount = shownLines.length + (columns ? 1 : 0)
  const toggle = (key: string) => {
    const next = hidden.includes(key)
      ? hidden.filter((k) => k !== key)
      : // Keep at least one series on screen.
        visibleCount > 1
        ? [...hidden, key]
        : hidden
    setOwnHidden(next)
    onHiddenChange?.(next)
  }
  const hasPrevious = [...lines.map((l) => l.previous), ...(bars ? [bars.previous] : [])].some((values) =>
    values.some(known),
  )
  const comparing = compare && hasPrevious

  const finite = (values: Array<number | null>) => values.filter(known)
  const lineMax = Math.max(0, ...shownLines.flatMap((l) => finite(comparing ? [...l.values, ...l.previous] : l.values)))
  const barMax = columns
    ? Math.max(0, ...finite(comparing ? [...columns.values, ...columns.previous] : columns.values))
    : 0
  // Money on the left, orders on the right, on shared gridlines.
  const moneyTicks = shownLines.length > 0 ? niceTicks(lineMax) : null
  const orderTicks = columns
    ? alignedTicks(barMax, moneyTicks ? moneyTicks.length - 1 : 4, moneyTicks ? BAR_SHARE : 1)
    : null
  const intervals = (moneyTicks ?? orderTicks ?? [0, 1]).length - 1
  const axisTop = moneyTicks ? moneyTicks[intervals] || 1 : 1
  const orderTop = orderTicks ? orderTicks[intervals] || 1 : 1

  // Marks ease towards the new data; labels and the tooltip use the exact figures.
  const frame = useTweened(
    [
      ...shownLines.map((l) => ({ key: `line:${l.key}`, values: l.values })),
      ...(comparing ? shownLines.map((l) => ({ key: `previous:${l.key}`, values: l.previous })) : []),
      ...(columns ? [{ key: 'bar', values: columns.values }] : []),
      ...(columns?.part ? [{ key: 'part', values: columns.part.values }] : []),
      ...(columns && comparing ? [{ key: 'bar-previous', values: columns.previous }] : []),
    ],
    [axisTop, orderTop],
  )
  const eased = (key: string) => frame.tracks.find((t) => t.key === key)?.values ?? []
  const top = frame.tops[0] || 1
  const barTop = frame.tops[1] || 1

  // Room on the right for the order axis while columns are on screen.
  const margin = { ...MARGIN, right: columns ? 48 : MARGIN.right }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const innerH = height
  const base = margin.top + innerH
  const step = count > 0 ? innerW / count : innerW
  const cx = (i: number) => margin.left + step * (i + 0.5)
  const y = (v: number) => base - (v / top) * innerH
  const yBar = (v: number) => base - (v / barTop) * innerH
  const barW = Math.max(2, Math.min(28, step * 0.62))

  // Keep x labels apart: roughly one per 56px, always including the last.
  const every = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(innerW / 56))))
  const shownLabel = (i: number) => i === count - 1 || (i % every === 0 && count - 1 - i >= every / 2)

  const pathFor = (values: Array<number | null>) => {
    let d = ''
    let pen = false
    values.forEach((v, i) => {
      if (!known(v) || !Number.isFinite(v)) {
        // A gap breaks the line, unless the chart joins known points across it.
        if (!connectGaps) pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  const nearest = (clientX: number, rect: DOMRect) => {
    if (count === 0 || step <= 0) return null
    const px = clientX - rect.left - margin.left
    return Math.min(count - 1, Math.max(0, Math.floor(px / step)))
  }

  const svgHeight = margin.top + innerH + margin.bottom
  const tooltipLeft = active === null ? 0 : cx(active)
  const pointer = useChartPointer<number>(setActive, (event) => nearest(event.clientX, event.currentTarget.getBoundingClientRect()), () => setActive(count - 1))
  const read = (value: number | null | undefined, format: (v: number) => string) => (known(value) ? format(value) : '—')

  return (
    <Box>
      {/* The legend, doubling as switches; identity is the mark's shape and color, never color alone. */}
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 1 }}>
        {lines.map((line) => (
          <LegendChip
            key={line.key}
            on={!hidden.includes(line.key)}
            mark="line"
            color={line.color}
            label={line.label}
            title={text.toggle}
            onClick={() => toggle(line.key)}
          />
        ))}
        {bars ? (
          <LegendChip
            on={columns !== null}
            mark="bar"
            color={bars.color}
            label={bars.label}
            title={text.toggle}
            onClick={() => toggle(bars.key)}
          />
        ) : null}
        {bars?.part && columns ? (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', px: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: bars.part.color }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
              {bars.part.label}
            </Typography>
          </Stack>
        ) : null}
        {hasPrevious ? (
          <LegendChip
            on={compare}
            mark="dashed"
            color="var(--mui-palette-text-secondary)"
            label={text.compare}
            onClick={() => {
              setOwnCompare(!compare)
              onCompareChange?.(!compare)
            }}
          />
        ) : null}
      </Stack>

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
              if (event.key === 'ArrowLeft') setActive(Math.max(0, (active ?? count - 1) - 1))
              if (event.key === 'ArrowRight') setActive(Math.min(count - 1, (active ?? 0) + 1))
            }}
          >
            <defs>
              {/* 45° hatching: a column that gathers hours not broken down yet. */}
              <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={6} height={6} fill={bars?.color ?? 'transparent'} fillOpacity={0.25} />
                <line x1={0} y1={0} x2={0} y2={6} stroke={bars?.color ?? 'transparent'} strokeWidth={3} />
              </pattern>
            </defs>

            {/* Each axis names its unit; the order axis also shows the column key, so it is plain which marks it measures. */}
            {moneyTicks ? (
              <text x={margin.left - 8} y={margin.top - 10} textAnchor="end" fontSize={11} fill="var(--mui-palette-text-disabled)">
                {text.unitMoney}
              </text>
            ) : null}
            {orderTicks && columns ? (
              <g>
                <rect x={width - margin.right + 8} y={margin.top - 18} width={8} height={8} rx={2} fill={columns.color} />
                <text x={width - margin.right + 20} y={margin.top - 10} fontSize={11} fill="var(--mui-palette-text-disabled)">
                  {text.unitCount}
                </text>
              </g>
            ) : null}

            {/* Hairline solid grid shared by both axes; tabular figures so each column of ticks aligns. */}
            {Array.from({ length: intervals + 1 }, (_, k) => {
              const gy = base - (k / intervals) * innerH
              return (
                <g key={k}>
                  <line
                    x1={margin.left}
                    x2={width - margin.right}
                    y1={gy}
                    y2={gy}
                    stroke="var(--mui-palette-divider)"
                    strokeWidth={1}
                  />
                  {moneyTicks ? (
                    <text
                      x={margin.left - 8}
                      y={gy}
                      dy="0.32em"
                      textAnchor="end"
                      fontSize={11}
                      fill="var(--mui-palette-text-disabled)"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formats.tick(moneyTicks[k])}
                    </text>
                  ) : null}
                  {orderTicks ? (
                    <text
                      x={width - margin.right + 8}
                      y={gy}
                      dy="0.32em"
                      textAnchor="start"
                      fontSize={11}
                      fill="var(--mui-palette-text-disabled)"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formats.tick(orderTicks[k])}
                    </text>
                  ) : null}
                </g>
              )
            })}

            {labels.map((label, i) =>
              shownLabel(i) ? (
                <text
                  key={`${label}-${i}`}
                  x={cx(i)}
                  y={base + 18}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--mui-palette-text-disabled)"
                >
                  {label}
                </text>
              ) : null,
            )}

            {/* The pointed-at position, as a band under everything. */}
            {active !== null ? (
              <rect
                x={margin.left + step * active}
                y={margin.top}
                width={step}
                height={innerH}
                fill="var(--mui-palette-action-hover)"
              />
            ) : null}

            {columns
              ? eased('bar').map((v, i) => {
                  if (!known(v) || v <= 0) return null
                  const x0 = cx(i) - barW / 2
                  const partValue = columns.part ? Math.min(v, Math.max(0, eased('part')[i] ?? 0)) : 0
                  const partH = (partValue / barTop) * innerH
                  const topY = yBar(v)
                  const mainH = base - topY - (partH > 0 ? partH + GAP : 0)
                  const lumped = columns.lumped?.[i] ?? false
                  return (
                    <g key={`bar-${i}`} opacity={active !== null && active !== i ? 0.45 : 1}>
                      {partH > 0 && columns.part ? (
                        <path d={roundedTop(x0, base - partH, barW, partH, mainH > 0.5 ? 0 : 4)} fill={columns.part.color} />
                      ) : null}
                      {mainH > 0.5 ? (
                        <path
                          d={roundedTop(x0, topY, barW, mainH, 4)}
                          fill={lumped ? `url(#${hatch})` : columns.color}
                          stroke={lumped ? columns.color : 'none'}
                          strokeWidth={lumped ? 1 : 0}
                        />
                      ) : null}
                    </g>
                  )
                })
              : null}

            {/* The previous period's count: a tick across each column, in ink over a surface halo. */}
            {columns && comparing
              ? eased('bar-previous').map((v, i) => {
                  if (!known(v) || v <= 0) return null
                  const ty = yBar(v)
                  const x1 = cx(i) - barW / 2 - 3
                  const x2 = cx(i) + barW / 2 + 3
                  return (
                    <g key={`bar-previous-${i}`} opacity={active !== null && active !== i ? 0.45 : 1}>
                      <line x1={x1} x2={x2} y1={ty} y2={ty} stroke="var(--mui-palette-background-paper)" strokeWidth={4} />
                      <line x1={x1} x2={x2} y1={ty} y2={ty} stroke="var(--mui-palette-text-primary)" strokeWidth={2} />
                    </g>
                  )
                })
              : null}

            {comparing
              ? shownLines.map((line) => (
                  <path
                    key={`previous-${line.key}`}
                    d={pathFor(eased(`previous:${line.key}`))}
                    fill="none"
                    stroke={line.color}
                    strokeWidth={1.5}
                    strokeOpacity={0.6}
                    strokeDasharray="4 4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))
              : null}

            {/* Lines over the columns, each on a surface halo so it stays legible where it crosses one. */}
            {shownLines.map((line) => {
              const d = pathFor(eased(`line:${line.key}`))
              return (
                <g key={`line-${line.key}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--mui-palette-background-paper)"
                    strokeWidth={5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <path d={d} fill="none" stroke={line.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              )
            })}

            {active === null
              ? shownLines.map((line) => {
                  const values = eased(`line:${line.key}`)
                  const i = lastIndex(line.values)
                  const v = i >= 0 ? values[i] : null
                  return known(v) ? (
                    <circle
                      key={`end-${line.key}`}
                      cx={cx(i)}
                      cy={y(v)}
                      r={4}
                      fill={line.color}
                      stroke="var(--mui-palette-background-paper)"
                      strokeWidth={2}
                    />
                  ) : null
                })
              : null}

            {active !== null ? (
              <g pointerEvents="none">
                {shownLines.map((line) => {
                  const v = eased(`line:${line.key}`)[active]
                  const before = comparing ? eased(`previous:${line.key}`)[active] : null
                  return (
                    <g key={`hover-${line.key}`}>
                      {known(before) ? (
                        <circle cx={cx(active)} cy={y(before)} r={3} fill={line.color} fillOpacity={0.6} />
                      ) : null}
                      {known(v) ? (
                        <circle
                          cx={cx(active)}
                          cy={y(v)}
                          r={4}
                          fill={line.color}
                          stroke="var(--mui-palette-background-paper)"
                          strokeWidth={2}
                        />
                      ) : null}
                    </g>
                  )
                })}
              </g>
            ) : null}
          </svg>
        ) : null}

        {active !== null && width > 0 ? (
          <ChartTooltip x={tooltipLeft} gap={step / 2 + 8} chartWidth={width} width={comparing ? 250 : 200}>
            {/* Money lines, then the order columns; comparing, the period before in its own column. */}
            <TipContent
              title={pointLabels[active]}
              currentLabel={text.current}
              previousLabel={comparing ? text.previous : undefined}
              rows={[
                ...shownLines.map((line) => ({
                  key: line.key,
                  mark: 'line' as const,
                  color: line.color,
                  label: line.label,
                  value: read(line.values[active], formats.moneyExact),
                  previous: comparing ? read(line.previous[active], formats.moneyExact) : undefined,
                })),
                ...(columns
                  ? [
                      {
                        key: columns.key,
                        mark: 'bar' as const,
                        color: columns.color,
                        label: columns.label,
                        value: read(columns.values[active], formats.count),
                        previous: comparing ? read(columns.previous[active], formats.count) : undefined,
                      },
                      ...(columns.part
                        ? [{ key: `${columns.key}-part`, mark: 'bar' as const, color: columns.part.color, label: columns.part.label, value: read(columns.part.values[active], formats.count) }]
                        : []),
                    ]
                  : []),
              ]}
              notes={[columns?.lumped?.[active] ? text.lumped : null]}
            />
          </ChartTooltip>
        ) : null}
      </Box>
    </Box>
  )
}

/** A legend entry that switches its series on and off; its key mirrors the mark. */
function LegendChip({
  on,
  mark,
  color,
  label,
  title,
  onClick,
}: {
  on: boolean
  mark: 'line' | 'bar' | 'dashed'
  color: string
  label: string
  title?: string
  onClick: () => void
}) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={on}
      title={title}
      sx={{
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: 999,
        border: `1px ${mark === 'dashed' ? 'dashed' : 'solid'}`,
        borderColor: on ? (mark === 'dashed' ? 'text.secondary' : 'divider') : 'divider',
        backgroundColor: on ? (mark === 'dashed' ? 'action.selected' : 'transparent') : 'transparent',
        opacity: on || mark === 'dashed' ? 1 : 0.5,
        transition: 'opacity .15s, border-color .15s, background-color .15s',
        '&:hover': { borderColor: 'text.disabled' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      {mark === 'bar' ? (
        <Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: on ? color : 'text.disabled' }} />
      ) : (
        <Box
          sx={{
            width: 14,
            height: 0,
            borderTop: `${mark === 'dashed' ? 2 : 3}px ${mark === 'dashed' ? 'dashed' : 'solid'}`,
            borderColor: on || mark === 'dashed' ? color : 'text.disabled',
          }}
        />
      )}
      <Typography
        variant="caption"
        sx={{ fontWeight: 600, color: on && mark === 'dashed' ? 'text.primary' : 'text.secondary' }}
      >
        {label}
      </Typography>
    </ButtonBase>
  )
}
