'use client'

import { createContext, useContext } from 'react'
import type { Granularity } from './period'
import type { ReportEnvelope, ReportSource } from './types'

/** What every report widget draws from: the module's answer and how it is grouped. */
export interface ReportContextValue<T = unknown> {
  projectId: string
  report: ReportEnvelope<T>
  granularity: Granularity
  /** The period in words: "30 ngày qua", "01/09 – 10/09". */
  periodLabel: string
  /** The sources the project has connected. */
  connected: ReadonlySet<ReportSource>
}

const ReportContext = createContext<ReportContextValue | null>(null)

export const ReportProvider = ReportContext.Provider

/** The page's answer, typed by the module that reads it. */
export function useReport<T>(): ReportContextValue<T> {
  const value = useContext(ReportContext)
  if (!value) throw new Error('useReport is only available inside a report page')
  return value as ReportContextValue<T>
}
