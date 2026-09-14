'use client'

import { useOverview } from '../../context'
import type { OverviewWidget } from '../../types'
import { OrderHoursSummary } from './order-hours-card'

/** When in the day orders come in, over the period (see order-hours-card). */
function OrderHours() {
  const { data, range } = useOverview()
  if (!data.sapo) return null
  return <OrderHoursSummary hours={data.sapo.hours} range={range} pendingDays={data.sapo.sync.current} />
}

export const orderHoursWidget: OverviewWidget = {
  id: 'order-hours',
  band: 'insight',
  order: 20,
  sources: ['sapo'],
  size: { xs: 12, md: 6, lg: 4 },
  Component: OrderHours,
}
