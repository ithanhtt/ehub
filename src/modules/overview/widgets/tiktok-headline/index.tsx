'use client'

import { useTranslations } from 'next-intl'
import Grid from '@mui/material/Grid'
import { StatTile } from '@/components/charts/stat-tile'
import { useOverview } from '../../context'
import { useFigures } from '../../shared/format'
import { GroupLabel } from '../../shared/group-label'
import { change, COST, GMV, ORDERS } from '../../shared/series'
import type { OverviewWidget } from '../../types'

/** TikTok GMV Max's headline numbers — orders, GMV, spend — each against the previous period. */
function TiktokHeadline() {
  const t = useTranslations('dashboard')
  const { data, vsLabel } = useOverview()
  const { money, exact, count, number } = useFigures()
  const gmv = data.gmvMax
  if (!gmv) return null

  return (
    <>
      <GroupLabel>{t('groupTiktok')}</GroupLabel>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatTile
            label={t('orders')}
            value={gmv.totals.orders}
            format={count}
            formatStep={count}
            integer
            delta={change(gmv.totals.orders, gmv.previous?.orders, true)}
            deltaLabel={vsLabel}
            accent={ORDERS}
            footnote={gmv.totals.orders > 0 ? t('aovNote', { value: exact(gmv.totals.revenue / gmv.totals.orders) }) : undefined}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatTile
            label={t('gmv')}
            value={gmv.totals.revenue}
            format={money}
            formatStep={money}
            exact={exact(gmv.totals.revenue)}
            delta={change(gmv.totals.revenue, gmv.previous?.revenue, true)}
            deltaLabel={vsLabel}
            accent={GMV}
            footnote={gmv.totals.cost > 0 ? t('roiNote', { value: number(gmv.totals.revenue / gmv.totals.cost, 2) }) : undefined}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile
            label={t('cost')}
            value={gmv.totals.cost}
            format={money}
            formatStep={money}
            exact={exact(gmv.totals.cost)}
            delta={change(gmv.totals.cost, gmv.previous?.cost, false)}
            deltaLabel={vsLabel}
            accent={COST}
            footnote={gmv.totals.orders > 0 ? t('cpoNote', { value: exact(gmv.totals.cost / gmv.totals.orders) }) : undefined}
          />
        </Grid>
      </Grid>
    </>
  )
}

export const tiktokHeadlineWidget: OverviewWidget = {
  id: 'tiktok-headline',
  band: 'headline',
  order: 10,
  sources: ['tiktok'],
  // Half the row beside another source's numbers, the whole row alone.
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 6 : 12 }),
  Component: TiktokHeadline,
}
