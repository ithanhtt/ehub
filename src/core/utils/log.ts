import 'server-only'

import { redactSecrets } from '@/core/plugins/http'

/**
 * A warning that repeats — a source failing the same way every background
 * round, once a minute, for days — written once, then at most once an hour
 * with how many times it came back meanwhile. A different message under the
 * same key is news and is written at once. Secrets are masked on the way out.
 *
 * Keeps the server's log (PM2 rotates it, but a flood still pushes out what
 * matters) readable and small over months of running.
 */
const EVERY_MS = 60 * 60_000
const MAX_KEYS = 500

type Seen = { message: string; at: number; repeats: number }

const seen = ((globalThis as unknown as { __adshubWarned?: Map<string, Seen> }).__adshubWarned ??= new Map())

export function warnThrottled(key: string, message: string): void {
  const text = redactSecrets(message)
  const now = Date.now()
  const last = seen.get(key)
  if (last && last.message === text && now - last.at < EVERY_MS) {
    last.repeats += 1
    return
  }
  const repeated = last && last.message === text && last.repeats > 0 ? ` (again ${last.repeats}× in the last hour)` : ''
  console.warn(`${text}${repeated}`)
  seen.delete(key)
  seen.set(key, { message: text, at: now, repeats: 0 })
  // Oldest first in a Map: the keys of sources long gone go first.
  while (seen.size > MAX_KEYS) seen.delete(seen.keys().next().value!)
}

/** An error's message, for a log line. */
export const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
