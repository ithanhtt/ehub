'use client'

import { useTranslations } from 'next-intl'
import { RelationCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import type { ReportWidget } from '@/modules/analytics/types'
import { useOrderCancel } from '../../shared'

/** Do more ads orders come with more cancellations? Bucket by bucket, as a scatter and r. */
function OrderCancelRelation() {
  const t = useTranslations('reports.orderCancel')
  const tr = useTranslations('reports')
  const { report } = useOrderCancel()
  const badge = useSyncBadge(['sapo'])
  const { buckets } = report.data
  const created = buckets.map((b) => b.created)
  const cancelled = buckets.map((b) => b.cancelled)
  const ads = buckets.map((b) => b.adsOrders)

  return (
    <RelationCard
      title={t('relationTitle')}
      subtitle={tr('relationSubtitle')}
      badge={badge}
      buckets={buckets.map((b) => b.at)}
      pairs={[
        { key: 'ads-cancel', label: t('pairAdsCancel'), xLabel: t('adsOrders'), yLabel: t('cancelled'), xKind: 'count', yKind: 'count', xs: ads, ys: cancelled },
        { key: 'ads-created', label: t('pairAdsCreated'), xLabel: t('adsOrders'), yLabel: t('created'), xKind: 'count', yKind: 'count', xs: ads, ys: created },
        { key: 'created-cancel', label: t('pairCreatedCancel'), xLabel: t('created'), yLabel: t('cancelled'), xKind: 'count', yKind: 'count', xs: created, ys: cancelled },
      ]}
    />
  )
}

export const orderCancelRelationWidget: ReportWidget = {
  id: 'order-cancel-relation',
  band: 'table',
  order: 20,
  sources: ['sapo', 'tiktokAds'],
  size: { xs: 12, lg: 4 },
  Component: OrderCancelRelation,
}
