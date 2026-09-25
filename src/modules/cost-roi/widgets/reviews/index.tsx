'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { SERIES, TableCard, TrendCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import { useBucketLabels, useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { roiOf, useCostRoi } from '../../shared'

/**
 * Bad reviews over the period — reviews left, the 1–2 star ones at the foot
 * of each column — for the best-selling products TikTok is asked about each
 * day (it has no API listing reviews, only a product's star counts).
 */
function CostRoiReviewTrend() {
  const t = useTranslations('reports.costRoi')
  const tr = useTranslations('reports')
  const { report, periodLabel } = useCostRoi()
  const { count, percent } = useReportFigures()
  const { full } = useBucketLabels()
  const badge = useSyncBadge(['tiktokShop'])
  const { buckets } = report.data

  return (
    <TrendCard
      title={t('reviewsTitle')}
      subtitle={t('reviewsSubtitle', { period: periodLabel })}
      badge={badge}
      buckets={buckets.map((b) => b.at)}
      panels={[
        {
          kind: 'count',
          unit: t('unitReviews'),
          bars: {
            key: 'reviews',
            label: t('reviews'),
            color: SERIES.blue,
            values: buckets.map((b) => b.reviews),
            part: { key: 'bad', label: t('badReviews'), color: SERIES.orange, values: buckets.map((b) => b.badReviews) },
          },
        },
      ]}
      table={{
        columns: [tr('time'), t('reviews'), t('badReviews'), t('badShareColumn')],
        rows: [...buckets].reverse().map((b) => [
          full(b.at),
          tableCell(b.reviews, count, tr('pendingAnalytics')),
          tableCell(b.badReviews, count, tr('pendingAnalytics')),
          tableCell(b.reviews && b.badReviews !== null ? b.badReviews / b.reviews : null, (v) => percent(v)),
        ]),
      }}
    />
  )
}

/** Per product: bad reviews beside its GMV and ad spend — where a pattern between them would show. */
function CostRoiReviewProducts() {
  const t = useTranslations('reports.costRoi')
  const { report, connected, periodLabel } = useCostRoi()
  const { exact, count, percent, number } = useReportFigures()
  const badge = useSyncBadge(['tiktokShop'])
  const ads = connected.has('tiktokAds')
  const rows = report.data.products.filter((p) => p.reviews !== null).sort((a, b) => (b.badReviews ?? 0) - (a.badReviews ?? 0))

  return (
    <TableCard
      title={t('reviewProductsTitle')}
      subtitle={periodLabel}
      badge={badge}
      empty={t('reviewsNone')}
      table={{
        columns: [
          t('product'),
          t('badReviews'),
          t('reviews'),
          t('badShareColumn'),
          t('gmv'),
          t('voucher'),
          ...(ads ? [t('adsCost'), t('roiActual')] : []),
        ],
        rows: rows.map((p) => [
          p.name,
          tableCell(p.badReviews, count),
          tableCell(p.reviews, count),
          tableCell(p.reviews ? (p.badReviews ?? 0) / p.reviews : null, (v) => percent(v)),
          tableCell(p.gmv, exact),
          tableCell(p.voucher, exact),
          ...(ads ? [tableCell(p.adsCost, exact), tableCell(roiOf(p.adsRevenue, p.adsCost), (v) => number(v, 2))] : []),
        ]),
      }}
    />
  )
}

export const costRoiReviewTrendWidget: ReportWidget = {
  id: 'cost-roi-review-trend',
  band: 'insight',
  order: 20,
  sources: ['tiktokShop'],
  size: { xs: 12, lg: 5 },
  Component: CostRoiReviewTrend,
}

export const costRoiReviewProductsWidget: ReportWidget = {
  id: 'cost-roi-review-products',
  band: 'insight',
  order: 30,
  sources: ['tiktokShop'],
  size: { xs: 12, lg: 7 },
  Component: CostRoiReviewProducts,
}
