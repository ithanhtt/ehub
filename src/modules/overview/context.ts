'use client'

import { createContext, useContext } from 'react'
import type { DashboardData, DashboardRange } from './data/types'

/** What every widget draws from: the page's answer and the period it covers. */
export interface OverviewContextValue {
  projectId: string
  /** The server's answer for the period (each source's part, null when not connected). */
  data: DashboardData
  /** The period the answer covers — the one on screen, while another may be loading. */
  range: DashboardRange
  isToday: boolean
  /** The period in words: "hôm nay", "7 ngày qua", "01/09 – 10/09". */
  periodLabel: string
  /** What each change is measured against: "so với hôm qua cùng giờ" and the like. */
  vsLabel: string
  /** The page's one-second clock, epoch ms. */
  now: number
}

const OverviewContext = createContext<OverviewContextValue | null>(null)

export const OverviewProvider = OverviewContext.Provider

/** The page's context, for a widget. */
export function useOverview(): OverviewContextValue {
  const value = useContext(OverviewContext)
  if (!value) throw new Error('useOverview is only available inside the overview page')
  return value
}
