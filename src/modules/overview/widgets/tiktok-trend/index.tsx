'use client'

import { useTranslations } from 'next-intl'
import Typography from '@mui/material/Typography'
import { ComboChart } from '@/components/charts/combo-chart'
import { useOverview } from '../../context'
import { useChartChoice } from '../../shared/chart-choice'
import { useChartSetup, useFigures, useTimeLabels } from '../../shared/format'
import { ExpandableChartCard } from '../../shared/insight-card'
import { COST, GMV, ORDERS, perPeriod, tableCell } from '../../shared/series'
import type { OverviewWidget } from '../../types'

/**
 * TikTok GMV Max over the period: GMV and spend as lines, orders as columns —
 * today's running totals hour by hour, longer periods day by day — with the
 * previous period to compare against, and the same figures as a table.
 */
function TiktokTrend() {
  const t = useTranslations('dashboard')
  const { data, isToday } = useOverview()
  const { exact, count } = useFigures()
  const { tick, full } = useTimeLabels()
  const chart = useChartSetup()
  const [choice, setChoice] = useChartChoice('adshub.dashboard.tiktokChart')
  const gmv = data.gmvMax
  if (!gmv) return null

  const buckets = gmv.byTime
  // Columns count each position's own orders: for today, those of each hour.
  const orders = {
    ...perPeriod(
      buckets.map((b) => b.orders),
      isToday,
    ),
    previous: perPeriod(
      gmv.previousByTime.map((b) => b.orders),
      isToday,
    ).values,
  }

  return (
    <ExpandableChartCard
      expandLabel={t('expand')}
      closeLabel={t('closeDetails')}
      title={t('tiktokTrendTitle')}
      subtitle={isToday ? t('gmvTrendSubtitleToday') : t('gmvTrendSubtitle')}
      labels={chart.labels}
      view={choice.view}
      onViewChange={(view) => setChoice((current) => ({ ...current, view }))}
      sort={choice.sort}
      onSortChange={(sort) => setChoice((current) => ({ ...current, sort }))}
      table={{
        // Today's figures run from midnight, beside the one hour alone: the headings say which is which.
        columns: isToday
          ? [
              t('time'),
              { label: t('orders'), tip: t('tableTipRunning') },
              { label: t('ordersInHour'), tip: t('tableTipInHour') },
              { label: t('gmv'), tip: t('tableTipRunning') },
              { label: t('cost'), tip: t('tableTipRunning') },
            ]
          : [t('time'), t('orders'), t('gmv'), t('cost')],
        // Most recent first: the hour now (or today) on top.
        rows: buckets
          .map((b, i) => [
            full(b.at, i, buckets.length),
            tableCell(b.orders, count),
            ...(isToday ? [tableCell(orders.values[i], count)] : []),
            tableCell(b.revenue, exact),
            tableCell(b.cost, exact),
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
                key: 'gmv',
                label: t('gmv'),
                color: GMV,
                values: buckets.map((b) => b.revenue),
                previous: gmv.previousByTime.map((b) => b.revenue),
              },
              {
                key: 'cost',
                label: t('cost'),
                color: COST,
                values: buckets.map((b) => b.cost),
                previous: gmv.previousByTime.map((b) => b.cost),
              },
            ]}
            bars={{
              key: 'orders',
              label: isToday ? t('ordersInHour') : t('orders'),
              color: ORDERS,
              values: orders.values,
              previous: orders.previous,
              lumped: orders.lumped,
            }}
            formats={chart.formats}
            text={chart.text}
            ariaLabel={t('tiktokTrendTitle')}
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

export const tiktokTrendWidget: OverviewWidget = {
  id: 'tiktok-trend',
  band: 'trend',
  order: 10,
  sources: ['tiktok'],
  // Half the row beside another source's trend, the whole row alone.
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 6 : 12 }),
  Component: TiktokTrend,
}
