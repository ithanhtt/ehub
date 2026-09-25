'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { SERIES, TrendCard, useSyncBadge, type TrendPanel } from '@/modules/analytics/shared/cards'
import { useBucketLabels, useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useCostRoi } from '../../shared'

/**
 * Revenue and what it cost, over the period: GMV ordered and GMV from ads in
 * one panel; vouchers, ad spend and commission in the one below — same unit,
 * but a scale of their own, so costs a tenth the size of GMV still read.
 */
function CostRoiTrend() {
  const t = useTranslations('reports.costRoi')
  const tr = useTranslations('reports')
  const { report, connected, periodLabel } = useCostRoi()
  const { exact } = useReportFigures()
  const { full } = useBucketLabels()
  const badge = useSyncBadge(['tiktokShop'])
  const { buckets } = report.data
  const shop = connected.has('tiktokShop')
  const ads = connected.has('tiktokAds')
  const values = (pick: (b: (typeof buckets)[number]) => number | null) => buckets.map(pick)
  const voucher = (b: (typeof buckets)[number]) => (b.platformVoucher === null && b.sellerVoucher === null ? null : (b.platformVoucher ?? 0) + (b.sellerVoucher ?? 0))

  const panels: TrendPanel[] = [
    {
      kind: 'money',
      unit: '₫',
      lines: [
        ...(shop ? [{ key: 'gmv', label: t('gmv'), color: SERIES.blue, values: values((b) => b.gmv) }] : []),
        ...(ads ? [{ key: 'adsRevenue', label: t('adsRevenue'), color: SERIES.aqua, values: values((b) => b.adsRevenue) }] : []),
      ],
    },
    {
      kind: 'money',
      unit: '₫',
      lines: [
        ...(shop ? [{ key: 'voucher', label: t('voucher'), color: SERIES.blue, values: values(voucher) }] : []),
        ...(ads ? [{ key: 'adsCost', label: t('adsCost'), color: SERIES.orange, values: values((b) => b.adsCost) }] : []),
        ...(shop ? [{ key: 'commission', label: t('commission'), color: SERIES.aqua, values: values((b) => b.commission) }] : []),
      ],
    },
  ]

  return (
    <TrendCard
      title={t('trendTitle')}
      subtitle={t('trendSubtitle', { period: periodLabel })}
      badge={badge}
      buckets={buckets.map((b) => b.at)}
      panels={panels.filter((panel) => (panel.lines?.length ?? 0) > 0)}
      table={{
        columns: [
          tr('time'),
          ...(shop ? [t('gmv'), t('netGmv'), t('platformVoucher'), t('sellerVoucher'), t('commission')] : []),
          ...(ads ? [t('adsCost'), t('adsRevenue')] : []),
        ],
        rows: [...buckets].reverse().map((b) => [
          full(b.at),
          ...(shop
            ? [
                tableCell(b.gmv, exact, tr('pending')),
                tableCell(b.netGmv, exact, tr('pending')),
                tableCell(b.platformVoucher, exact, tr('pending')),
                tableCell(b.sellerVoucher, exact, tr('pending')),
                tableCell(b.commission, exact, tr('pending')),
              ]
            : []),
          ...(ads ? [tableCell(b.adsCost, exact), tableCell(b.adsRevenue, exact)] : []),
        ]),
      }}
    />
  )
}

export const costRoiTrendWidget: ReportWidget = {
  id: 'cost-roi-trend',
  band: 'trend',
  order: 10,
  sources: [],
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 7 : 12 }),
  Component: CostRoiTrend,
}
