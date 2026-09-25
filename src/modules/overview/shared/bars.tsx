'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import BarChartOutlined from '@mui/icons-material/BarChartOutlined'
import TableRowsOutlined from '@mui/icons-material/TableRowsOutlined'
import { CellTips } from '@/components/charts/cell-tips'

/**
 * The small, plain charts the product cards read at a glance — drawn with
 * boxes, not SVG, so they size with their text, wrap on a phone and need no
 * measuring:
 *
 *   - ShareBar: one bar split into parts (the top five against the rest; the
 *     products with an order against the quiet ones), with its legend;
 *   - BarList: a ranked list of bars, each a label over its bar and the figure
 *     beside it, the bar split into parts where they mean something (kept and
 *     cancelled orders), the whole story of a row on hover;
 *   - StatRow: a few figures side by side, each named;
 *   - ViewToggle: chart or table, for a card's full view.
 */

export type Segment = { key: string; label: string; value: number; color: string; tip?: ReactNode }

const EASE = { transition: 'width .6s cubic-bezier(0.22, 1, 0.36, 1)', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } } as const

/** One bar split into its parts, each as wide as its share of the whole. */
export function ShareBar({ segments, height = 12, legend = true, format }: { segments: Segment[]; height?: number; legend?: boolean; format?: (value: number) => string }) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  const shown = segments.filter((s) => s.value > 0)
  return (
    <Box>
      <Box sx={{ display: 'flex', gap: '2px', height, borderRadius: 999, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {total > 0
          ? shown.map((s) => (
              <Tooltip key={s.key} title={s.tip ?? `${s.label}: ${format ? format(s.value) : s.value} (${Math.round((s.value / total) * 100)}%)`}>
                <Box sx={{ ...EASE, width: `${(s.value / total) * 100}%`, minWidth: 3, bgcolor: s.color }} />
              </Tooltip>
            ))
          : null}
      </Box>
      {legend ? (
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', columnGap: 1.75, rowGap: 0.5, mt: 1 }}>
          {segments.map((s) => (
            <Stack key={s.key} direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: s.color, flexShrink: 0 }} />
              <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {s.label}{' '}
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {format ? format(s.value) : s.value}
                </Box>
                {total > 0 ? ` · ${Math.round((s.value / total) * 100)}%` : ''}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}

export type BarRow = {
  key: string
  label: ReactNode
  /** The figure written beside the bar. */
  valueText: string
  /** A line under the label: share, cumulative, the reason it is listed. */
  sub?: ReactNode
  /** The bar's parts, in order; their sum is the bar's length against `max`. */
  parts: Array<{ value: number; color: string }>
  /** Everything about the row, on hover. */
  tip?: ReactNode
  /** Set apart (bold label): a row worth a look. */
  strong?: boolean
}

/** Ranked bars: a label over each, the figure beside it, one hover card for the list. */
export function BarList({ rows, max, rank = false }: { rows: BarRow[]; max?: number; rank?: boolean }) {
  const top = max ?? Math.max(0, ...rows.map((row) => row.parts.reduce((sum, p) => sum + p.value, 0)))
  return (
    <CellTips render={(key) => rows[Number(key)]?.tip ?? null}>
      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', rowGap: 1.25 }}>
        {rows.map((row, i) => {
          const length = row.parts.reduce((sum, p) => sum + p.value, 0)
          return (
            <Box component="li" key={row.key} data-tip={row.tip ? i : undefined} sx={{ cursor: row.tip ? 'default' : undefined }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
                {rank ? (
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 700, width: 18, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {i + 1}
                  </Typography>
                ) : null}
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: row.strong ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.label}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {row.valueText}
                </Typography>
              </Stack>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: rank ? 3.25 : 0 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ ...EASE, display: 'flex', height: 8, mt: 0.5, borderRadius: 999, overflow: 'hidden', width: top > 0 ? `${Math.max(1.5, (length / top) * 100)}%` : '0%' }}>
                    {row.parts.map((part, k) =>
                      part.value > 0 ? <Box key={k} sx={{ width: `${(part.value / (length || 1)) * 100}%`, bgcolor: part.color }} /> : null,
                    )}
                  </Box>
                  {row.sub ? (
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.sub}
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    </CellTips>
  )
}

/** A few figures side by side, each over its name; two by two on a phone. */
export function StatRow({ items }: { items: Array<{ key: string; label: string; value: string; note?: string; tone?: string }> }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: `repeat(${Math.min(4, items.length)}, minmax(0, 1fr))` }, gap: 1.5 }}>
      {items.map((item) => (
        <Box key={item.key} sx={{ p: 1.5, borderRadius: 2, border: '1px dashed var(--adshub-dashed)', minWidth: 0 }}>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.35 }}>
            {item.label}
          </Typography>
          <Typography variant="h6" component="p" sx={{ fontWeight: 700, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', color: item.tone ?? 'text.primary' }}>
            {item.value}
          </Typography>
          {item.note ? (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.35 }}>
              {item.note}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

/** The legend of a BarList's parts. */
export function PartsLegend({ parts }: { parts: Array<{ label: string; color: string }> }) {
  return (
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', columnGap: 1.75, rowGap: 0.5 }}>
      {parts.map((part) => (
        <Stack key={part.label} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: part.color }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {part.label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}

export type DetailView = 'chart' | 'table'
export const acceptView = (value: unknown): DetailView | null => (value === 'chart' || value === 'table' ? value : null)

/** Chart or table, for a card's full view. */
export function ViewToggle({ view, onChange }: { view: DetailView; onChange: (view: DetailView) => void }) {
  const t = useTranslations('dashboard')
  const sx = { px: 1.25, py: 0.25, gap: 0.5, textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' } as const
  return (
    <ToggleButtonGroup exclusive size="small" value={view} onChange={(_event, next: DetailView | null) => next && onChange(next)} aria-label={t('viewAs')}>
      <ToggleButton value="chart" sx={sx}>
        <BarChartOutlined sx={{ fontSize: 16 }} />
        {t('viewChart')}
      </ToggleButton>
      <ToggleButton value="table" sx={sx}>
        <TableRowsOutlined sx={{ fontSize: 16 }} />
        {t('viewTable')}
      </ToggleButton>
    </ToggleButtonGroup>
  )
}
