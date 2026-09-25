'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { SortableTable, type TableSort, type TableView } from '@/components/charts/chart-card'
import { ComboChart } from '@/components/charts/combo-chart'
import { ScatterChart } from '@/components/charts/scatter-chart'
import { SyncChip } from '@/components/charts/sync-chip'
import { DetailsDialog, ExpandableChartCard, InsightCard } from '@/modules/overview/shared/insight-card'
import { useReport } from '../context'
import type { ReportSource } from '../types'
import { useBucketLabels, useReportFigures, useTrendText } from './format'
import { correlation, strengthOf } from './stats'

/**
 * The cards the report widgets are made of, so the four modules look and
 * behave as one: a trend over the period's buckets, a relationship between two
 * measures, a ranked table — each with the expand icon, and a "syncing" chip
 * while a source it reads is still filling in days.
 */

/** Color follows the measure across the reports, as on the overview. */
export const SERIES = {
  blue: 'var(--adshub-series-1)',
  orange: 'var(--adshub-series-2)',
  aqua: 'var(--adshub-series-3)',
} as const

/** The "syncing" chip for a card reading `sources`, while any of them is still reading days. */
export function useSyncBadge(sources: ReportSource[]) {
  const t = useTranslations('reports')
  const { report } = useReport()
  const pending = sources.reduce((sum, source) => sum + (report.sources[source]?.pendingDays ?? 0), 0)
  return pending > 0 ? <SyncChip label={t('syncChip')} tip={t('syncTip', { count: pending })} /> : undefined
}

export type TrendSeries = { key: string; label: string; color: string; values: Array<number | null> }

/**
 * One measure per panel, over the period's buckets. Several panels in a card
 * share the time axis and stack — money in one, counts in another — rather
 * than sharing a plot with two scales that each mark would have to be read
 * against the right one of.
 */
export type TrendPanel = {
  kind: 'money' | 'count'
  /** The unit named over the axis ("₫", "video", "đơn"). */
  unit: string
  /** Columns: one series, optionally with a part of it drawn from the baseline. */
  bars?: TrendSeries & { part?: TrendSeries }
  /** Lines: up to three series. */
  lines?: TrendSeries[]
}

export function TrendCard({
  title,
  subtitle,
  badge,
  buckets,
  panels,
  table,
  action,
}: {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  buckets: string[]
  panels: TrendPanel[]
  table: TableView
  /** A control beside the table toggle (a product picker). */
  action?: React.ReactNode
}) {
  const t = useTranslations('reports')
  const { tick, full } = useBucketLabels()
  const { exact, count, compact } = useReportFigures()
  const trend = useTrendText()
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [sort, setSort] = useState<TableSort | null>(null)

  return (
    <ExpandableChartCard
      title={title}
      subtitle={subtitle}
      badge={badge}
      action={action}
      labels={trend.labels}
      expandLabel={t('expand')}
      closeLabel={t('close')}
      view={view}
      onViewChange={setView}
      sort={sort}
      onSortChange={setSort}
      table={table}
      render={(expanded) =>
        buckets.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 6, textAlign: 'center' }}>
            {t('noData')}
          </Typography>
        ) : (
          <Stack spacing={2}>
            {panels.map((panel, i) => (
              <ComboChart
                key={i}
                height={(expanded ? 360 : 180) / Math.max(1, panels.length > 1 ? 1.25 : 1)}
                labels={buckets.map(tick)}
                pointLabels={buckets.map(full)}
                lines={(panel.lines ?? []).map((line) => ({ ...line, previous: [] }))}
                bars={
                  panel.bars
                    ? {
                        key: panel.bars.key,
                        label: panel.bars.label,
                        color: panel.bars.color,
                        values: panel.bars.values,
                        previous: [],
                        part: panel.bars.part,
                      }
                    : null
                }
                formats={{ moneyExact: panel.kind === 'money' ? exact : count, count, tick: compact }}
                text={trend.text(panel.unit, panel.unit)}
                ariaLabel={`${title} — ${panel.unit}`}
              />
            ))}
          </Stack>
        )
      }
    />
  )
}

export type RelationPair = {
  key: string
  /** "Video booking ↔ GMV KOC". */
  label: string
  xLabel: string
  yLabel: string
  xKind: 'money' | 'count'
  yKind: 'money' | 'count'
  xs: Array<number | null>
  ys: Array<number | null>
}

/**
 * How two measures move together over the period: r, what it may be called,
 * and the scatter it comes from. Several pairs share a card, one on screen at
 * a time. Correlation is not cause — the card says so once, in its subtitle.
 */
export function RelationCard({
  title,
  subtitle,
  badge,
  buckets,
  pairs,
}: {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  buckets: string[]
  pairs: RelationPair[]
}) {
  const t = useTranslations('reports')
  const { full } = useBucketLabels()
  const { exact, money, count, compact, number } = useReportFigures()
  const [chosen, setChosen] = useState(pairs[0]?.key ?? '')
  const [open, setOpen] = useState(false)
  const pair = pairs.find((p) => p.key === chosen) ?? pairs[0]
  if (!pair) return null

  const { r, n } = correlation(pair.xs, pair.ys)
  const points = buckets.flatMap((at, i) => {
    const x = pair.xs[i]
    const y = pair.ys[i]
    return typeof x === 'number' && typeof y === 'number' ? [{ key: at, label: full(at), x, y }] : []
  })
  const format = (kind: 'money' | 'count') => (kind === 'money' ? exact : count)
  const strength = strengthOf(r)
  const verdict =
    r === null
      ? t('relationTooFew', { count: n })
      : t('relationVerdict', {
          r: number(r, 2),
          strength: t(`strength.${strength}`),
          direction: r >= 0 ? t('positive') : t('negative'),
          count: n,
        })

  const body = (expanded: boolean) => (
    <Stack spacing={1.5}>
      {pairs.length > 1 ? (
        <ToggleButtonGroup exclusive size="small" value={pair.key} onChange={(_e, next: string | null) => next && setChosen(next)} sx={{ flexWrap: 'wrap' }}>
          {pairs.map((p) => (
            <ToggleButton key={p.key} value={p.key} sx={{ textTransform: 'none', fontWeight: 600, px: 1.25, py: 0.25 }}>
              {p.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        {r !== null ? (
          <Chip
            size="small"
            label={`r = ${number(r, 2)}`}
            color={strength === 'strong' || strength === 'moderate' ? 'primary' : 'default'}
            variant={strength === 'strong' ? 'filled' : 'outlined'}
            sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
          />
        ) : null}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {verdict}
        </Typography>
      </Stack>
      <ScatterChart
        points={points}
        color={SERIES.blue}
        height={expanded ? 420 : 200}
        xLabel={pair.xLabel}
        yLabel={pair.yLabel}
        formatX={format(pair.xKind)}
        formatY={format(pair.yKind)}
        tickX={pair.xKind === 'money' ? compact : count}
        tickY={pair.yKind === 'money' ? compact : count}
        ariaLabel={`${pair.label}: ${verdict}`}
      />
      {expanded ? (
        <SortableTable
          table={{
            columns: [t('time'), pair.xLabel, pair.yLabel],
            rows: [...points].reverse().map((p) => [
              p.label,
              { text: pair.xKind === 'money' ? money(p.x) : count(p.x), sort: p.x },
              { text: pair.yKind === 'money' ? money(p.y) : count(p.y), sort: p.y },
            ]),
          }}
          sort={null}
          onSortChange={() => {}}
          maxHeight={320}
        />
      ) : null}
    </Stack>
  )

  return (
    <>
      <InsightCard title={title} subtitle={subtitle} badge={badge} expand={{ label: t('expand'), onClick: () => setOpen(true) }}>
        {body(false)}
      </InsightCard>
      <DetailsDialog open={open} onClose={() => setOpen(false)} title={title} closeLabel={t('close')}>
        {body(true)}
      </DetailsDialog>
    </>
  )
}

/**
 * A ranked table: the first rows in the card, all of them behind the expand
 * icon. Sortable by any figure column; rows come in already ranked.
 */
export function TableCard({
  title,
  subtitle,
  badge,
  table,
  empty,
  note,
  limit = 8,
}: {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  table: TableView
  /** Said when there are no rows. */
  empty: string
  /** A line under the table (what a column means, a caveat). */
  note?: string
  limit?: number
}) {
  const t = useTranslations('reports')
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<TableSort | null>(null)
  const glimpse = { ...table, rows: table.rows.slice(0, limit) }
  const content = (all: boolean) =>
    table.rows.length === 0 ? (
      <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
        {empty}
      </Typography>
    ) : (
      <Box sx={all ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : undefined}>
        <SortableTable table={all ? table : glimpse} sort={sort} onSortChange={setSort} maxHeight={all ? undefined : 360} fill={all} />
        {note ? (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', mt: 1 }}>
            {note}
          </Typography>
        ) : null}
        {!all && table.rows.length > limit ? (
          <Tooltip title={t('expand')}>
            <Typography
              variant="caption"
              role="button"
              tabIndex={0}
              onClick={() => setOpen(true)}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setOpen(true)}
              sx={{ display: 'block', mt: 1, color: 'primary.main', fontWeight: 600, cursor: 'pointer' }}
            >
              {t('showAll', { count: table.rows.length })}
            </Typography>
          </Tooltip>
        ) : null}
      </Box>
    )

  return (
    <>
      <InsightCard title={title} subtitle={subtitle} badge={badge} expand={{ label: t('expand'), onClick: () => setOpen(true) }}>
        {content(false)}
      </InsightCard>
      <DetailsDialog open={open} onClose={() => setOpen(false)} title={title} closeLabel={t('close')}>
        {content(true)}
      </DetailsDialog>
    </>
  )
}
