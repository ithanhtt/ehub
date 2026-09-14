export type FieldHint = { path: string; type: string; sample?: unknown }

const MAX_SAMPLE_ROWS = 50
const MAX_DEPTH = 3

/**
 * Infers a flat field list from a sample of provider records.
 *
 * Providers document their responses inconsistently and change them without
 * notice, so the schema shown in the Hub is derived from what actually came
 * back. Sampling the first rows rather than every row keeps this cheap on a
 * large report; nested objects are flattened to dotted paths because that is
 * the shape a later analytics layer will query by.
 */
export function inferFields(records: unknown[]): FieldHint[] {
  const found = new Map<string, { types: Set<string>; sample?: unknown }>()

  for (const record of records.slice(0, MAX_SAMPLE_ROWS)) {
    walk(record, '', 0, found)
  }

  return [...found.entries()]
    .map(([path, info]) => ({
      path,
      // A field that is null in one row and a string in another is reported as
      // both, which is the honest answer and a useful warning.
      type: [...info.types].sort().join(' | '),
      sample: info.sample,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function walk(
  value: unknown,
  prefix: string,
  depth: number,
  found: Map<string, { types: Set<string>; sample?: unknown }>,
): void {
  if (value === null || value === undefined) {
    if (prefix) record(found, prefix, 'null', null)
    return
  }

  if (Array.isArray(value)) {
    if (prefix) record(found, prefix, 'array', value.slice(0, 2))
    if (depth < MAX_DEPTH && value.length > 0) walk(value[0], `${prefix}[]`, depth + 1, found)
    return
  }

  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) {
      if (prefix) record(found, prefix, 'object', undefined)
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walk(child, prefix ? `${prefix}.${key}` : key, depth + 1, found)
    }
    return
  }

  if (!prefix) return
  record(found, prefix, typeof value, value)
}

function record(
  found: Map<string, { types: Set<string>; sample?: unknown }>,
  path: string,
  type: string,
  sample: unknown,
): void {
  const existing = found.get(path)
  if (existing) {
    existing.types.add(type)
    // Prefer a non-null sample so the preview column stays useful.
    if (existing.sample === null || existing.sample === undefined) existing.sample = sample
    return
  }
  found.set(path, { types: new Set([type]), sample })
}

/**
 * Best-effort stable id for a record, so re-syncing upserts instead of duplicating.
 *
 * `idField` may be dotted: TikTok's /bc/get/ nests the id as `bc_info.bc_id`,
 * and a top-level-only lookup silently fell through to the row index.
 */
export function externalIdOf(record: unknown, idField: string | undefined, index: number): string {
  if (record && typeof record === 'object' && idField) {
    const value = idField
      .split('.')
      .reduce<unknown>(
        (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
        record,
      )
    if (value !== undefined && value !== null && value !== '') return String(value)
  }
  // Some report endpoints have no natural key; the dimension values do the job.
  if (record && typeof record === 'object') {
    const dimensions = (record as Record<string, unknown>).dimensions
    if (dimensions && typeof dimensions === 'object') {
      return JSON.stringify(dimensions)
    }
  }
  return `row-${index}`
}
