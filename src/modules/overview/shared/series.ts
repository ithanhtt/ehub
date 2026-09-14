import type { Delta } from '@/components/charts/stat-tile'

// Color follows the metric across the page: GMV blue, spend and cancellations orange, order counts aqua.
export const GMV = 'var(--adshub-series-1)'
export const COST = 'var(--adshub-series-2)'
export const ORDERS = 'var(--adshub-series-3)'

/** The change against the previous period, when there is one to measure against. */
export function change(current: number, previous: number | null | undefined, upIsGood: boolean): Delta | null {
  if (previous === null || previous === undefined || previous <= 0) return null
  return { ratio: (current - previous) / previous, upIsGood }
}

/**
 * What each column counts. Today's figures are running totals, so a column
 * takes the difference from the last known total: the orders of that hour. A
 * column after hours not broken down yet gathers them, and says so
 * (`lumped`). Day-by-day figures already count their own day.
 */
export function perPeriod(
  values: Array<number | null>,
  running: boolean,
): { values: Array<number | null>; lumped?: boolean[] } {
  if (!running) return { values }
  let last = 0
  let skipped = false
  const lumped: boolean[] = []
  const out = values.map((v) => {
    if (v === null) {
      skipped = true
      lumped.push(false)
      return null
    }
    lumped.push(skipped)
    const inPeriod = Math.max(0, v - last)
    last = v
    skipped = false
    return inPeriod
  })
  return { values: out, lumped }
}

/** A table figure: its text, and the number the table sorts it by (none for a gap). */
export function tableCell(value: number | null | undefined, format: (v: number) => string, gap = '—') {
  return { text: value === null || value === undefined ? gap : format(value), sort: value ?? null }
}
