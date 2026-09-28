import type { AdjustmentMetric, AdjustmentSpread } from '@/core/db/schema/adjustments'

export type { AdjustmentMetric, AdjustmentSpread }

export interface AdjustmentRow {
  id: string
  projectId: string
  metric: AdjustmentMetric
  amount: number
  spread: AdjustmentSpread
  startOn: string
  endOn: string
  note: string | null
  createdBy: string | null
  updatedAt: string
}

export interface AdjustmentsOverview {
  projects: Array<{ id: string; name: string }>
  adjustments: AdjustmentRow[]
}

/** What the form sends; `id` present to change an existing adjustment. */
export interface AdjustmentInput {
  id?: string
  projectId: string
  metric: AdjustmentMetric
  amount: number
  spread: AdjustmentSpread
  startOn: string
  endOn: string
  note?: string | null
}

export type AdjustmentOutcome = { ok: true } | { ok: false; message: 'forbidden' | 'validation' | 'notFound' | 'error' }
