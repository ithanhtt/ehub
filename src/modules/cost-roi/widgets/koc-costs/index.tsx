'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { TableCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useCostRoi } from '../../shared'

/**
 * Per KOC: the GMV their content brought, and everything it cost — their
 * commission, the GMV Max spend on their videos, their booking fees — with
 * cost as a share of GMV. Biggest GMV first.
 */
function CostRoiKocCosts() {
  const t = useTranslations('reports.costRoi')
  const tr = useTranslations('reports')
  const { report, connected, periodLabel } = useCostRoi()
  const { exact, count, percent, money } = useReportFigures()
  const badge = useSyncBadge(['tiktokShop'])
  const { kocs, unattributedAdsCost } = report.data
  const ads = connected.has('tiktokAds')
  const booking = connected.has('booking')

  return (
    <TableCard
      title={t('kocTitle')}
      subtitle={periodLabel}
      badge={badge}
      empty={t('kocEmpty')}
      note={ads && unattributedAdsCost > 0 ? t('unattributedNote', { value: money(unattributedAdsCost) }) : t('kocNote')}
      table={{
        columns: [
          t('koc'),
          t('gmvKoc'),
          t('orders'),
          t('commission'),
          ...(ads ? [t('adsCost'), t('adsRevenue')] : []),
          ...(booking ? [t('bookingCost')] : []),
          { label: t('totalCost'), tip: t('totalCostTip') },
          { label: t('costShare'), tip: t('costShareTip') },
        ],
        rows: kocs.map((k) => [
          `@${k.koc}`,
          tableCell(k.gmv, exact),
          tableCell(k.orders, count),
          tableCell(k.commission, exact),
          ...(ads ? [tableCell(k.adsCost, exact), tableCell(k.adsRevenue, exact)] : []),
          ...(booking ? [tableCell(k.bookingCost, exact)] : []),
          tableCell(k.totalCost, exact),
          tableCell(k.gmv > 0 ? k.totalCost / k.gmv : null, (v) => percent(v)),
        ]),
      }}
    />
  )
}

export const costRoiKocWidget: ReportWidget = {
  id: 'cost-roi-kocs',
  band: 'insight',
  order: 10,
  sources: ['tiktokShop'],
  size: { xs: 12 },
  Component: CostRoiKocCosts,
}
