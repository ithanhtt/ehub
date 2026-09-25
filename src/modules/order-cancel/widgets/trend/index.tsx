'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { SERIES, TrendCard, useSyncBadge, type TrendPanel } from '@/modules/analytics/shared/cards'
import { useBucketLabels, useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useOrderCancel } from '../../shared'

/**
 * Over the period: Sapo's orders, the cancelled share at the foot of each
 * column; below, on its own scale, the orders GMV Max ads brought — so the
 * two can be read against each other bucket by bucket without sharing an axis.
 */
function OrderCancelTrend() {
  const t = useTranslations('reports.orderCancel')
  const tr = useTranslations('reports')
  const { report, connected, periodLabel } = useOrderCancel()
  const { count, exact, percent } = useReportFigures()
  const { full } = useBucketLabels()
  const badge = useSyncBadge(['sapo'])
  const { buckets } = report.data
  const ads = connected.has('tiktokAds')

  const panels: TrendPanel[] = [
    {
      kind: 'count',
      unit: tr('unitOrders'),
      bars: {
        key: 'created',
        label: t('created'),
        color: SERIES.aqua,
        values: buckets.map((b) => b.created),
        part: { key: 'cancelled', label: t('cancelled'), color: SERIES.orange, values: buckets.map((b) => b.cancelled) },
      },
    },
    ...(ads
      ? [
          {
            kind: 'count' as const,
            unit: tr('unitOrders'),
            lines: [{ key: 'ads', label: t('adsOrders'), color: SERIES.blue, values: buckets.map((b) => b.adsOrders) }],
          },
        ]
      : []),
  ]

  return (
    <TrendCard
      title={t('trendTitle')}
      subtitle={t('trendSubtitle', { period: periodLabel })}
      badge={badge}
      buckets={buckets.map((b) => b.at)}
      panels={panels}
      table={{
        columns: [
          tr('time'),
          t('created'),
          t('cancelled'),
          t('cancelRateColumn'),
          ...(ads ? [t('adsOrders'), t('adsCost')] : []),
        ],
        rows: [...buckets].reverse().map((b) => [
          full(b.at),
          tableCell(b.created, count, tr('pending')),
          tableCell(b.cancelled, count, tr('pending')),
          tableCell(b.created && b.cancelled !== null ? b.cancelled / b.created : null, (v) => percent(v)),
          ...(ads ? [tableCell(b.adsOrders, count), tableCell(b.adsCost, exact)] : []),
        ]),
      }}
    />
  )
}

export const orderCancelTrendWidget: ReportWidget = {
  id: 'order-cancel-trend',
  band: 'trend',
  order: 10,
  sources: ['sapo'],
  size: { xs: 12, lg: 7 },
  Component: OrderCancelTrend,
}
