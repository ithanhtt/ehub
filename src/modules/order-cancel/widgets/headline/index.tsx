'use client'

import { useTranslations } from 'next-intl'
import Grid from '@mui/material/Grid'
import { StatTile } from '@/components/charts/stat-tile'
import { SERIES } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { bestHours, hourSpan, useOrderCancel } from '../../shared'

/**
 * The period in five numbers: Sapo's orders and cancellations, the orders
 * GMV Max brought, the busiest hour, and the hour cancelled least.
 */
function OrderCancelHeadline() {
  const t = useTranslations('reports.orderCancel')
  const tr = useTranslations('reports')
  const { report, connected } = useOrderCancel()
  const { count, money, percent } = useReportFigures()
  const { totals, hours } = report.data
  const pending = report.sources.sapo.pendingDays > 0 ? tr('syncTip', { count: report.sources.sapo.pendingDays }) : undefined
  const rate = totals.created > 0 ? totals.cancelled / totals.created : null
  const { busiest, safest } = bestHours(hours.created, hours.cancelled)
  const ads = connected.has('tiktokAds')
  const size = { xs: 6, md: 4, lg: ads ? 2.4 : 3 }

  return (
    <Grid container spacing={2}>
      <Grid size={size}>
        <StatTile label={t('created')} value={totals.created} format={count} integer pending={pending} accent={SERIES.aqua} footnote={t('createdNote')} />
      </Grid>
      <Grid size={size}>
        <StatTile
          label={t('cancelled')}
          value={totals.cancelled}
          format={count}
          integer
          pending={pending}
          accent={SERIES.orange}
          footnote={rate === null ? undefined : t('cancelRate', { rate: percent(rate) })}
        />
      </Grid>
      {ads ? (
        <Grid size={size}>
          <StatTile label={t('adsOrders')} value={totals.adsOrders} format={count} integer accent={SERIES.blue} footnote={t('adsCostNote', { value: money(totals.adsCost) })} />
        </Grid>
      ) : null}
      <Grid size={size}>
        <StatTile
          label={t('busiestHour')}
          value={busiest}
          format={(hour) => hourSpan(Math.round(hour))}
          integer
          footnote={busiest === null ? undefined : t('busiestNote', { orders: count(hours.created[busiest]) })}
        />
      </Grid>
      <Grid size={size}>
        <StatTile
          label={t('safestHour')}
          value={safest}
          format={(hour) => hourSpan(Math.round(hour))}
          integer
          footnote={safest === null ? t('safestNone') : t('safestNote', { rate: percent(hours.cancelled[safest] / hours.created[safest]) })}
        />
      </Grid>
    </Grid>
  )
}

export const orderCancelHeadlineWidget: ReportWidget = {
  id: 'order-cancel-headline',
  band: 'headline',
  order: 10,
  sources: ['sapo'],
  size: { xs: 12 },
  Component: OrderCancelHeadline,
}
