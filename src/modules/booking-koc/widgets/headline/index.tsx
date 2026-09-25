'use client'

import { useTranslations } from 'next-intl'
import Grid from '@mui/material/Grid'
import { StatTile } from '@/components/charts/stat-tile'
import { SERIES } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useBookingKoc } from '../../shared'

/**
 * The period in six numbers: booked videos aired and what they cost; all the
 * videos posted with the cart, and the organic ones among them; booking's
 * effect on organic videos (a day with booking against a day without); and
 * the videos GMV Max spent on, with the booked ones among them.
 */
function BookingKocHeadline() {
  const t = useTranslations('reports.bookingKoc')
  const tr = useTranslations('reports')
  const { report, connected } = useBookingKoc()
  const { period } = report
  const { count, money, exact, percent, number } = useReportFigures()
  const { totals, impact } = report.data
  const shop = connected.has('tiktokShop')
  const adsOn = connected.has('tiktokAds')
  const pending = report.sources.tiktokShop.pendingDays > 0 ? tr('syncTip', { count: report.sources.tiktokShop.pendingDays }) : undefined
  const days = period.granularity === 'day' && report.data.buckets.length > 0 ? report.data.buckets.length : null
  const lift =
    impact.organicWithBooking !== null && impact.organicWithout !== null && impact.organicWithout > 0
      ? impact.organicWithBooking / impact.organicWithout - 1
      : null
  const size = { xs: 6, md: 4, lg: 2 }

  return (
    <Grid container spacing={2}>
      <Grid size={size}>
        <StatTile
          label={t('booked')}
          value={totals.booked}
          format={count}
          integer
          accent={SERIES.aqua}
          footnote={days ? t('perDay', { value: number(totals.booked / days, 1) }) : t('kocsNote', { count: totals.bookedKocs })}
        />
      </Grid>
      <Grid size={size}>
        <StatTile
          label={t('bookingCost')}
          value={totals.bookingCost}
          format={money}
          exact={exact(totals.bookingCost)}
          accent={SERIES.orange}
          footnote={totals.booked > 0 ? t('perVideo', { value: money(totals.bookingCost / totals.booked) }) : undefined}
        />
      </Grid>
      {shop ? (
        <>
          <Grid size={size}>
            <StatTile
              label={t('postedVideos')}
              value={totals.postedVideos}
              format={count}
              integer
              pending={pending}
              accent={SERIES.blue}
              footnote={totals.postedVideos > 0 ? t('bookedShare', { value: percent(Math.min(1, totals.booked / totals.postedVideos)) }) : t('postedNote')}
            />
          </Grid>
          <Grid size={size}>
            <StatTile label={t('organicVideos')} value={totals.organicVideos} format={count} integer pending={pending} footnote={t('organicNote')} />
          </Grid>
          <Grid size={size}>
            <StatTile
              label={t('impact')}
              value={lift}
              format={(v) => `${v >= 0 ? '+' : ''}${percent(v)}`}
              footnote={
                impact.organicWithBooking !== null && impact.organicWithout !== null
                  ? t('impactNote', { with: number(impact.organicWithBooking, 1), without: number(impact.organicWithout, 1) })
                  : t('impactNeedsDays')
              }
            />
          </Grid>
        </>
      ) : null}
      {adsOn ? (
        <Grid size={size}>
          <StatTile
            label={t('adsVideos')}
            value={totals.adsVideos}
            format={count}
            integer

            footnote={t('bookedOnAdsNote', { count: count(totals.bookedOnAds), cost: money(totals.adsCostOnBooked) })}
          />
        </Grid>
      ) : null}
    </Grid>
  )
}

export const bookingKocHeadlineWidget: ReportWidget = {
  id: 'booking-koc-headline',
  band: 'headline',
  order: 10,
  sources: [],
  size: { xs: 12 },
  Component: BookingKocHeadline,
}
