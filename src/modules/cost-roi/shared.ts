'use client'

import { useReport } from '@/modules/analytics/context'
import type { CostRoiData } from './types'

/** The module's answer, for its widgets. */
export const useCostRoi = () => useReport<CostRoiData>()

/** Revenue ÷ spend, or null with no spend. */
export const roiOf = (revenue: number, cost: number) => (cost > 0 ? revenue / cost : null)
