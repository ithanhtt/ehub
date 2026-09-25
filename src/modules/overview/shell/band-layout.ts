import type { WidgetSize } from '../types'

/**
 * A band's widths, adjusted so every row of it is full.
 *
 * A widget states its width for a band as it is usually filled; but a band
 * loses widgets — one taken away, one whose source is not connected or has
 * nothing to say — and the widths left then stop short of the row (two cards
 * a third wide each, and an empty third beside them). Here, per breakpoint,
 * the widths are laid into rows of 12 the way the grid lays them, and a row
 * that falls short is widened in proportion to fill it: two thirds become two
 * halves, a half alone becomes the whole row. A full row is left as it was.
 *
 * Every breakpoint is spelled out in the result, because a row can fall short
 * at one breakpoint and not at another, while the grid otherwise carries a
 * width up from the breakpoint below.
 */

const BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'] as const
const COLUMNS = 12

export function fillBand(sizes: WidgetSize[]): WidgetSize[] {
  const out: WidgetSize[] = sizes.map(() => ({}))
  const carried = sizes.map(() => COLUMNS)
  for (const bp of BREAKPOINTS) {
    const widths = sizes.map((size, i) => {
      const own = size[bp]
      if (own !== undefined) carried[i] = Math.min(COLUMNS, Math.max(1, Math.round(own)))
      return carried[i]
    })
    for (const row of rowsOf(widths)) {
      const filled = fill(row.map((i) => widths[i]))
      row.forEach((i, k) => (out[i][bp] = filled[k]))
    }
  }
  return out
}

/** The indexes on each row, as the grid wraps them. */
function rowsOf(widths: number[]): number[][] {
  const rows: number[][] = []
  let row: number[] = []
  let used = 0
  widths.forEach((width, i) => {
    if (used + width > COLUMNS && row.length > 0) {
      rows.push(row)
      row = []
      used = 0
    }
    row.push(i)
    used += width
  })
  if (row.length > 0) rows.push(row)
  return rows
}

/** One row's widths stretched to the full row, in proportion; the columns rounding leaves go to the last ones. */
function fill(widths: number[]): number[] {
  const sum = widths.reduce((a, b) => a + b, 0)
  if (sum >= COLUMNS) return widths
  const scaled = widths.map((w) => Math.max(1, Math.floor((w * COLUMNS) / sum)))
  let left = COLUMNS - scaled.reduce((a, b) => a + b, 0)
  for (let i = scaled.length - 1; left > 0; i = (i - 1 + scaled.length) % scaled.length) {
    scaled[i] += 1
    left -= 1
  }
  return scaled
}
