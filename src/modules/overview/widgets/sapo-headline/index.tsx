'use client'

import { useTranslations } from 'next-intl'
import Grid from '@mui/material/Grid'
import { StatTile } from '@/components/charts/stat-tile'
import { useOverview } from '../../context'
import { useFigures } from '../../shared/format'
import { GroupLabel } from '../../shared/group-label'
import { change, COST, GMV, ORDERS } from '../../shared/series'
import type { OverviewWidget } from '../../types'

/**
 * Sapo's headline numbers — orders created, cancelled, revenue — each against
 * the previous period. Revenue is Sapo's own Tổng doanh thu, net revenue
 * under it, so the tile reads as Sapo's revenue report does. While days of
 * the period itself are still being fetched, each tile says its figure may be
 * short; while refunds still are, the revenue tile says it may be high.
 */
function SapoHeadline() {
  const t = useTranslations('dashboard')
  const { data, vsLabel } = useOverview()
  const { money, exact, count, number } = useFigures()
  const sapo = data.sapo
  if (!sapo) return null

  const cancelRate = sapo.totals.created > 0 ? sapo.totals.cancelled / sapo.totals.created : null
  const pending = sapo.sync.current > 0 ? t('syncChipTip') : undefined
  const sales = sapo.totals.sales
  const revenuePending = pending ?? (sapo.sync.returns > 0 || sapo.sync.catchingUp ? t('syncRevenueTip') : undefined)

  return (
    <>
      <GroupLabel>{t('groupSapo')}</GroupLabel>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatTile
            label={t('ordersCreated')}
            pending={pending}
            value={sapo.totals.created}
            format={count}
            formatStep={count}
            integer
            delta={change(sapo.totals.created, sapo.previous?.created, true)}
            deltaLabel={vsLabel}
            accent={ORDERS}
            footnote={
              // Only the period's own missing days make this count short.
              sapo.sync.current > 0
                ? t('syncing', { count: sapo.sync.current })
                : sapo.totals.created > 0
                  ? t('aovNote', { value: exact(sapo.totals.gmv / sapo.totals.created) })
                  : undefined
            }
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatTile
            label={t('ordersCancelled')}
            pending={pending}
            value={sapo.totals.cancelled}
            format={count}
            formatStep={count}
            integer
            delta={change(sapo.totals.cancelled, sapo.previous?.cancelled, false)}
            deltaLabel={vsLabel}
            accent={COST}
            footnote={cancelRate === null ? undefined : t('cancelRate', { rate: `${number(cancelRate * 100, 1)}%` })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile
            label={t('revenueLabel')}
            pending={revenuePending}
            value={sales.revenue}
            format={money}
            formatStep={money}
            exact={exact(sales.revenue)}
            delta={change(sales.revenue, sapo.previous?.sales.revenue, true)}
            deltaLabel={vsLabel}
            accent={GMV}
            footnote={t('netRevenueNote', { value: money(sales.netRevenue) })}
          />
        </Grid>
      </Grid>
    </>
  )
}

export const sapoHeadlineWidget: OverviewWidget = {
  id: 'sapo-headline',
  band: 'headline',
  order: 20,
  sources: ['sapo'],
  // Half the row beside another source's numbers, the whole row alone.
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 6 : 12 }),
  Component: SapoHeadline,
}
