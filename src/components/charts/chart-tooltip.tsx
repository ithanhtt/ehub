'use client'

import { Fragment, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { tipPlacement } from './chart-kit'

/**
 * One look for every figure read on hover — a chart's point, a table cell,
 * a product's details — so that reading any of them works the same way:
 *
 *   - a title on top, bold: the hour, the day, the product;
 *   - then the figures as a small table: the series' mark and name on the
 *     left, the figure right-aligned in its own column, so the numbers line
 *     up and are read top to bottom at a glance; comparing, the period before
 *     sits in a second, quieter column under a heading of its own rather than
 *     a line under every figure;
 *   - notes last, short, under a faint rule ("hour in progress", "peak").
 *
 * The chart tooltips float over the chart on the side with room (ChartTooltip);
 * the same content goes in MUI's Tooltip, whose look the theme matches.
 */

export type TipMark = 'line' | 'bar' | 'dashed' | 'dot' | 'none'

export type TipRow = {
  key: string
  label: ReactNode
  value: ReactNode
  /** The period before, when comparing (TipRows' `previousLabel` names the column). */
  previous?: ReactNode
  mark?: TipMark
  color?: string
  /** Set apart as the row that matters most (bold label). */
  strong?: boolean
}

/** The surface every hover card shares — the theme's Tooltip uses the same. */
export const TIP_SURFACE = {
  px: 1.5,
  py: 1,
  borderRadius: 2,
  color: 'text.primary',
  backgroundColor: 'var(--adshub-surface-floating)',
  boxShadow: '0 12px 32px -18px rgb(0 0 0 / 0.45), 0 0 0 1px var(--mui-palette-divider)',
  backdropFilter: 'blur(12px)',
} as const

/**
 * A chart's floating tooltip beside the point at `x`, on the side with room
 * (tipPlacement), never wider than the chart, never catching the pointer.
 */
export function ChartTooltip({ x, gap, chartWidth, width = 200, top = 4, children }: { x: number; gap: number; chartWidth: number; width?: number; top?: number; children: ReactNode }) {
  return (
    <Box
      role="status"
      sx={{
        ...TIP_SURFACE,
        position: 'absolute',
        top,
        ...tipPlacement(x, gap, chartWidth, width),
        minWidth: Math.min(width, chartWidth - 8),
        maxWidth: Math.max(width, Math.min(320, chartWidth - 8)),
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {children}
    </Box>
  )
}

/** The tooltip's heading, with an optional tag beside it (e.g. "in progress"). */
export function TipTitle({ children, tag }: { children: ReactNode; tag?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
      <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3, minWidth: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
      {tag ? (
        <Typography
          component="span"
          variant="caption"
          sx={{ ml: 'auto', flexShrink: 0, px: 0.75, borderRadius: 999, bgcolor: 'action.selected', color: 'text.secondary', fontWeight: 600, lineHeight: 1.6 }}
        >
          {tag}
        </Typography>
      ) : null}
    </Box>
  )
}

function Mark({ mark = 'none', color }: { mark?: TipMark; color?: string }) {
  if (mark === 'none' || !color) return <Box />
  if (mark === 'bar') return <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: color, justifySelf: 'center' }} />
  if (mark === 'dot') return <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, justifySelf: 'center' }} />
  return <Box sx={{ width: 12, height: 0, borderTop: `2px ${mark === 'dashed' ? 'dashed' : 'solid'}`, borderColor: color, justifySelf: 'center' }} />
}

/**
 * The figures, a row each: mark, name, figure — and, given `previousLabel`,
 * the period before in a column of its own, headed "this period / before".
 */
export function TipRows({ rows, currentLabel, previousLabel }: { rows: TipRow[]; currentLabel?: string; previousLabel?: string }) {
  const comparing = Boolean(previousLabel) && rows.some((row) => row.previous !== undefined)
  const hasMarks = rows.some((row) => row.mark && row.mark !== 'none')
  const columns = [hasMarks ? '14px' : null, 'minmax(0, 1fr)', 'auto', comparing ? 'auto' : null].filter(Boolean).join(' ')
  const head = { color: 'text.disabled', fontSize: 11, fontWeight: 600, textAlign: 'right', lineHeight: 1.4 } as const
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 1.25, rowGap: 0.5, alignItems: 'center' }}>
      {comparing ? (
        <>
          {hasMarks ? <Box /> : null}
          <Box />
          <Typography sx={head}>{currentLabel}</Typography>
          <Typography sx={head}>{previousLabel}</Typography>
        </>
      ) : null}
      {rows.map((row) => (
        <Fragment key={row.key}>
          {hasMarks ? <Mark mark={row.mark} color={row.color} /> : null}
          <Typography variant="caption" sx={{ color: row.strong ? 'text.primary' : 'text.secondary', fontWeight: row.strong ? 700 : 400, lineHeight: 1.35, minWidth: 0 }}>
            {row.label}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
            {row.value}
          </Typography>
          {comparing ? (
            <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {row.previous ?? ''}
            </Typography>
          ) : null}
        </Fragment>
      ))}
    </Box>
  )
}

/** Short notes under the figures, set off by a faint rule. */
export function TipNotes({ notes }: { notes: Array<ReactNode | null | false | undefined> }) {
  const shown = notes.filter(Boolean)
  if (shown.length === 0) return null
  return (
    <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px dashed var(--adshub-dashed, rgba(128,128,128,.3))' }}>
      {shown.map((note, i) => (
        <Typography key={i} variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.4 }}>
          {note}
        </Typography>
      ))}
    </Box>
  )
}

/** Title, figures and notes together — the content of a hover card anywhere (MUI Tooltip's `title`, or ChartTooltip). */
export function TipContent({
  title,
  tag,
  rows,
  notes,
  currentLabel,
  previousLabel,
}: {
  title?: ReactNode
  tag?: ReactNode
  rows: TipRow[]
  notes?: Array<ReactNode | null | false | undefined>
  currentLabel?: string
  previousLabel?: string
}) {
  return (
    <>
      {title ? <TipTitle tag={tag}>{title}</TipTitle> : null}
      <TipRows rows={rows} currentLabel={currentLabel} previousLabel={previousLabel} />
      {notes ? <TipNotes notes={notes} /> : null}
    </>
  )
}
