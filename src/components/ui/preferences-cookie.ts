/**
 * The cookie a viewer's remembered choices travel in (see usePreference): one
 * small JSON object of key → value. Being a cookie, it reaches the server with
 * every request, so a page renders as the viewer left it straight away —
 * never the default first, then their choice.
 *
 * Shared by the server, which reads it, and the browser, which writes it.
 */

export const PREFERENCES_COOKIE = 'adshub_prefs'

/** A year; every change renews it. */
export const PREFERENCES_MAX_AGE = 365 * 24 * 3600

/** Kept well under the 4 KB a browser allows one cookie. */
export const PREFERENCES_MAX_LENGTH = 3800

/** The choices a cookie value holds; nothing when it is missing or not ours. */
export function parsePreferences(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  // The value is URI-encoded JSON; some readers hand it over decoded already.
  for (const text of [value, safeDecode(value)]) {
    if (text === null) continue
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      /* try the next reading */
    }
  }
  return {}
}

export function serializePreferences(choices: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(choices))
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
