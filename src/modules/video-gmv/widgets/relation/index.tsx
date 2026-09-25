'use client'

import { useTranslations } from 'next-intl'
import { RelationCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import type { ReportWidget } from '@/modules/analytics/types'
import { useVideoGmv } from '../../shared'

/** How booked videos, videos with the product, and product GMV move together — each pair as a scatter with r. */
function VideoGmvRelation() {
  const t = useTranslations('reports.videoGmv')
  const tr = useTranslations('reports')
  const { report, connected } = useVideoGmv()
  const badge = useSyncBadge(['tiktokShop'])
  const { buckets } = report.data
  const booking = connected.has('booking')
  const booked = buckets.map((b) => b.booked)
  const attached = buckets.map((b) => b.attached)
  const gmv = buckets.map((b) => b.gmv)

  return (
    <RelationCard
      title={t('relationTitle')}
      subtitle={tr('relationSubtitle')}
      badge={badge}
      buckets={buckets.map((b) => b.at)}
      pairs={[
        ...(booking
          ? [
              { key: 'booked-gmv', label: t('pairBookedGmv'), xLabel: t('booked'), yLabel: t('gmv'), xKind: 'count' as const, yKind: 'money' as const, xs: booked, ys: gmv },
              { key: 'booked-attached', label: t('pairBookedAttached'), xLabel: t('booked'), yLabel: t('attached'), xKind: 'count' as const, yKind: 'count' as const, xs: booked, ys: attached },
            ]
          : []),
        { key: 'attached-gmv', label: t('pairAttachedGmv'), xLabel: t('attached'), yLabel: t('gmv'), xKind: 'count', yKind: 'money', xs: attached, ys: gmv },
      ]}
    />
  )
}

export const videoGmvRelationWidget: ReportWidget = {
  id: 'video-gmv-relation',
  band: 'trend',
  order: 20,
  sources: ['tiktokShop'],
  size: { xs: 12, lg: 5 },
  Component: VideoGmvRelation,
}
