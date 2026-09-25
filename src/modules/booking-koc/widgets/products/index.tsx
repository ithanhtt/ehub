'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { TableCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import { correlation } from '@/modules/analytics/shared/stats'
import type { ReportWidget } from '@/modules/analytics/types'
import { useBookingKoc } from '../../shared'

/**
 * Per product: booked videos aired and how many a day on the days they came,
 * all the videos posted with it in the cart and the organic ones among them,
 * the videos GMV Max ran for it — and, over the buckets, how its booked and
 * organic videos move together.
 */
function BookingKocProducts() {
  const t = useTranslations('reports.bookingKoc')
  const tr = useTranslations('reports')
  const { report, connected, periodLabel } = useBookingKoc()
  const { count, number } = useReportFigures()
  const badge = useSyncBadge(['tiktokShop'])
  const { products } = report.data
  const shop = connected.has('tiktokShop')
  const adsOn = connected.has('tiktokAds')

  return (
    <TableCard
      title={t('productsTitle')}
      subtitle={periodLabel}
      badge={badge}
      empty={tr('noData')}
      note={t('productsNote')}
      table={{
        columns: [
          t('product'),
          t('booked'),
          { label: t('perAirDay'), tip: t('perAirDayTip') },
          ...(shop ? [t('postedVideos'), t('organicVideos'), { label: t('rBookedOrganic'), tip: tr('rTip') }] : []),
          ...(adsOn ? [t('adsVideos')] : []),
        ],
        rows: products.map((p) => [
          p.name,
          tableCell(p.booked, count),
          tableCell(p.airDays > 0 ? p.booked / p.airDays : null, (v) => number(v, 1)),
          ...(shop
            ? [tableCell(p.postedVideos, count), tableCell(p.organicVideos, count), tableCell(correlation(p.bookedByBucket, p.organicByBucket).r, (v) => number(v, 2))]
            : []),
          ...(adsOn ? [tableCell(p.adsVideos, count)] : []),
        ]),
      }}
    />
  )
}

export const bookingKocProductsWidget: ReportWidget = {
  id: 'booking-koc-products',
  band: 'insight',
  order: 10,
  sources: [],
  size: { xs: 12 },
  Component: BookingKocProducts,
}
