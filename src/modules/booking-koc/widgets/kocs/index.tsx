'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { TableCard, useSyncBadge } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useBookingKoc } from '../../shared'

/**
 * Per booked KOC: videos booked and their fees; the videos TikTok saw them
 * post with the cart in the period and those videos' GMV on the day; and
 * their booked videos GMV Max put money behind, with what it spent.
 */
function BookingKocKocs() {
  const t = useTranslations('reports.bookingKoc')
  const { report, connected, periodLabel } = useBookingKoc()
  const { count, exact } = useReportFigures()
  const badge = useSyncBadge(['tiktokShop'])
  const { kocs } = report.data
  const shop = connected.has('tiktokShop')
  const adsOn = connected.has('tiktokAds')

  return (
    <TableCard
      title={t('kocsTitle')}
      subtitle={periodLabel}
      badge={badge}
      empty={t('kocsEmpty')}
      table={{
        columns: [
          t('koc'),
          t('booked'),
          t('bookingCost'),
          ...(shop ? [{ label: t('kocPosted'), tip: t('kocPostedTip') }, { label: t('kocPostedGmv'), tip: t('kocPostedGmvTip') }] : []),
          ...(adsOn ? [t('bookedOnAds'), t('adsCostOnBooked')] : []),
        ],
        rows: kocs.map((k) => [
          k.name ? `@${k.koc} (${k.name})` : `@${k.koc}`,
          tableCell(k.booked, count),
          tableCell(k.cost, exact),
          ...(shop ? [tableCell(k.postedVideos, count), tableCell(k.postedGmv, exact)] : []),
          ...(adsOn ? [tableCell(k.onAds, count), tableCell(k.adsCost, exact)] : []),
        ]),
      }}
    />
  )
}

export const bookingKocKocsWidget: ReportWidget = {
  id: 'booking-koc-kocs',
  band: 'table',
  order: 10,
  sources: [],
  size: { xs: 12 },
  Component: BookingKocKocs,
}
