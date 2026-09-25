import 'server-only'

/**
 * A small time-boxed memo for provider reads.
 *
 * The dashboard refreshes itself, and several people may have it open; each
 * refresh would otherwise re-run dozens of provider calls against rate-limited
 * APIs whose numbers only move hourly (TikTok reports lag about an hour). An
 * in-flight promise is shared too, so two tabs refreshing together cost one
 * sweep — for as long as it runs: the TTL counts from when a load settles,
 * not from when it began, so a sweep slower than its TTL (a throttled one)
 * is never started again on top of itself by the next refresh.
 *
 * With `staleMs`, a value past its TTL is still served — at once — for that
 * much longer while one fresh load runs behind it (stale-while-revalidate):
 * a page asking every few seconds then never waits on a slow provider once
 * it has had an answer, and the numbers catch up on the next ask. A failed
 * refresh keeps the last good value (until it is too stale) rather than
 * trading it for an error.
 *
 * Kept on globalThis so a dev hot reload does not drop it; in-process on
 * purpose — the app runs as one server.
 */
type Entry = {
  /** When the value stops being fresh; infinite while the first load runs. */
  expires: number
  /** Until when a settled value may still be served while a new one loads. */
  staleUntil: number
  value: Promise<unknown>
  /** A background refresh under way. */
  refreshing?: Promise<unknown>
}

type Store = { entries: Map<string, Entry>; sweptAt: number }

const store: Store = ((globalThis as unknown as { __adshubMemoV2?: Store }).__adshubMemoV2 ??= { entries: new Map(), sweptAt: 0 })

const SWEEP_EVERY_MS = 60_000

export function memo<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  options: {
    staleMs?: number
    /** A TTL of the value's own, e.g. a short one for a sweep that lost part of its reads, so it is retried soon rather than served for the whole TTL. */
    ttlOf?: (value: T) => number
  } = {},
): Promise<T> {
  const now = Date.now()
  sweep(now)
  const staleMs = options.staleMs ?? 0
  const ttl = (value: T) => (options.ttlOf ? options.ttlOf(value) : ttlMs)
  const hit = store.entries.get(key)
  if (hit && hit.expires > now) return hit.value as Promise<T>

  // Past its TTL but within its grace: serve it and refresh behind it, once.
  if (hit && hit.staleUntil > now) {
    if (!hit.refreshing) {
      const next = load()
      hit.refreshing = next
      next.then(
        (fresh) => {
          if (store.entries.get(key) !== hit) return
          const settled = Date.now()
          store.entries.set(key, { expires: settled + ttl(fresh), staleUntil: settled + ttl(fresh) + staleMs, value: next })
        },
        () => {
          // Keep the last good value; the next ask past the TTL tries again.
          if (store.entries.get(key) === hit) hit.refreshing = undefined
        },
      )
    }
    return hit.value as Promise<T>
  }

  const value = load()
  const entry: Entry = { expires: Number.POSITIVE_INFINITY, staleUntil: Number.POSITIVE_INFINITY, value }
  store.entries.set(key, entry)
  value.then(
    (fresh) => {
      const settled = Date.now()
      entry.expires = settled + ttl(fresh)
      entry.staleUntil = settled + ttl(fresh) + staleMs
    },
    // A failed load must not be served for the whole TTL.
    () => {
      if (store.entries.get(key) === entry) store.entries.delete(key)
    },
  )
  return value
}

/** Drops what can no longer be served, once a minute, so the map cannot grow without bound. */
function sweep(now: number) {
  if (now - store.sweptAt < SWEEP_EVERY_MS) return
  store.sweptAt = now
  for (const [key, entry] of store.entries) if (entry.staleUntil <= now && !entry.refreshing) store.entries.delete(key)
}

/** How many values the memo holds, for the System page. */
export function memoSize(): number {
  return store.entries.size
}

/**
 * Forgets every value (the System page's "clear the in-memory cache"). The
 * next read of each goes back to its provider — or, for the stores that keep
 * a file under .data/cache, to that file; nothing on disk is touched. A load
 * still running keeps running and its callers still get it; it is just not
 * kept.
 */
export function clearMemo(): number {
  const count = store.entries.size
  store.entries.clear()
  return count
}
