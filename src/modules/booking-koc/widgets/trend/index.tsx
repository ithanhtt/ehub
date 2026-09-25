'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { SERIES, TrendCard, useSyncBadge, type TrendPanel } from '@/modules/analytics/shared/cards'
import { useBucketLabels, useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useBookingKoc } from '../../shared'

/**
 * Over the period: all the videos posted with the cart, the booked ones at the
 * foot of each column and the organic ones above them; below, on its own
 * scale, the videos GMV Max put money behind against the booked videos — do
 * the two rise and fall together?
 */
function BookingKocTrend() {
  const t = useTranslations('reports.bookingKoc')
  const tr = useTranslations('reports')
  const { report, connected, periodLabel } = useBookingKoc()
  const { count, exact } = useReportFigures()
  const { full } = useBucketLabels()
  const badge = useSyncBadge(['tiktokShop'])
  const { buckets } = report.data
  const shop = connected.has('tiktokShop')
  const adsOn = connected.has('tiktokAds')
  const booked = { key: 'booked', label: t('booked'), color: SERIES.aqua, values: buckets.map((b) => b.booked) }

  const panels: TrendPanel[] = [
    {
      kind: 'count',
      unit: tr('unitVideos'),
      bars: shop
        ? { key: 'posted', label: t('postedVideos'), color: SERIES.blue, values: buckets.map((b) => b.postedVideos), part: booked }
        : booked,
    },
    ...(adsOn
      ? [
          {
            kind: 'count' as const,
            unit: tr('unitVideos'),
            lines: [{ key: 'ads', label: t('adsVideos'), color: SERIES.orange, values: buckets.map((b) => b.adsVideos) }, booked],
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
          t('booked'),
          t('bookingCost'),
          ...(shop ? [t('postedVideos'), t('organicVideos')] : []),
          ...(adsOn ? [t('adsVideos'), t('bookedOnAds')] : []),
        ],
        rows: [...buckets].reverse().map((b) => [
          full(b.at),
          tableCell(b.booked, count),
          tableCell(b.bookingCost, exact),
          ...(shop ? [tableCell(b.postedVideos, count, tr('pending')), tableCell(b.organicVideos, count, tr('pending'))] : []),
          ...(adsOn ? [tableCell(b.adsVideos, count), tableCell(b.bookedOnAds, count)] : []),
        ]),
      }}
    />
  )
}

export const bookingKocTrendWidget: ReportWidget = {
  id: 'booking-koc-trend',
  band: 'trend',
  order: 10,
  sources: [],
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 7 : 12 }),
  Component: BookingKocTrend,
}
