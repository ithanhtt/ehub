/**
 * Failed sign-ins counted per address and per account, so a password cannot
 * be guessed at speed.
 *
 * The sign-in form posts to a server action that calls better-auth directly
 * (auth.api.signInEmail) — which skips better-auth's own rate limit: that one
 * runs only in its HTTP router (/api/auth/*). This takes its place: within
 * WINDOW_MS, at most PER_IP failed tries from one address and PER_EMAIL for
 * one account; past either, every try is refused until the oldest failure
 * leaves the window. A success clears the account's count (not the address's:
 * one right password must not reopen guessing at every other account).
 *
 * In memory, per server process — the app runs as one. Pure, so it is tested
 * without a server (scripts/check-plugins.ts).
 */

export const WINDOW_MS = 15 * 60_000
export const PER_IP = 20
export const PER_EMAIL = 8
const MAX_KEYS = 10_000

type Store = Map<string, number[]>

const shared = ((globalThis as unknown as { __adshubSignInFailures?: Store }).__adshubSignInFailures ??= new Map())

const keys = (ip: string, email: string) => ({ ip: `ip:${ip || 'unknown'}`, email: `email:${email.trim().toLowerCase()}` })

function recent(store: Store, key: string, now: number): number[] {
  const kept = (store.get(key) ?? []).filter((at) => now - at < WINDOW_MS)
  if (kept.length > 0) store.set(key, kept)
  else store.delete(key)
  return kept
}

/** Whether a try from `ip` for `email` may go ahead now; when not, how long until it may (ms). */
export function signInAllowed(ip: string, email: string, now = Date.now(), store: Store = shared): { ok: true } | { ok: false; retryInMs: number } {
  const k = keys(ip, email)
  const byIp = recent(store, k.ip, now)
  const byEmail = recent(store, k.email, now)
  const waits: number[] = []
  if (byIp.length >= PER_IP) waits.push(byIp[byIp.length - PER_IP] + WINDOW_MS - now)
  if (byEmail.length >= PER_EMAIL) waits.push(byEmail[byEmail.length - PER_EMAIL] + WINDOW_MS - now)
  return waits.length === 0 ? { ok: true } : { ok: false, retryInMs: Math.max(...waits) }
}

/** A try that failed on its credentials. */
export function recordSignInFailure(ip: string, email: string, now = Date.now(), store: Store = shared): void {
  const k = keys(ip, email)
  for (const key of [k.ip, k.email]) store.set(key, [...recent(store, key, now), now])
  // Addresses long gone make way, oldest first (a Map keeps insertion order).
  while (store.size > MAX_KEYS) store.delete(store.keys().next().value!)
}

/** A try that succeeded: the account's failures are forgotten. */
export function recordSignInSuccess(email: string, store: Store = shared): void {
  store.delete(keys('', email).email)
}

/**
 * The client's address. Behind Cloudflare, CF-Connecting-IP — set by
 * Cloudflare itself, where X-Forwarded-For's first entry is whatever the
 * client chose to send (Cloudflare appends to it); else X-Forwarded-For's first
 * entry as nginx passes it, else X-Real-IP.
 */
export function clientAddress(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    ''
  )
}

/**
 * Where to go after signing in: a path on this site only, never another site
 * (an open redirect). Resolved as a browser would — which drops tabs and
 * newlines, and reads a backslash as a slash — and kept only when it stays
 * on this origin; the path handed on is the resolved one.
 */
export function safeNext(value: unknown): string {
  const next = typeof value === 'string' ? value : ''
  // Control characters and backslashes have no place in a path of ours, and are how a URL slips its origin.
  if (!next.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(next)) return '/'
  try {
    const base = 'http://adshub.invalid'
    const url = new URL(next, base)
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch {
    return '/'
  }
}
