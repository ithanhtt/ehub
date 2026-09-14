'use client'

import { useOverview } from '../../context'
import type { OverviewWidget } from '../../types'
import { TopProductsSummary } from './top-products-card'

/** The products selling most in the period (see top-products-card). */
function TopProducts() {
  const { data, periodLabel, now } = useOverview()
  if (!data.sapo) return null
  return <TopProductsSummary products={data.sapo.products} periodLabel={periodLabel} totals={data.sapo.totals} now={now} />
}

export const topProductsWidget: OverviewWidget = {
  id: 'top-products',
  band: 'insight',
  order: 10,
  sources: ['sapo'],
  size: { xs: 12, md: 6, lg: 4 },
  Component: TopProducts,
}
