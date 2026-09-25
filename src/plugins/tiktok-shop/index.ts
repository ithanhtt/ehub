import { sendRequest } from '@/core/plugins/http'
import { applyPathParams, partitionParams } from '@/core/plugins/params'
import type {
  BuildRequestArgs,
  ConnectorPlugin,
  ConnectionContext,
  CredentialResolution,
  PreparedRequest,
  TestResult,
} from '@/core/plugins/types'
import { createListPermissionsAction, LIST_PERMISSIONS_HINTS } from '@/core/plugins/list-permissions'
import { SHOPS, tiktokShopEndpoints, UNSCOPED_PATHS } from './endpoints'
import { isUnscopedPath, tiktokShopDeclaredEndpoints } from './endpoints-declared'
import { BASE_URL, exchangeAuthCode, refreshAccessToken, signedUrl } from './sign'

/**
 * TikTok Shop (Seller) connector — the Partner API of a seller's shop:
 * orders, affiliate (creator) orders, products, and the shop's analytics.
 *
 * Three things set it apart from the other connectors:
 *  1. Every request is signed over its path, query and body (sign.ts), so the
 *     URL is only final once the body is.
 *  2. The access token lapses after about a week. The refresh token beside it
 *     renews it (refreshCredentials), a day before it would lapse, without
 *     anyone re-authorising.
 *  3. Calls are per shop: the shop's `cipher`, found by the connection test,
 *     goes with each one.
 */

/** Renewed this long before TikTok would refuse the token. */
const REFRESH_AHEAD_S = 24 * 3600

function shopCipherOf(context: ConnectionContext): string {
  if (context.credentials.shopCipher) return context.credentials.shopCipher
  return typeof context.metadata.shopCipher === 'string' ? context.metadata.shopCipher : ''
}

function resolveParams({ endpoint, params, context }: BuildRequestArgs): Record<string, unknown> {
  if (!endpoint.params.some((p) => p.key === 'shop_cipher') || params.shop_cipher) return params
  const cipher = shopCipherOf(context)
  return cipher ? { ...params, shop_cipher: cipher } : params
}

function headers(context: ConnectionContext): Record<string, string> {
  return { 'x-tts-access-token': context.credentials.accessToken ?? '', 'Content-Type': 'application/json' }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * A declared endpoint takes its query and body free-form (endpoints-declared.ts):
 * a `query` object is spread into the query string and a `body` object becomes
 * the body, with any typed params merged over them — so the shop chosen on the
 * form wins over a stale cipher left in pasted JSON.
 */
function spread(values: Record<string, unknown>, key: 'query' | 'body') {
  const { [key]: free, ...typed } = values
  return { ...(isRecord(free) ? free : {}), ...typed }
}

function buildRequest({ endpoint, params, context }: BuildRequestArgs): PreparedRequest {
  const partitioned = partitionParams(endpoint, params)
  const query = spread(partitioned.query, 'query')
  const body = spread(partitioned.body, 'body')
  const urlPath = applyPathParams(endpoint.path, partitioned.path)
  if (isUnscopedPath(urlPath) || UNSCOPED_PATHS.has(urlPath)) delete query.shop_cipher
  const isBody = endpoint.method === 'POST' || endpoint.method === 'PUT' || (endpoint.method === 'DELETE' && Object.keys(body).length > 0)
  // Signed over exactly these bytes, so the body is serialised once.
  const bodyText = isBody ? JSON.stringify(body) : undefined
  return {
    url: signedUrl(urlPath, query, bodyText, context.credentials.appKey ?? '', context.credentials.appSecret ?? ''),
    method: endpoint.method,
    headers: headers(context),
    body: bodyText,
  }
}

/** `{ code, message, request_id }` — HTTP 200 with a non-zero code is a failure. */
function parseError(status: number, body: unknown): string | null {
  if (!body || typeof body !== 'object') return status >= 400 ? `HTTP ${status}` : null
  const payload = body as { code?: number; message?: string; request_id?: string }
  if (payload.code === undefined || payload.code === 0) return status >= 400 ? `HTTP ${status}` : null
  return `TikTok Shop ${payload.code}: ${payload.message ?? 'unknown error'}`
}

/** The field to look at for a TikTok Shop error code (Partner Center, "Common errors"). */
function hintFor(code: number | null, message: string): string {
  if (code === 105002 || /expired/i.test(message)) return 'tiktokShopTokenExpired'
  if (code === 105001 || /access.?token.*invalid|invalid.*access.?token/i.test(message)) return 'tiktokShopTokenRejected'
  if (code === 106001 || /sign/i.test(message)) return 'tiktokShopBadSignature'
  if (code === 105005 || /scope|permission/i.test(message)) return 'tiktokShopMissingScope'
  if (code === 36009002) return 'tiktokShopRateLimited'
  return 'tiktokShopUnknown'
}

const codeOf = (body: unknown) =>
  body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'number' ? (body as { code: number }).code : null

async function testConnection(context: ConnectionContext): Promise<TestResult> {
  const { appKey, appSecret, accessToken } = context.credentials
  if (!appKey || !appSecret) return { ok: false, message: 'App Key and App Secret are required.', hint: 'tiktokShopBadSignature' }
  if (!accessToken) return { ok: false, message: 'No access token yet.', hint: 'tiktokShopNeedsCodeOrToken' }

  const endpoint = tiktokShopEndpoints.find((e) => e.id === SHOPS)!
  const result = await sendRequest(buildRequest({ endpoint, params: {}, context }), { maxRetries: 1 })
  const error = parseError(result.status, result.data) ?? (result.ok ? null : (result.error ?? 'Request failed'))
  if (error) return { ok: false, message: error, hint: hintFor(codeOf(result.data), error) }

  const shops = (((result.data as { data?: { shops?: Array<Record<string, unknown>> } }).data?.shops ?? []) as Array<Record<string, unknown>>).map(
    (shop) => ({
      id: String(shop.id ?? ''),
      name: String(shop.name ?? ''),
      region: String(shop.region ?? ''),
      cipher: String(shop.cipher ?? ''),
    }),
  )
  if (shops.length === 0) return { ok: false, message: 'The token works, but no shop has authorised this app.', hint: 'tiktokShopNoShop' }

  // The shop the connection names, or the first one authorised.
  const chosen = shops.find((shop) => shop.cipher === context.credentials.shopCipher) ?? shops[0]
  return {
    ok: true,
    message: `Connected to ${chosen.name || chosen.id}${shops.length > 1 ? ` (${shops.length} shops authorised)` : ''}.`,
    metadata: { shops, shopCipher: chosen.cipher, shopId: chosen.id, shopName: chosen.name, region: chosen.region },
  }
}

/**
 * An auth_code pasted into the form becomes the stored token pair, as the
 * TikTok Ads connector does it: one save, no separate step. A token pasted
 * by hand is kept as it is, and whatever expiry was known for the old one is
 * forgotten, so it is never "renewed" from a refresh token that belongs to
 * another grant.
 */
async function resolveCredentials({
  credentials,
  previous,
}: {
  credentials: Record<string, string>
  previous: Record<string, string>
}): Promise<CredentialResolution> {
  const { appKey, appSecret, authCode } = credentials
  const stored = { ...credentials }
  delete stored.authCode

  if (!authCode) {
    if (!stored.accessToken) {
      return { ok: false, credentials: stored, message: 'Neither an auth_code nor an access token was provided.', hint: 'tiktokShopNeedsCodeOrToken' }
    }
    const replaced = stored.accessToken !== previous.accessToken
    return replaced ? { ok: true, credentials: stored, metadata: { accessTokenExpiresAt: null, refreshTokenExpiresAt: null } } : { ok: true, credentials: stored }
  }

  const outcome = await exchangeAuthCode(appKey ?? '', appSecret ?? '', authCode)
  if (!outcome.ok) {
    return {
      ok: false,
      credentials: stored,
      message: `TikTok Shop ${outcome.code ?? ''}: ${outcome.message}`.trim(),
      hint: /used|expired|invalid.*code/i.test(outcome.message) ? 'tiktokShopCodeUsed' : 'tiktokShopExchangeFailed',
    }
  }
  const { grant } = outcome
  return {
    ok: true,
    credentials: { ...stored, accessToken: grant.accessToken, refreshToken: grant.refreshToken },
    message: `Token issued for ${grant.sellerName || 'the seller'}.`,
    hint: 'tiktokShopExchangeOk',
    metadata: {
      accessTokenExpiresAt: grant.accessTokenExpiresAt,
      refreshTokenExpiresAt: grant.refreshTokenExpiresAt,
      sellerName: grant.sellerName,
      sellerRegion: grant.region,
      grantedScopes: grant.scopes,
      tokenIssuedAt: new Date().toISOString(),
    },
  }
}

/** A day before the access token lapses, a new pair from the refresh token. */
async function refreshCredentials(context: ConnectionContext): Promise<CredentialResolution | null> {
  const { appKey, appSecret, refreshToken } = context.credentials
  const expiresAt = Number(context.metadata.accessTokenExpiresAt)
  if (!appKey || !appSecret || !refreshToken || !(expiresAt > 0)) return null
  if (expiresAt - Date.now() / 1000 > REFRESH_AHEAD_S) return null

  const outcome = await refreshAccessToken(appKey, appSecret, refreshToken)
  // TikTok's code and message only: fresh-credentials keeps and logs it (masked), never the tokens.
  if (!outcome.ok) return { ok: false, credentials: {}, message: `TikTok Shop ${outcome.code ?? ''}: ${outcome.message}`.replace(/ :/, ':') }
  return {
    ok: true,
    credentials: { accessToken: outcome.grant.accessToken, refreshToken: outcome.grant.refreshToken || refreshToken },
    metadata: {
      accessTokenExpiresAt: outcome.grant.accessTokenExpiresAt,
      refreshTokenExpiresAt: outcome.grant.refreshTokenExpiresAt,
      tokenRefreshedAt: new Date().toISOString(),
    },
  }
}

/** A request outside the catalogue is signed like any other, once its URL and body are known. */
async function prepareCustomRequest(request: PreparedRequest, context: ConnectionContext): Promise<PreparedRequest> {
  const url = new URL(request.url)
  const query: Record<string, string> = Object.fromEntries(url.searchParams.entries())
  delete query.sign
  delete query.timestamp
  delete query.app_key
  if (!query.shop_cipher && !UNSCOPED_PATHS.has(url.pathname) && !isUnscopedPath(url.pathname)) {
    const cipher = shopCipherOf(context)
    if (cipher) query.shop_cipher = cipher
  }
  return {
    ...request,
    url: signedUrl(url.pathname, query, request.body, context.credentials.appKey ?? '', context.credentials.appSecret ?? ''),
    headers: { ...request.headers, ...headers(context) },
  }
}

export const tiktokShopPlugin: ConnectorPlugin = {
  id: 'tiktok-shop',
  name: 'TikTok Shop',
  description: {
    vi: 'Đơn hàng, đơn affiliate của KOC (video, hoa hồng), sản phẩm/SKU và số liệu phân tích của shop từ TikTok Shop Partner API.',
    en: 'Orders, creator affiliate orders (videos, commission), products/SKUs and shop analytics from the TikTok Shop Partner API.',
  },
  version: '1.0.0',
  category: 'ecommerce',
  color: '#25F4EE',
  docsUrl: 'https://partner.tiktokshop.com/docv2',
  auth: {
    type: 'oauth2',
    instructions: {
      vi: 'Tạo app trên TikTok Shop Partner Center, bật các scope: Shop Authorized Information, Order Information, Product Basic, Read Seller Affiliate Collaboration, TikTok Shop Analytics. Lấy App Key và App Secret. Mở link uỷ quyền của app (services.tiktokshop.com/open/authorize?service_id=…) bằng tài khoản chủ shop; TikTok chuyển về URL có ?code=XXXX — dán XXXX vào ô auth_code rồi lưu. Token được tự làm mới trước khi hết hạn.',
      en: 'Create an app in TikTok Shop Partner Center with the scopes Shop Authorized Information, Order Information, Product Basic, Read Seller Affiliate Collaboration and TikTok Shop Analytics. Take its App Key and App Secret. Open the app’s authorisation link (services.tiktokshop.com/open/authorize?service_id=…) as the shop owner; TikTok redirects to a URL with ?code=XXXX — paste XXXX as the auth_code and save. The token renews itself before it lapses.',
    },
    fields: [
      { key: 'appKey', label: { vi: 'App Key', en: 'App Key' }, type: 'text', required: true },
      { key: 'appSecret', label: { vi: 'App Secret', en: 'App Secret' }, type: 'password', secret: true, required: true },
      {
        key: 'authCode',
        label: { vi: 'auth_code (dán vào đây để lấy token)', en: 'auth_code (paste to get a token)' },
        type: 'password',
        secret: true,
        transient: true,
        help: {
          vi: 'Giá trị code trên URL TikTok chuyển về sau khi chủ shop uỷ quyền. Dùng được một lần, hết hạn sau 30 phút.',
          en: 'The code in the URL TikTok redirects to after the shop owner authorises. Single use; expires in 30 minutes.',
        },
      },
      {
        key: 'accessToken',
        label: { vi: 'Access Token (nếu đã có sẵn)', en: 'Access Token (if you already have one)' },
        type: 'password',
        secret: true,
      },
      {
        key: 'refreshToken',
        label: { vi: 'Refresh Token', en: 'Refresh Token' },
        type: 'password',
        secret: true,
        help: {
          vi: 'Tự điền khi đổi auth_code. Có nó thì access token được làm mới tự động.',
          en: 'Filled in when an auth_code is exchanged. With it, the access token renews itself.',
        },
      },
      {
        key: 'shopCipher',
        label: { vi: 'Shop cipher (nếu uỷ quyền nhiều shop)', en: 'Shop cipher (for several authorised shops)' },
        type: 'text',
        help: { vi: 'Không bắt buộc — kiểm tra kết nối tự lấy shop đầu tiên.', en: 'Optional — the connection test takes the first shop.' },
      },
    ],
  },
  // Confirmed entries first: the Hub and the permission probe take the first match.
  endpoints: [...tiktokShopEndpoints, ...tiktokShopDeclaredEndpoints],
  hints: [
    'tiktokShopTokenExpired',
    'tiktokShopTokenRejected',
    'tiktokShopBadSignature',
    'tiktokShopMissingScope',
    'tiktokShopRateLimited',
    'tiktokShopUnknown',
    'tiktokShopNoShop',
    'tiktokShopNeedsCodeOrToken',
    'tiktokShopCodeUsed',
    'tiktokShopExchangeFailed',
    'tiktokShopExchangeOk',
    ...LIST_PERMISSIONS_HINTS,
  ],
  actions: [createListPermissionsAction('tiktok-shop')],
  resolveBaseUrl: () => BASE_URL,
  customHeaders: headers,
  prepareCustomRequest,
  resolveCredentials,
  refreshCredentials,
  resolveParams,
  buildRequest,
  testConnection,
  parseError,
}

export default tiktokShopPlugin
