import { createHmac } from 'node:crypto'
import { sendRequest } from '@/core/plugins/http'

export const BASE_URL = 'https://open-api.tiktokglobalshop.com'
const AUTH_URL = 'https://auth.tiktok-shops.com'

/**
 * TikTok Shop signs every request (Partner Center, "Sign your API request"):
 *
 *   1. every query parameter except `sign` and `access_token`, keys sorted,
 *      concatenated as key + value with nothing between;
 *   2. the URL path in front of that, and the raw body behind it (for JSON —
 *      the exact bytes sent);
 *   3. app_secret + that + app_secret, HMAC-SHA256 keyed with app_secret, hex.
 *
 * The access token travels in the `x-tts-access-token` header and is never
 * signed. `timestamp` is in seconds and must be within five minutes of TikTok's
 * clock, so a request is signed when it is built, not ahead of time.
 */
export function signature(path: string, query: Record<string, string>, body: string | undefined, appSecret: string): string {
  const joined = Object.keys(query)
    .filter((key) => key !== 'sign' && key !== 'access_token')
    .sort()
    .map((key) => `${key}${query[key]}`)
    .join('')
  const payload = `${appSecret}${path}${joined}${body ?? ''}${appSecret}`
  return createHmac('sha256', appSecret).update(payload).digest('hex')
}

/** A query value as it is both signed and sent: lists comma-joined, objects as JSON. */
export function queryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(',')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** The signed URL for `path` with `query` (app_key and timestamp added) and `body`. */
export function signedUrl(path: string, query: Record<string, unknown>, body: string | undefined, appKey: string, appSecret: string): string {
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    flat[key] = queryValue(value)
  }
  flat.app_key = appKey
  flat.timestamp = String(Math.floor(Date.now() / 1000))
  flat.sign = signature(path, flat, body, appSecret)
  return `${BASE_URL}${path}?${new URLSearchParams(flat).toString()}`
}

export type TokenGrant = {
  accessToken: string
  refreshToken: string
  /** Epoch seconds — TikTok sends instants, not durations. */
  accessTokenExpiresAt: number
  refreshTokenExpiresAt: number
  sellerName: string
  region: string
  scopes: string[]
}

export type TokenOutcome = { ok: true; grant: TokenGrant } | { ok: false; code: number | null; message: string }

/**
 * The token endpoints: an auth_code (single use, 30 minutes) or a refresh
 * token for a new pair. Note `grant_type=authorized_code` — TikTok's own
 * spelling, not OAuth's `authorization_code`.
 */
async function token(query: Record<string, string>): Promise<TokenOutcome> {
  const grantType = query.grant_type
  const response = await sendRequest(
    {
      url: `${AUTH_URL}/api/v2/token/${grantType === 'refresh_token' ? 'refresh' : 'get'}?${new URLSearchParams(query).toString()}`,
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
    // Never resent (a timeout or a dropped connection may come after TikTok acted): an auth_code is
    // single use, and a refresh already spent would lose the new pair. The caller tries again later.
    { maxRetries: 0, idempotent: false },
  )
  const body = (response.data ?? {}) as { code?: number; message?: string; data?: Record<string, unknown> }
  const data = body.data ?? {}
  if (!response.ok || body.code !== 0 || typeof data.access_token !== 'string' || !data.access_token) {
    return { ok: false, code: typeof body.code === 'number' ? body.code : null, message: body.message ?? response.error ?? 'No token returned' }
  }
  return {
    ok: true,
    grant: {
      accessToken: data.access_token,
      refreshToken: String(data.refresh_token ?? ''),
      accessTokenExpiresAt: Number(data.access_token_expire_in) || 0,
      refreshTokenExpiresAt: Number(data.refresh_token_expire_in) || 0,
      sellerName: String(data.seller_name ?? ''),
      region: String(data.seller_base_region ?? ''),
      scopes: Array.isArray(data.granted_scopes) ? data.granted_scopes.map(String) : [],
    },
  }
}

export const exchangeAuthCode = (appKey: string, appSecret: string, authCode: string) =>
  token({ app_key: appKey, app_secret: appSecret, auth_code: authCode, grant_type: 'authorized_code' })

export const refreshAccessToken = (appKey: string, appSecret: string, refreshToken: string) =>
  token({ app_key: appKey, app_secret: appSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
