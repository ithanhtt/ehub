import 'server-only'

/**
 * A small time-boxed memo for provider reads.
 *
 * The dashboard refreshes itself, and several people may have it open; each
 * refresh would otherwise re-run dozens of provider calls against rate-limited
 * APIs whose numbers only move hourly (TikTok reports lag about an hour). An
 * in-flight promise is shared too, so two tabs refreshing together cost one
 * sweep. Kept on globalThis so a dev hot reload does not drop it; in-process
 * on purpose — the app runs as one server.
 */
type Entry = { expires: number; value: Promise<unknown> }

const store = ((globalThis as unknown as { __adshubMemo?: Map<string, Entry> }).__adshubMemo ??= new Map())

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expires > now) return hit.value as Promise<T>

  const value = load()
  store.set(key, { expires: now + ttlMs, value })
  // A failed load must not be served for the whole TTL.
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key)
  })

  // Sweep expired entries now and then so the map cannot grow without bound.
  if (store.size > 200) {
    for (const [k, entry] of store) if (entry.expires <= now) store.delete(k)
  }
  return value
}
