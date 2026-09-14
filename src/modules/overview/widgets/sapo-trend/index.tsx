'use client'

import { useTranslations } from 'next-intl'
import Typography from '@mui/material/Typography'
import { ComboChart } from '@/components/charts/combo-chart'
import { SyncChip } from '@/components/charts/sync-chip'
import { useOverview } from '../../context'
import { useChartChoice } from '../../shared/chart-choice'
import { useChartSetup, useFigures, useTimeLabels } from '../../shared/format'
import { ExpandableChartCard } from '../../shared/insight-card'
import { COST, GMV, ORDERS, perPeriod, tableCell } from '../../shared/series'
import type { OverviewWidget } from '../../types'

/**
 * Sapo over the period: revenue (Sapo's Tổng doanh thu) as a line, orders
 * created as columns with the cancelled share at their foot — today's running
 * totals hour by hour, longer periods day by day — with the previous period to
 * compare against. The table lays the figures out as Sapo's revenue report
 * does, column for column — for today, each hour on its own, as its hourly
 * export — so the two can be set side by side. A day still loading is a gap,
 * never a zero.
 */
function SapoTrend() {
  const t = useTranslations('dashboard')
  const { data, isToday } = useOverview()
  const { exact, count } = useFigures()
  const { tick, full } = useTimeLabels()
  const chart = useChartSetup()
  const [choice, setChoice] = useChartChoice('adshub.dashboard.sapoChart')
  const sapo = data.sapo
  if (!sapo) return null

  const buckets = sapo.byTime
  // Sapo's report shows its shipping column always; this store ships free, so here it shows only when there is some.
  const withShipping = buckets.some((b) => (b.sales?.shipping ?? 0) !== 0)
  const money = (value: number | undefined) => tableCell(value, exact, t('pending'))
  // Today's rows are single hours, as in Sapo's hourly export: "14:00 – 15:00".
  const hourSpan = (at: string) => `${at.slice(11, 16)} – ${String((Number(at.slice(11, 13)) + 1) % 24).padStart(2, '0')}:00`
  // Columns count each position's own orders: for today, those of each hour.
  const created = {
    ...perPeriod(
      buckets.map((b) => b.created),
      isToday,
    ),
    previous: perPeriod(
      sapo.previousByTime.map((b) => b.created),
      isToday,
    ).values,
  }
  const cancelled = perPeriod(
    buckets.map((b) => b.cancelled),
    isToday,
  ).values
  // While days of the period itself are still being fetched, the figures may be short; while refunds are, the revenue high.
  const pending =
    sapo.sync.current > 0
      ? t('syncChipTip')
      : sapo.sync.returns > 0 || sapo.sync.catchingUp
        ? t('syncRevenueTip')
        : undefined

  return (
    <ExpandableChartCard
      expandLabel={t('expand')}
      closeLabel={t('closeDetails')}
      title={t('sapoGmvTitle')}
      badge={pending ? <SyncChip label={t('syncChip')} tip={pending} /> : undefined}
      subtitle={isToday ? t('sapoGmvSubtitleToday') : t('sapoGmvSubtitle')}
      labels={chart.labels}
      view={choice.view}
      onViewChange={(view) => setChoice((current) => ({ ...current, view }))}
      sort={choice.sort}
      onSortChange={(sort) => setChoice((current) => ({ ...current, sort }))}
      table={{
        columns: [
          t('time'),
          ...(isToday
            ? [
                { label: t('createdInHour'), tip: t('tableTipInHour') },
                { label: t('cancelledInHour'), tip: `${t('tableTipInHour')} ${t('tableTipCancelled')}` },
              ]
            : [t('ordersCreated'), { label: t('ordersCancelled'), tip: t('tableTipCancelled') }]),
          { label: t('salesLines'), tip: t('tipSalesLines') },
          { label: t('salesDiscounts'), tip: t('tipSalesDiscounts') },
          { label: t('salesReturns'), tip: t('tipSalesReturns') },
          { label: t('salesNet'), tip: t('tipSalesNet') },
          ...(withShipping ? [t('salesShipping')] : []),
          { label: t('salesTax'), tip: t('tipSalesTax') },
          { label: t('revenueLabel'), tip: isToday ? `${t('tableTipInHour')} ${t('tipSalesRevenue')}` : t('tipSalesRevenue') },
          ...(isToday ? [{ label: t('salesRevenueRunning'), tip: t('tableTipRunning') }] : []),
        ],
        // Most recent first: the hour now (or today) on top. A day still loading is a gap.
        rows: buckets
          .map((b, i) => [
            isToday ? hourSpan(b.at) : full(b.at, i, buckets.length),
            ...(isToday
              ? [tableCell(created.values[i], count), tableCell(cancelled[i], count)]
              : [tableCell(b.created, count, t('pending')), tableCell(b.cancelled, count, t('pending'))]),
            money(b.sales?.lines),
            money(b.sales?.discounts),
            money(b.sales?.returns),
            money(b.sales?.netRevenue),
            ...(withShipping ? [money(b.sales?.shipping)] : []),
            money(b.sales?.tax),
            money(b.sales?.revenue),
            ...(isToday ? [tableCell(b.revenue, exact, t('pending'))] : []),
          ])
          .reverse(),
      }}
      render={(expanded) =>
        buckets.length > 0 ? (
          <ComboChart
            height={expanded ? 440 : 210}
            labels={buckets.map((b) => tick(b.at))}
            pointLabels={buckets.map((b, i) => full(b.at, i, buckets.length))}
            connectGaps={isToday}
            lines={[
              {
                key: 'revenue',
                label: t('revenueLabel'),
                color: GMV,
                values: buckets.map((b) => b.revenue),
                previous: sapo.previousByTime.map((b) => b.revenue),
              },
            ]}
            bars={{
              key: 'created',
              label: isToday ? t('createdInHour') : t('ordersCreated'),
              color: ORDERS,
              values: created.values,
              previous: created.previous,
              lumped: created.lumped,
              part: { key: 'cancelled', label: t('cancelledPart'), color: COST, values: cancelled },
            }}
            formats={chart.formats}
            text={chart.text}
            ariaLabel={t('sapoGmvTitle')}
            hidden={choice.hidden}
            onHiddenChange={(hidden) => setChoice((current) => ({ ...current, hidden }))}
            compare={choice.compare}
            onCompareChange={(compare) => setChoice((current) => ({ ...current, compare }))}
          />
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 6, textAlign: 'center' }}>
            {t('noData')}
          </Typography>
        )
      }
    />
  )
}

export const sapoTrendWidget: OverviewWidget = {
  id: 'sapo-trend',
  band: 'trend',
  order: 20,
  sources: ['sapo'],
  // Half the row beside another source's trend, the whole row alone.
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 6 : 12 }),
  Component: SapoTrend,
}
