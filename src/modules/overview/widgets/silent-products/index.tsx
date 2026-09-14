'use client'

import { useOverview } from '../../context'
import type { OverviewWidget } from '../../types'
import { SilentProductsSummary } from './silent-products-card'

/** Products with no new order for a while (see silent-products-card). */
function SilentProducts() {
  const { data, periodLabel, now, projectId } = useOverview()
  if (!data.sapo) return null
  return <SilentProductsSummary products={data.sapo.products} periodLabel={periodLabel} now={now} projectId={projectId} />
}

export const silentProductsWidget: OverviewWidget = {
  id: 'silent-products',
  band: 'insight',
  order: 30,
  sources: ['sapo'],
  size: { xs: 12, md: 6, lg: 4 },
  Component: SilentProducts,
}
