import { sendRequest } from '@/core/plugins/http'
import type { ConnectionContext } from '@/core/plugins/types'

export const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

/**
 * TikTok authenticates with a bare `Access-Token` header, not a Bearer scheme.
 */
export function authHeaders(context: ConnectionContext): Record<string, string> {
  return {
    'Access-Token': context.credentials.accessToken ?? '',
    'Content-Type': 'application/json',
  }
}

/**
 * The advertiser id to use, from wherever the connection happens to hold it.
 *
 * Two sources, and both matter. The user may type one in as a credential, but
 * far more often a successful connection test *discovers* it and caches it in
 * metadata. Reading only the credential meant the diagnosis reported "no
 * advertiser to probe the token against" on a connection that had already
 * found twenty-four of them — so the token check silently never ran.
 */
export function advertiserIdFrom(context: ConnectionContext): string | undefined {
  const fromCredentials = context.credentials.advertiserId
  if (fromCredentials) return fromCredentials

  const fromMetadata = context.metadata.advertiserId
  if (typeof fromMetadata === 'string' && fromMetadata) return fromMetadata

  // The list cached by the connection test, when no default was singled out.
  const discovered = context.metadata.advertisers
  if (Array.isArray(discovered) && discovered.length > 0) {
    const first = discovered[0] as { id?: unknown }
    if (typeof first?.id === 'string' && first.id) return first.id
  }

  return undefined
}

/**
 * The exchange endpoint answers 40002 for two unrelated situations — wrong app
 * credentials, and a malformed request body — and only the message tells them
 * apart. Established by probing it with each field omitted in turn:
 *
 *   wrong app_id/secret  ->  "The app_id does not exist or the secret key…"
 *   auth_code omitted    ->  "auth_code: Missing data for required field."
 *   app_id omitted       ->  "app_id: Missing data for required field."
 */
export const APP_CREDENTIALS_REJECTED = /app_id does not exist|secret key provided is incorrect/i
export const MISSING_FIELD = /missing data for required field/i

/**
 * A spent or expired auth_code. Measured: reusing one returns
 *
 *   code 40110: "Auth_code is used，please re-authorize."
 *
 * This is the most likely failure of all — the code works exactly once, so
 * anyone who retries a save, or reloads the callback URL, lands here. It earns
 * a message of its own rather than the generic "exchange failed".
 */
export const CODE_ALREADY_USED = /auth_code is used|re-?authorize|expired/i

/** Trades an auth_code for an access token. The body must be JSON. */
export async function exchangeAuthCode(appId: string, appSecret: string, authCode: string) {
  return sendRequest(
    {
      url: `${BASE_URL}/oauth2/access_token/`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        secret: appSecret,
        auth_code: authCode,
        grant_type: 'authorization_code',
      }),
    },
    { maxRetries: 0 },
  )
}
