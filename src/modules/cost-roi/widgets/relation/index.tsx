'use client'

import { useTranslations } from 'next-intl'
import { RelationCard, useSyncBadge, type RelationPair } from '@/modules/analytics/shared/cards'
import type { ReportWidget } from '@/modules/analytics/types'
import { useCostRoi } from '../../shared'

/**
 * Does GMV follow the vouchers — and bad reviews, the spend or the GMV? Each
 * pair bucket by bucket, as a scatter with r.
 */
function CostRoiRelation() {
  const t = useTranslations('reports.costRoi')
  const tr = useTranslations('reports')
  const { report, connected } = useCostRoi()
  const badge = useSyncBadge(['tiktokShop'])
  const { buckets } = report.data
  const ads = connected.has('tiktokAds')
  const gmv = buckets.map((b) => b.gmv)
  const voucher = buckets.map((b) => (b.platformVoucher === null && b.sellerVoucher === null ? null : (b.platformVoucher ?? 0) + (b.sellerVoucher ?? 0)))
  const bad = buckets.map((b) => b.badReviews)
  const cost = buckets.map((b) => b.adsCost)

  const pairs: RelationPair[] = [
    { key: 'voucher-gmv', label: t('pairVoucherGmv'), xLabel: t('voucher'), yLabel: t('gmv'), xKind: 'money', yKind: 'money', xs: voucher, ys: gmv },
    { key: 'bad-gmv', label: t('pairBadGmv'), xLabel: t('badReviews'), yLabel: t('gmv'), xKind: 'count', yKind: 'money', xs: bad, ys: gmv },
    ...(ads ? [{ key: 'bad-ads', label: t('pairBadAds'), xLabel: t('badReviews'), yLabel: t('adsCost'), xKind: 'count' as const, yKind: 'money' as const, xs: bad, ys: cost }] : []),
  ]

  return <RelationCard title={t('relationTitle')} subtitle={tr('relationSubtitle')} badge={badge} buckets={buckets.map((b) => b.at)} pairs={pairs} />
}

export const costRoiRelationWidget: ReportWidget = {
  id: 'cost-roi-relation',
  band: 'trend',
  order: 20,
  sources: ['tiktokShop'],
  size: { xs: 12, lg: 5 },
  Component: CostRoiRelation,
}
