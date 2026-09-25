'use client'

import { useTranslations } from 'next-intl'
import { SyncNotice } from '@/components/ui/sync-notice'
import { useOverview } from '../../context'
import type { OverviewWidget } from '../../types'

/**
 * TikTok's figures still coming in, said plainly above everything they affect
 * — as the Sapo notice does for Sapo: days of GMV Max not read yet (spend,
 * revenue and ROI short), its products by hour still loading, days of TikTok
 * Shop orders still being read. A line each; gone once all is in.
 */
function TiktokSync() {
  const t = useTranslations('dashboard')
  const { data } = useOverview()
  const lines = [
    (data.gmvMax?.pendingDays ?? 0) > 0 ? t('syncTiktokAds', { count: data.gmvMax!.pendingDays! }) : null,
    data.gmvMax?.products.pending ? t('syncTiktokProducts') : null,
    (data.tiktokShop?.pendingDays ?? 0) > 0 ? t('syncTiktokShop', { count: data.tiktokShop!.pendingDays }) : null,
  ].filter((line): line is string => line !== null)
  return <SyncNotice severity={(data.gmvMax?.pendingDays ?? 0) > 0 || (data.tiktokShop?.pendingDays ?? 0) > 0 ? 'warning' : 'info'} title={t('syncTiktokTitle')} lines={lines} footer={t('syncAutoUpdate')} />
}

export const tiktokSyncWidget: OverviewWidget = {
  id: 'tiktok-sync',
  band: 'notice',
  order: 20,
  sources: [],
  size: { xs: 12 },
  // Only while something is still coming in.
  when: ({ data }) => (data.gmvMax?.pendingDays ?? 0) > 0 || Boolean(data.gmvMax?.products.pending) || (data.tiktokShop?.pendingDays ?? 0) > 0,
  Component: TiktokSync,
}
