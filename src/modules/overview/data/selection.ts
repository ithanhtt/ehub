/**
 * Which sources a project's dashboard counts.
 *
 * Kept on the connection it applies to, under `metadata.dashboard`: the GMV
 * Max shops of a TikTok connection, the sales channels of a Sapo one. A
 * connection belongs to exactly one project, so this is a per-project choice
 * without a table of its own — and the connection test merges its metadata
 * rather than replacing it, so the choice survives a re-test.
 *
 * `null` (or absent) means everything, including shops and channels that
 * appear later; a list means exactly those.
 */
export type DashboardSelection = { gmvStores: string[] | null; sapoChannels: string[] | null }

/** One GMV Max shop as reported through one advertiser. */
export const pairKey = (advertiserId: string, storeId: string) => `${advertiserId}:${storeId}`

export function selectionOf(metadata: Record<string, unknown> | null | undefined): DashboardSelection {
  const raw = metadata?.dashboard
  const dashboard = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : null)
  return { gmvStores: list(dashboard.gmvStores), sapoChannels: list(dashboard.sapoChannels) }
}

/** The same selection in any order gives one cache key. */
export const selectionKey = (list: string[] | null) => (list ? [...list].sort().join(',') : 'all')
