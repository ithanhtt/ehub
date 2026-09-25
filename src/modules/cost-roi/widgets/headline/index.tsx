'use client'

import { useTranslations } from 'next-intl'
import Grid from '@mui/material/Grid'
import { StatTile } from '@/components/charts/stat-tile'
import { SERIES } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { roiOf, useCostRoi } from '../../shared'

/**
 * The period's money in one row: GMV ordered, the vouchers on it (TikTok's and
 * the shop's), GMV Max spend and what it brought, creators' commission,
 * booking fees, and bad reviews — each tile shown when its source is connected.
 */
function CostRoiHeadline() {
  const t = useTranslations('reports.costRoi')
  const tr = useTranslations('reports')
  const { report, connected } = useCostRoi()
  const { money, exact, number, percent, count } = useReportFigures()
  const { totals } = report.data
  const shop = connected.has('tiktokShop')
  const ads = connected.has('tiktokAds')
  const booking = connected.has('booking')
  const pending = report.sources.tiktokShop.pendingDays > 0 ? tr('syncTip', { count: report.sources.tiktokShop.pendingDays }) : undefined
  const roi = roiOf(totals.adsRevenue, totals.adsCost)
  const voucher = totals.platformVoucher + totals.sellerVoucher
  const size = { xs: 6, md: 3 }

  return (
    <Grid container spacing={2}>
      {shop ? (
        <>
          <Grid size={size}>
            <StatTile
              label={t('gmv')}
              value={totals.gmv}
              format={money}
              exact={exact(totals.gmv)}
              pending={pending}
              accent={SERIES.blue}
              footnote={t('netGmvNote', { value: money(totals.netGmv) })}
            />
          </Grid>
          <Grid size={size}>
            <StatTile
              label={t('platformVoucher')}
              value={totals.platformVoucher}
              format={money}
              exact={exact(totals.platformVoucher)}
              pending={pending}
              accent={SERIES.aqua}
              footnote={totals.netGmv > 0 ? t('ofGmv', { share: percent(totals.platformVoucher / totals.netGmv) }) : undefined}
            />
          </Grid>
          <Grid size={size}>
            <StatTile
              label={t('sellerVoucher')}
              value={totals.sellerVoucher}
              format={money}
              exact={exact(totals.sellerVoucher)}
              pending={pending}
              accent={SERIES.orange}
              footnote={totals.netGmv > 0 ? t('ofGmv', { share: percent(totals.sellerVoucher / totals.netGmv) }) : t('voucherTotal', { value: money(voucher) })}
            />
          </Grid>
          <Grid size={size}>
            <StatTile
              label={t('commission')}
              value={totals.commission}
              format={money}
              exact={exact(totals.commission)}
              pending={pending}
              accent={SERIES.orange}
              footnote={t('commissionNote')}
            />
          </Grid>
        </>
      ) : null}
      {ads ? (
        <>
          <Grid size={size}>
            <StatTile label={t('adsCost')} value={totals.adsCost} format={money} exact={exact(totals.adsCost)} accent={SERIES.orange} footnote={roi === null ? undefined : t('roiNote', { roi: number(roi, 2) })} />
          </Grid>
          <Grid size={size}>
            <StatTile label={t('adsRevenue')} value={totals.adsRevenue} format={money} exact={exact(totals.adsRevenue)} accent={SERIES.blue} footnote={totals.gmv > 0 ? t('ofGmvOrdered', { share: percent(totals.adsRevenue / totals.gmv) }) : undefined} />
          </Grid>
        </>
      ) : null}
      {booking ? (
        <Grid size={size}>
          <StatTile label={t('bookingCost')} value={totals.bookingCost} format={money} exact={exact(totals.bookingCost)} accent={SERIES.orange} footnote={t('bookingCostNote')} />
        </Grid>
      ) : null}
      {shop ? (
        <Grid size={size}>
          <StatTile
            label={t('badReviews')}
            value={totals.badReviews}
            format={count}
            integer
            accent={SERIES.orange}
            footnote={totals.reviews > 0 ? t('badShare', { share: percent(totals.badReviews / totals.reviews), reviews: count(totals.reviews) }) : t('reviewsNone')}
          />
        </Grid>
      ) : null}
    </Grid>
  )
}

export const costRoiHeadlineWidget: ReportWidget = {
  id: 'cost-roi-headline',
  band: 'headline',
  order: 10,
  sources: [],
  size: { xs: 12 },
  Component: CostRoiHeadline,
}
