'use client'

import { useTranslations } from 'next-intl'
import Grid from '@mui/material/Grid'
import { StatTile } from '@/components/charts/stat-tile'
import { SERIES } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useVideoGmv } from '../../shared'

/** Booked videos aired, all new videos with a product, booking's share of them, and product GMV. */
function VideoGmvHeadline() {
  const t = useTranslations('reports.videoGmv')
  const tr = useTranslations('reports')
  const { report, connected } = useVideoGmv()
  const { count, money, exact, percent } = useReportFigures()
  const { totals, analyticsThrough } = report.data
  const booking = connected.has('booking')
  const shop = connected.has('tiktokShop')
  const pending = report.sources.tiktokShop.pendingDays > 0 ? tr('syncTip', { count: report.sources.tiktokShop.pendingDays }) : undefined
  const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
  const size = { xs: 6, md: 3 }

  return (
    <Grid container spacing={2}>
      {booking ? (
        <Grid size={size}>
          <StatTile label={t('booked')} value={totals.booked} format={count} integer accent={SERIES.aqua} footnote={shop ? t('bookedAttachedNote', { count: count(totals.bookedAttached) }) : undefined} />
        </Grid>
      ) : null}
      {shop ? (
        <>
          <Grid size={size}>
            <StatTile
              label={t('attached')}
              value={totals.attached}
              format={count}
              integer
              pending={pending}
              accent={SERIES.blue}
              footnote={analyticsThrough ? t('through', { date: dayMonth(analyticsThrough) }) : t('noAnalytics')}
            />
          </Grid>
          {booking ? (
            <Grid size={size}>
              <StatTile label={t('bookedShare')} value={totals.attached > 0 ? totals.booked / totals.attached : null} format={(v) => percent(v)} footnote={t('bookedShareNote')} />
            </Grid>
          ) : null}
          <Grid size={size}>
            <StatTile
              label={t('gmv')}
              value={totals.gmv}
              format={money}
              exact={exact(totals.gmv)}
              pending={pending}
              accent={SERIES.blue}
              footnote={totals.attached > 0 ? t('gmvPerVideo', { value: money(totals.gmv / totals.attached) }) : undefined}
            />
          </Grid>
        </>
      ) : null}
    </Grid>
  )
}

export const videoGmvHeadlineWidget: ReportWidget = {
  id: 'video-gmv-headline',
  band: 'headline',
  order: 10,
  sources: [],
  size: { xs: 12 },
  Component: VideoGmvHeadline,
}
