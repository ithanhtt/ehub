'use client'

import { useTranslations } from 'next-intl'
import Grid from '@mui/material/Grid'
import { StatTile } from '@/components/charts/stat-tile'
import { useOverview } from '../../context'
import { useFigures } from '../../shared/format'
import { change, COST, GMV, ORDERS } from '../../shared/series'
import type { OverviewWidget } from '../../types'

const known = (values: Array<number | null | undefined>) => values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

type Tile = React.ComponentProps<typeof StatTile> & { key: string }

/** Two short lines of context under a tile's change. */
const lines = (first: string, second?: string) => (
  <>
    {first}
    {second ? (
      <>
        <br />
        {second}
      </>
    ) : null}
  </>
)

/**
 * The page's scorecard: the four numbers that say how things stand — the
 * store's revenue (Sapo), the TikTok Shop's sales, what the ads cost and what
 * they return (ROI) — each large, against the period before, with its trend,
 * and under it the little else a glance needs (orders, cancellations, the
 * average order, the cost of an order). Read in a few seconds, two by two on
 * a phone. A source the project has not connected leaves its tile out.
 */
function Scorecard() {
  const t = useTranslations('dashboard')
  const { data, vsLabel } = useOverview()
  const { money, exact, count, number } = useFigures()
  const { sapo, tiktokShop: shop, gmvMax: gmv } = data
  const percent = (part: number, whole: number) => (whole > 0 ? `${number((part / whole) * 100, 1)}%` : '—')

  const tiles: Tile[] = []
  if (sapo) {
    const { created, cancelled, net } = sapo.totals
    const revenue = sapo.totals.sales.revenue
    const kept = created - cancelled
    tiles.push({
      key: 'sapo',
      label: t('scoreRevenue'),
      pending: sapo.sync.current > 0 ? t('syncChipTip') : undefined,
      value: revenue,
      format: money,
      formatStep: money,
      exact: exact(revenue),
      delta: change(revenue, sapo.previous?.sales.revenue, true),
      deltaLabel: vsLabel,
      trend: known(sapo.byTime.map((b) => b.revenue)),
      accent: GMV,
      footnote: lines(
        t('scoreOrdersLine', { orders: count(created), cancelled: count(cancelled), rate: percent(cancelled, created) }),
        kept > 0 ? t('scoreAovLine', { aov: money(net / kept) }) : undefined,
      ),
    })
  }
  if (shop) {
    const { orders, cancelled, net } = shop.totals
    const kept = orders - cancelled
    tiles.push({
      key: 'shop',
      label: t('scoreShop'),
      pending: shop.pendingDays > 0 ? t('syncChipTip') : undefined,
      value: net,
      format: money,
      formatStep: money,
      exact: exact(net),
      delta: change(net, shop.previous?.net, true),
      deltaLabel: vsLabel,
      trend: known(shop.byTime),
      accent: ORDERS,
      footnote: lines(
        t('scoreOrdersLine', { orders: count(orders), cancelled: count(cancelled), rate: percent(cancelled, orders) }),
        kept > 0 ? t('scoreAovLine', { aov: money(net / kept) }) : undefined,
      ),
    })
  }
  if (gmv) {
    const { cost, revenue, orders } = gmv.totals
    const roi = cost > 0 ? revenue / cost : null
    const previousRoi = gmv.previous && gmv.previous.cost > 0 ? gmv.previous.revenue / gmv.previous.cost : null
    // Days still being read (gmv-max.ts): the figures are short until they land.
    const gmvPending = (gmv.pendingDays ?? 0) > 0 ? t('syncChipTip') : undefined
    tiles.push({
      key: 'cost',
      label: t('scoreCost'),
      pending: gmvPending,
      value: cost,
      format: money,
      formatStep: money,
      exact: exact(cost),
      delta: change(cost, gmv.previous?.cost, false),
      deltaLabel: vsLabel,
      trend: known(gmv.byTime.map((b) => b.cost)),
      accent: COST,
      footnote: lines(t('scoreAdsOrdersLine', { orders: count(orders) }), orders > 0 ? t('scoreCpoLine', { cpo: money(cost / orders) }) : undefined),
    })
    tiles.push({
      key: 'roi',
      label: t('scoreRoi'),
      pending: gmvPending,
      value: roi,
      format: (v) => number(v, 2),
      delta: roi === null ? null : change(roi, previousRoi, true),
      deltaLabel: vsLabel,
      trend: known(gmv.byTime.map((b) => (b.cost && b.revenue !== null ? b.revenue / b.cost : null))),
      accent: GMV,
      footnote: lines(t('scoreRoiNote', { gmv: money(revenue) }), orders > 0 ? t('scoreAovLine', { aov: money(revenue / orders) }) : undefined),
    })
  }
  if (tiles.length === 0) return null

  // Four across on a desk (or as many as there are), two by two on a phone; a lone third takes its row.
  const across = 12 / Math.min(4, tiles.length)
  return (
    <Grid container spacing={{ xs: 1.5, sm: 2 }}>
      {tiles.map(({ key, ...tile }, i) => (
        <Grid key={key} size={{ xs: tiles.length === 3 && i === 2 ? 12 : 6, md: across }}>
          <StatTile {...tile} />
        </Grid>
      ))}
    </Grid>
  )
}

export const scorecardWidget: OverviewWidget = {
  id: 'scorecard',
  band: 'headline',
  order: 10,
  // Any source will do: it shows the tiles of the ones there are.
  sources: [],
  size: { xs: 12 },
  Component: Scorecard,
}
