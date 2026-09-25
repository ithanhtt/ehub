'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { TableCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import { correlation } from '@/modules/analytics/shared/stats'
import type { ReportWidget } from '@/modules/analytics/types'
import { useVideoGmv } from '../../shared'

/**
 * Per product: booked videos aired, new videos with it attached, its GMV,
 * GMV per video — and over the period's buckets, how its GMV follows booked
 * videos and all videos (r). Highest GMV first.
 */
function VideoGmvProducts() {
  const t = useTranslations('reports.videoGmv')
  const tr = useTranslations('reports')
  const { report, connected, periodLabel } = useVideoGmv()
  const { count, exact, money, number } = useReportFigures()
  const badge = useSyncBadge(['tiktokShop'])
  const booking = connected.has('booking')
  const { products } = report.data

  return (
    <TableCard
      title={t('productsTitle')}
      subtitle={periodLabel}
      badge={badge}
      empty={tr('noData')}
      note={tr('rNote')}
      table={{
        columns: [
          t('product'),
          ...(booking ? [t('booked')] : []),
          t('attached'),
          t('gmv'),
          { label: t('gmvPerVideo2'), tip: t('gmvPerVideoTip') },
          ...(booking ? [{ label: t('rBookedGmv'), tip: tr('rTip') }] : []),
          { label: t('rAttachedGmv'), tip: tr('rTip') },
        ],
        rows: products.map((p) => [
          p.name,
          ...(booking ? [tableCell(p.booked, count)] : []),
          tableCell(p.attached, count),
          tableCell(p.gmv, exact),
          tableCell(p.attached > 0 ? p.gmv / p.attached : null, money),
          ...(booking ? [tableCell(correlation(p.bookedByBucket, p.gmvByBucket).r, (v) => number(v, 2))] : []),
          tableCell(correlation(p.attachedByBucket, p.gmvByBucket).r, (v) => number(v, 2)),
        ]),
      }}
    />
  )
}

export const videoGmvProductsWidget: ReportWidget = {
  id: 'video-gmv-products',
  band: 'table',
  order: 10,
  sources: [],
  size: { xs: 12 },
  Component: VideoGmvProducts,
}
