'use client'

import { useTranslations } from 'next-intl'
import { RelationCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import type { ReportWidget } from '@/modules/analytics/types'
import { useBookingKoc } from '../../shared'

/**
 * Does booking move the rest? Booked videos against the organic ones (the
 * effect on organic content), against the videos GMV Max spends on, and
 * booking fees against the organic videos.
 */
function BookingKocRelation() {
  const t = useTranslations('reports.bookingKoc')
  const tr = useTranslations('reports')
  const { report, connected } = useBookingKoc()
  const badge = useSyncBadge(['tiktokShop'])
  const { buckets } = report.data
  const booked = buckets.map((b) => b.booked)
  const organic = buckets.map((b) => b.organicVideos)

  return (
    <RelationCard
      title={t('relationTitle')}
      subtitle={tr('relationSubtitle')}
      badge={badge}
      buckets={buckets.map((b) => b.at)}
      pairs={[
        { key: 'booked-organic', label: t('pairBookedOrganic'), xLabel: t('booked'), yLabel: t('organicVideos'), xKind: 'count', yKind: 'count', xs: booked, ys: organic },
        ...(connected.has('tiktokAds')
          ? [{ key: 'booked-ads', label: t('pairBookedAds'), xLabel: t('booked'), yLabel: t('adsVideos'), xKind: 'count' as const, yKind: 'count' as const, xs: booked, ys: buckets.map((b) => b.adsVideos) }]
          : []),
        { key: 'cost-organic', label: t('pairCostOrganic'), xLabel: t('bookingCost'), yLabel: t('organicVideos'), xKind: 'money', yKind: 'count', xs: buckets.map((b) => b.bookingCost), ys: organic },
      ]}
    />
  )
}

export const bookingKocRelationWidget: ReportWidget = {
  id: 'booking-koc-relation',
  band: 'trend',
  order: 20,
  sources: ['booking', 'tiktokShop'],
  size: { xs: 12, lg: 5 },
  Component: BookingKocRelation,
}
