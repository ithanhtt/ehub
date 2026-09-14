'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePreference } from '@/components/ui/use-preference'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { acceptTableSort, ChartCard, type TableSort } from '@/components/charts/chart-card'
import { HourColumns } from '@/components/charts/hour-columns'
import { WeekHeatmap } from '@/components/charts/week-heatmap'
import { formatCompact, formatNumber } from '@/core/utils/format'
import type { DashboardRange, SapoHours } from '@/modules/overview/data/types'
import { SyncChip } from '@/components/charts/sync-chip'
import { DetailsDialog, InsightCard } from '../../shared/insight-card'

/**
 * When in the day orders come in (Sapo orders created, over the chosen
 * channels), for exactly the days the period filter picks — the same days as
 * every other figure on the page.
 *
 * Today: each hour's orders so far, the hour in progress outlined. 7 and 30
 * days: the average day, hour by hour — today joining for the hours it has
 * finished — and a weekday × hour heatmap for the patterns one profile hides.
 * One day has no weekday pattern, so the today view is by hour only.
 *
 * The answer comes first, in words: the busiest two-hour stretch and its share
 * of the orders, the busiest hour, and the previous period's peak. As in the
 * charts above, the previous period can be laid over the columns (ticks).
 */

const ORDERS = 'var(--adshub-series-3)'
/** Hours in the "peak" stretch: long enough to plan a live session or a budget boost around. */
const PEAK_SPAN = 2

/** The busiest `span` consecutive hours and their share of all the hours' orders. */
function peakWindow(values: Array<number | null>, span = PEAK_SPAN) {
  const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0)
  if (total <= 0) return null
  let start = 0
  let best = -1
  for (let from = 0; from + span <= values.length; from++) {
    let sum = 0
    for (let hour = from; hour < from + span; hour++) sum += values[hour] ?? 0
    if (sum > best) {
      best = sum
      start = from
    }
  }
  return { start, end: start + span - 1, share: best / total }
}

function busiestHour(values: Array<number | null>) {
  let hour = -1
  values.forEach((v, h) => {
    if (v !== null && v > 0 && (hour < 0 || v > (values[hour] as number))) hour = h
  })
  return hour
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
const clock = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const hourRange = (hour: number) => `${clock(hour)} – ${clock(hour + 1)}`
const windowText = (peak: { start: number; end: number }) => `${clock(peak.start)} – ${clock(peak.end + 1)}`

/**
 * The full view's choices — by hour or by weekday, the comparison, chart or
 * table and the table's order — remembered in this browser (see usePreference).
 */
type HoursChoice = { view: 'hour' | 'weekday'; compare: boolean; table: 'chart' | 'table'; sort: TableSort | null }
const HOURS_DEFAULT: HoursChoice = { view: 'hour', compare: false, table: 'chart', sort: null }

function acceptHours(value: unknown): HoursChoice | null {
  if (!value || typeof value !== 'object') return null
  const { view, compare, table, sort } = value as Record<string, unknown>
  return {
    view: view === 'weekday' ? 'weekday' : 'hour',
    compare: compare === true,
    table: table === 'table' ? 'table' : 'chart',
    sort: acceptTableSort(sort),
  }
}

export function OrderHoursCard({
  hours,
  range,
  pendingDays,
  bare = false,
}: {
  hours: SapoHours
  range: DashboardRange
  /** Days of the view still being fetched. */
  pendingDays: number
  /** Without the card frame and title, inside a dialog that names it. */
  bare?: boolean
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const [choice, setChoice] = usePreference<HoursChoice>('adshub.dashboard.hours', HOURS_DEFAULT, acceptHours)
  const picked = choice.view
  const setView = (view: 'hour' | 'weekday') => setChoice((current) => ({ ...current, view }))
  const compare = choice.compare
  const setCompare = (next: (value: boolean) => boolean) =>
    setChoice((current) => ({ ...current, compare: next(current.compare) }))
  const single = range === 'today'
  const view = single ? 'hour' : picked

  const percent = (share: number) => `${formatNumber(share * 100, locale, 0)}%`
  // Averages keep a decimal below ten; counts are whole orders.
  const average = (value: number) => formatNumber(value, locale, value < 10 ? 1 : 0)
  const whole = (value: number) => formatNumber(value, locale)
  const formatValue = single ? whole : average
  const weekday = (day: number, style: 'short' | 'long') =>
    new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', { weekday: style, timeZone: 'UTC' }).format(
      // 7 January 2024 was a Sunday: day 0.
      new Date(Date.UTC(2024, 0, 7 + day)),
    )

  const peak = peakWindow(hours.profile)
  const previousPeak = hours.previous ? peakWindow(hours.previous) : null
  const top = busiestHour(hours.profile)
  const periodTotal = sum(hours.totals)
  // Shares come from the orders themselves, so they agree with the totals above.
  const shareOf = (window: { start: number; end: number }) =>
    periodTotal > 0 ? sum(hours.totals.slice(window.start, window.end + 1)) / periodTotal : 0
  const hasData = hours.profile.some((v) => v !== null && v > 0)
  const previousLabel = t(`previous.${range}`)

  const stats: Array<{ label: string; value: string; note: string }> = []
  if (peak) {
    const share = percent(shareOf(peak))
    stats.push({
      label: t('peakWindow'),
      value: windowText(peak),
      note: single ? t('peakShareToday', { share }) : t('peakSharePeriod', { share, days: hours.days }),
    })
  }
  if (top >= 0) {
    stats.push({
      label: t('busiestHour'),
      value: hourRange(top),
      note: single
        ? t('busiestHourCount', { value: whole(hours.profile[top] as number) })
        : t('busiestHourValue', { value: average(hours.profile[top] as number), total: whole(hours.totals[top]) }),
    })
  }
  if (previousPeak) {
    stats.push({
      label: t(`peakPrevious.${range}`),
      value: windowText(previousPeak),
      note: t('peakSharePrevious', { share: percent(previousPeak.share) }),
    })
  }

  const rows = hours.week.map((row) => ({
    key: String(row.weekday),
    label: weekday(row.weekday, 'short'),
    fullLabel: weekday(row.weekday, 'long'),
    values: row.hours,
    counts: row.counts,
  }))

  const subtitle =
    view === 'weekday'
      ? t('hoursWeekSubtitle', { days: hours.days })
      : single
        ? t('hoursSubtitleToday')
        : hours.currentHour === null
          ? t('hoursSubtitlePast', { days: hours.days })
          : t('hoursSubtitle', { days: hours.days })

  // Tables read most recent first. Today counts back from the hour now, leaving out the hours still
  // ahead; an average day starts at the hour now and goes back round the clock; weekdays start at
  // today's. Within a weekday row the hours stay in their order, so a row still reads as a day.
  const hourNow = hours.currentHour ?? 23
  const recentHours = single
    ? Array.from({ length: hourNow + 1 }, (_, i) => hourNow - i)
    : Array.from({ length: 24 }, (_, i) => (hourNow - i + 24) % 24)
  const todayWeekday = new Date(Date.now() + 7 * 3_600_000).getUTCDay()
  const recentRows = Array.from({ length: 7 }, (_, i) => (todayWeekday - i + 7) % 7).flatMap((day) =>
    rows.filter((row) => row.key === String(day)),
  )

  const table =
    view === 'hour'
      ? {
          columns: [
            t('hourCol'),
            single ? t('ordersThisHour') : { label: t('avgPerDay'), tip: t('tableTipAvgPerDay') },
            ...(single ? [] : [{ label: t('hourTotalCol'), tip: t('tableTipHourTotal') }]),
            ...(hours.previous ? [previousLabel] : []),
          ],
          // Each figure carries the number the table sorts it by; an hour still ahead is a gap.
          rows: recentHours.map((hour) => {
            const v = hours.profile[hour] ?? null
            const total = hours.totals[hour] ?? 0
            return [
              hourRange(hour),
              { text: v === null ? '—' : formatValue(v), sort: v },
              ...(single ? [] : [{ text: whole(total), sort: total }]),
              ...(hours.previous ? [{ text: formatValue(hours.previous[hour]), sort: hours.previous[hour] }] : []),
            ]
          }),
        }
      : {
          columns: [t('weekdayCol'), ...Array.from({ length: 24 }, (_, hour) => clock(hour))],
          rows: recentRows.map((row) => [
            row.fullLabel,
            ...row.values.map((v) => ({ text: v === null ? '—' : average(v), sort: v })),
          ]),
        }

  return (
    <ChartCard
      bare={bare}
      title={t('hoursTitle')}
      subtitle={subtitle}
      labels={{ chart: t('showChart'), table: t('showTable') }}
      table={table}
      view={choice.table}
      onViewChange={(next) => setChoice((current) => ({ ...current, table: next }))}
      sort={choice.sort}
      onSortChange={(sort) => setChoice((current) => ({ ...current, sort }))}
      action={
        single ? undefined : (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view}
            onChange={(_event, next: 'hour' | 'weekday' | null) => next && setView(next)}
            aria-label={t('hoursTitle')}
          >
            <ToggleButton value="hour" sx={{ px: 1.5, py: 0.25, textTransform: 'none', fontWeight: 600 }}>
              {t('viewByHour')}
            </ToggleButton>
            <ToggleButton value="weekday" sx={{ px: 1.5, py: 0.25, textTransform: 'none', fontWeight: 600 }}>
              {t('viewByWeekday')}
            </ToggleButton>
          </ToggleButtonGroup>
        )
      }
    >
      {!hasData ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 6, textAlign: 'center' }}>
          {pendingDays > 0 ? t('syncing', { count: pendingDays }) : t('noHourData')}
        </Typography>
      ) : (
        <>
          {/* The answer in words, before the chart. */}
          <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 4, rowGap: 1.5, mb: 2 }}>
            {stats.map((stat) => (
              <Box key={stat.label} sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {stat.label}
                </Typography>
                <Typography variant="h3" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                  {stat.value}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                  {stat.note}
                </Typography>
              </Box>
            ))}
          </Stack>

          {view === 'hour' ? (
            <>
              <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 1, mb: 1 }}>
                <LegendKey
                  swatch={<Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: ORDERS }} />}
                  label={t('peakWindow')}
                />
                <LegendKey
                  swatch={<Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: ORDERS, opacity: 0.45 }} />}
                  label={t('otherHours')}
                />
                {hours.previous ? (
                  <CompareChip on={compare} label={t(`compareWith.${range}`)} onClick={() => setCompare((value) => !value)} />
                ) : null}
              </Stack>
              <HourColumns
                height={bare ? 300 : 190}
                values={hours.profile}
                reference={compare ? hours.previous : null}
                peak={peak}
                currentHour={single ? hours.currentHour : null}
                detail={
                  single
                    ? undefined
                    : (hour) =>
                        hours.counts[hour] > 0
                          ? t('hourTotal', { total: whole(hours.totals[hour]), days: hours.counts[hour] })
                          : null
                }
                color={ORDERS}
                format={formatValue}
                formatTick={(value) => formatCompact(value, locale)}
                text={{
                  unit: single ? t('unitCount') : t('unitPerDay'),
                  value: single ? t('ordersThisHour') : t('avgPerDay'),
                  reference: previousLabel,
                  inProgress: t('hourInProgress'),
                  inPeak: t('inPeak'),
                  hourRange,
                  hourTick: (hour) => `${hour}h`,
                }}
                ariaLabel={t('hoursTitle')}
              />
            </>
          ) : (
            <WeekHeatmap
              rows={rows}
              format={average}
              text={{
                value: t('avgPerDay'),
                hourRange,
                hourTick: (hour) => `${hour}h`,
                days: (count) => t('daysCounted', { count }),
                less: t('less'),
                more: t('more'),
                noData: t('noHourData'),
              }}
              ariaLabel={t('hoursTitle')}
            />
          )}

          {pendingDays > 0 ? (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', mt: 1 }}>
              {t('syncing', { count: pendingDays })}
            </Typography>
          ) : null}
        </>
      )}
    </ChartCard>
  )
}

function LegendKey({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      {swatch}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
    </Stack>
  )
}

/**
 * The overview's glimpse of the card above: the peak stretch in words and
 * the 24 columns in miniature, the whole card one click away.
 */
export function OrderHoursSummary({
  hours,
  range,
  pendingDays,
}: {
  hours: SapoHours
  range: DashboardRange
  pendingDays: number
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const single = range === 'today'
  const peak = peakWindow(hours.profile)
  const periodTotal = sum(hours.totals)
  const share = peak && periodTotal > 0 ? sum(hours.totals.slice(peak.start, peak.end + 1)) / periodTotal : 0
  const percent = `${formatNumber(share * 100, locale, 0)}%`
  const hasData = hours.profile.some((v) => v !== null && v > 0)
  const format = (value: number) => formatNumber(value, locale, single || value >= 10 ? 0 : 1)

  return (
    <>
      <InsightCard
        title={t('hoursTitle')}
        badge={pendingDays > 0 ? <SyncChip label={t('syncChip')} tip={t('syncChipTip')} /> : undefined}
        subtitle={single ? t('hoursSummaryToday') : t('hoursSummaryPeriod', { days: hours.days })}
        expand={hasData ? { label: t('expand'), onClick: () => setOpen(true) } : undefined}
      >
        {!hasData ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
            {pendingDays > 0 ? t('syncing', { count: pendingDays }) : t('noHourData')}
          </Typography>
        ) : (
          <>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {t('peakWindow')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Typography variant="h3" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {peak ? windowText(peak) : '—'}
              </Typography>
              {peak ? (
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                  {single ? t('peakShareToday', { share: percent }) : t('peakSharePeriod', { share: percent, days: hours.days })}
                </Typography>
              ) : null}
            </Stack>
            <Box sx={{ mt: 1.5 }}>
              <HourColumns
                values={hours.profile}
                peak={peak}
                currentHour={single ? hours.currentHour : null}
                color={ORDERS}
                height={96}
                format={format}
                formatTick={(value) => formatCompact(value, locale)}
                text={{
                  unit: single ? t('unitCount') : t('unitPerDay'),
                  value: single ? t('ordersThisHour') : t('avgPerDay'),
                  reference: '',
                  inProgress: t('hourInProgress'),
                  inPeak: t('inPeak'),
                  hourRange,
                  hourTick: (hour) => `${hour}h`,
                }}
                ariaLabel={t('hoursTitle')}
              />
            </Box>
          </>
        )}
      </InsightCard>

      <DetailsDialog open={open} onClose={() => setOpen(false)} title={t('hoursTitle')} closeLabel={t('closeDetails')}>
        <OrderHoursCard hours={hours} range={range} pendingDays={pendingDays} bare />
      </DetailsDialog>
    </>
  )
}

/** Lays the previous period over the columns, as the charts above do; its key is the tick it draws. */
function CompareChip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={on}
      sx={{
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: 999,
        border: '1px dashed',
        borderColor: on ? 'text.secondary' : 'divider',
        backgroundColor: on ? 'action.selected' : 'transparent',
        transition: 'border-color .15s, background-color .15s',
        '&:hover': { borderColor: 'text.disabled' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Box sx={{ width: 12, height: 0, borderTop: '2px solid', borderColor: 'text.primary' }} />
      <Typography variant="caption" sx={{ fontWeight: 600, color: on ? 'text.primary' : 'text.secondary' }}>
        {label}
      </Typography>
    </ButtonBase>
  )
}
