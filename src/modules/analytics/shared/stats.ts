/**
 * The numbers behind "is there a relationship": a correlation over the
 * period's buckets, and what it may honestly be called.
 *
 * Pearson's r over paired buckets (days or months). A pair where either side
 * is unknown is left out rather than counted as zero, and fewer than
 * MIN_PAIRS pairs gives no answer — three months cannot show a trend, and a
 * page saying "strong" over them would mislead exactly the reader who trusts it.
 */

export const MIN_PAIRS = 5

export type Correlation = {
  /** −1…1, or null when there is too little to say. */
  r: number | null
  /** The pairs it was taken over. */
  n: number
}

export function correlation(xs: Array<number | null | undefined>, ys: Array<number | null | undefined>): Correlation {
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i]
    const y = ys[i]
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y])
  }
  const n = pairs.length
  if (n < MIN_PAIRS) return { r: null, n }
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  }
  // One side never moved: no correlation can be read from it.
  if (sxx === 0 || syy === 0) return { r: null, n }
  return { r: Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))), n }
}

/** The usual reading of |r|, as a key of the "reports.strength" messages. */
export function strengthOf(r: number | null): 'none' | 'weak' | 'moderate' | 'strong' | 'unknown' {
  if (r === null) return 'unknown'
  const a = Math.abs(r)
  if (a < 0.2) return 'none'
  if (a < 0.4) return 'weak'
  if (a < 0.7) return 'moderate'
  return 'strong'
}

/** a / b, or null when there is nothing to divide by. */
export const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)

/** Adds `value` under `key`, starting from zero. */
export function addTo<K>(map: Map<K, number>, key: K, value: number) {
  map.set(key, (map.get(key) ?? 0) + value)
}
