'use client'

import { useReport } from '@/modules/analytics/context'
import type { OrderCancelData } from './types'

/** The module's answer, for its widgets. */
export const useOrderCancel = () => useReport<OrderCancelData>()

/**
 * The hour with most orders, and the hour whose orders are cancelled least —
 * among hours with enough orders to say (a quiet 4 a.m. with one order and no
 * cancellation is not the best hour to sell). Null when there is nothing to go on.
 */
export function bestHours(created: number[], cancelled: number[]) {
  const total = created.reduce((sum, value) => sum + value, 0)
  if (total === 0) return { busiest: null, safest: null, floor: 0 }
  const busiest = created.indexOf(Math.max(...created))
  const floor = Math.max(3, Math.ceil(total * 0.02))
  let safest: number | null = null
  let best = Infinity
  created.forEach((orders, hour) => {
    if (orders < floor) return
    const rate = cancelled[hour] / orders
    if (rate < best || (rate === best && safest !== null && orders > created[safest])) {
      best = rate
      safest = hour
    }
  })
  return { busiest, safest, floor }
}

export const hourSpan = (hour: number) => `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`
