'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { TableCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useOrderCancel } from '../../shared'

/**
 * Per product: Sapo orders, cancellations and their share, and — matched by
 * SKU — the orders GMV Max brought it. Busiest first; any column sorts.
 */
function OrderCancelProducts() {
  const t = useTranslations('reports.orderCancel')
  const tr = useTranslations('reports')
  const { report, connected, periodLabel } = useOrderCancel()
  const { count, exact, percent } = useReportFigures()
  const badge = useSyncBadge(['sapo'])
  const { products, matching } = report.data
  const ads = connected.has('tiktokAds')

  const note = !ads
    ? undefined
    : matching.mode === 'none'
      ? t('matchNone')
      : t('matchNote', { matched: count(matching.matchedAdsOrders), unmatched: count(matching.unmatchedAdsOrders) })

  return (
    <TableCard
      title={t('productsTitle')}
      subtitle={periodLabel}
      badge={badge}
      empty={tr('noData')}
      note={note}
      limit={10}
      table={{
        columns: [
          t('product'),
          t('created'),
          t('cancelled'),
          { label: t('cancelRateColumn'), tip: t('cancelRateTip') },
          ...(ads ? [{ label: t('adsOrders'), tip: t('adsOrdersTip') }, t('adsRevenue'), { label: t('adsShare'), tip: t('adsShareTip') }] : []),
        ],
        rows: products.map((p) => [
          p.name,
          tableCell(p.created, count),
          tableCell(p.cancelled, count),
          tableCell(p.created > 0 ? p.cancelled / p.created : null, (v) => percent(v)),
          ...(ads
            ? [
                tableCell(p.adsOrders, count),
                tableCell(p.adsRevenue, exact),
                tableCell(p.adsOrders !== null && p.created > 0 ? p.adsOrders / p.created : null, (v) => percent(v, 0)),
              ]
            : []),
        ]),
      }}
    />
  )
}

export const orderCancelProductsWidget: ReportWidget = {
  id: 'order-cancel-products',
  band: 'table',
  order: 10,
  sources: ['sapo'],
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 8 : 12 }),
  Component: OrderCancelProducts,
}
