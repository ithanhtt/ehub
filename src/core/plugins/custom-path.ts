/**
 * Safety rules for user-supplied endpoint paths.
 *
 * The API Hub lets people call a path the catalogue does not declare, so they
 * can try something from the provider's documentation without a code change.
 * That hands a user partial control over a URL that will be sent **with the
 * connection's credentials attached**, which is the classic setup for SSRF:
 * point it at an internal service and the app becomes a confused deputy
 * holding a real bearer token.
 *
 * The defence is not a blocklist. The path is resolved against the connector's
 * own base URL and then the result is checked to still be inside it — so
 * anything that tries to leave, by any encoding, fails the same way.
 */

export type PathCheck = { ok: true; url: string } | { ok: false; reason: PathRejection }

export type PathRejection =
  | 'empty'
  | 'not-relative'
  | 'escapes-base'
  | 'bad-base'
  | 'control-characters'
  | 'encoded-separator'

/** Characters that let a path smuggle a second header or split the request. */
const CONTROL = /[\u0000-\u001f\u007f]/

export function resolveCustomPath(baseUrl: string, rawPath: string): PathCheck {
  const path = rawPath.trim()
  if (!path) return { ok: false, reason: 'empty' }
  if (CONTROL.test(path) || CONTROL.test(baseUrl)) {
    return { ok: false, reason: 'control-characters' }
  }

  /*
   * Reject anything that even looks absolute before resolving.
   *
   * `new URL('//evil.com', base)` silently produces https://evil.com — the
   * protocol-relative form is the one people forget. `https://…` and
   * `javascript:` are refused for the same reason: a path is a path.
   */
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
    return { ok: false, reason: 'not-relative' }
  }

  /*
   * Refuse percent-encoded separators and dot segments.
   *
   * A path like `..%2f..%2fadmin` does not escape as far as the URL parser is
   * concerned — `%2f` stays inside a single path segment — so containment
   * still holds and this is not an SSRF hole. But a server that decodes before
   * routing sees `../../admin` instead, and two parsers disagreeing about the
   * same string is how path-confusion bugs happen. These APIs never need an
   * encoded slash or dot inside a path, so the ambiguity is simply removed.
   */
  if (/%2e|%2f|%5c/i.test(path)) return { ok: false, reason: 'encoded-separator' }

  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return { ok: false, reason: 'bad-base' }
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    return { ok: false, reason: 'bad-base' }
  }

  // Keep the base's own path prefix: TikTok's base ends in /open_api/v1.3, and
  // a leading slash on the user's path would otherwise discard it.
  const prefix = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  const relative = path.replace(/^\/+/, '')

  let resolved: URL
  try {
    resolved = new URL(relative, `${base.origin}${prefix}`)
  } catch {
    return { ok: false, reason: 'not-relative' }
  }

  /*
   * The containment check, done after resolution so `..`, `%2e%2e`, backslash
   * tricks and double encodings are all already normalised by the URL parser.
   */
  if (resolved.origin !== base.origin) return { ok: false, reason: 'escapes-base' }
  if (!resolved.pathname.startsWith(prefix) && resolved.pathname !== base.pathname) {
    return { ok: false, reason: 'escapes-base' }
  }
  // A username or password in the authority would change who we authenticate
  // as; the parser puts them on the URL rather than the path.
  if (resolved.username || resolved.password) return { ok: false, reason: 'not-relative' }

  return { ok: true, url: resolved.toString() }
}

/** Methods that only read. Anything else needs an explicit confirmation. */
export const SAFE_METHODS = new Set(['GET'])

export const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type CustomMethod = (typeof ALLOWED_METHODS)[number]

export function isAllowedMethod(value: string): value is CustomMethod {
  return (ALLOWED_METHODS as readonly string[]).includes(value)
}
