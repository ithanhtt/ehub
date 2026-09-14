import { buildQueryString, sendRequest } from '@/core/plugins/http'
import { applyPathParams, partitionParams } from '@/core/plugins/params'
import type { BuildRequestArgs, ConnectorPlugin, ConnectionContext, TestResult } from '@/core/plugins/types'
import { createListPermissionsAction, LIST_PERMISSIONS_HINTS } from '@/core/plugins/list-permissions'
import { sapoEndpoints } from './endpoints'
import { sapoDeclaredEndpoints } from './endpoints-declared'

/**
 * Sapo connector.
 *
 * The store domain is part of the credential set rather than hard-coded,
 * because Sapo hosts each tenant on its own host and the suffix differs by
 * product line (`*.mysapo.net` for Sapo Web, `*.mysapogo.com` for Sapo
 * POS/Omni). Normalising it here means the endpoint catalogue stays
 * product-agnostic.
 *
 * Two auth styles are supported: an OAuth access token (`X-Sapo-Access-Token`)
 * and a legacy private app key pair sent as HTTP Basic.
 */
function normaliseBaseUrl(raw: string | undefined): string {
  if (!raw) throw new Error('Store domain is missing on this connection.')
  let domain = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  // Accept a bare tenant name and expand it to the Sapo Web host.
  if (!domain.includes('.')) domain = `${domain}.mysapo.net`
  return `https://${domain}`
}

function authHeaders(context: ConnectionContext): Record<string, string> {
  const { accessToken, apiKey, apiSecret } = context.credentials
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  if (accessToken) {
    headers['X-Sapo-Access-Token'] = accessToken
  } else if (apiKey && apiSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`
  }

  return headers
}

/**
 * A declared write endpoint carries its whole payload in one `body` param —
 * `{ "order": { … } }` pasted from the Sapo docs — so it is sent as it is,
 * never wrapped in a "body" key Sapo would not recognise.
 */
function bodyPayload(body: Record<string, unknown>) {
  const { body: pasted, ...rest } = body
  const spread = pasted && typeof pasted === 'object' && !Array.isArray(pasted) ? pasted : {}
  return { ...spread, ...rest }
}

/**
 * Sapo ignores a date-only bound: created_on_min=2026-09-10 matches nothing
 * (probed — every day counted 0), while 2026-09-10T00:00:00+07:00 works. The
 * Hub's date fields send YYYY-MM-DD, so a bare date is widened to the store's
 * day in Vietnam time: a `_min` bound to 00:00:00, a `_max` bound to 23:59:59.
 */
function widenDateBounds(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...query }
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue
    if (key.endsWith('_min')) out[key] = `${value}T00:00:00+07:00`
    else if (key.endsWith('_max')) out[key] = `${value}T23:59:59+07:00`
  }
  return out
}

function buildRequest({ endpoint, params, context }: BuildRequestArgs) {
  const partitioned = partitionParams(endpoint, params)
  const { body, path } = partitioned
  const query = widenDateBounds(partitioned.query)
  const base = normaliseBaseUrl(context.credentials.storeDomain)
  const url = `${base}${applyPathParams(endpoint.path, path)}`
  const isBodyMethod = endpoint.method === 'POST' || endpoint.method === 'PUT'

  return {
    url: isBodyMethod ? url : `${url}${buildQueryString(query)}`,
    method: endpoint.method,
    headers: authHeaders(context),
    body: isBodyMethod ? JSON.stringify(bodyPayload(body)) : undefined,
  }
}

function parseError(status: number, body: unknown): string | null {
  if (status < 400) return null
  if (body && typeof body === 'object') {
    const payload = body as { errors?: unknown; error?: unknown; message?: unknown }
    const detail = payload.errors ?? payload.error ?? payload.message
    if (typeof detail === 'string') return detail
    if (detail) return JSON.stringify(detail)
  }
  return null
}

/**
 * Read endpoints tried, in order, when the store-info call is refused.
 *
 * Sapo answers 403 for "not allowed here" — a missing scope and a path that
 * does not exist alike — and never for wrong credentials; only 401 means
 * that. So a refused store call does not end the test: the connection is
 * verified against the data the app was actually given.
 */
const FALLBACK_PROBES = ['/admin/orders/count.json', '/admin/products/count.json', '/admin/customers/count.json']

async function verifyWithoutShopScope(base: string, context: ConnectionContext): Promise<TestResult> {
  for (const path of FALLBACK_PROBES) {
    const probe = await sendRequest(
      { url: `${base}${path}`, method: 'GET', headers: authHeaders(context) },
      { maxRetries: 0 },
    )
    if (probe.ok) {
      return {
        ok: true,
        message: `Connected — verified with ${path}. This app may not read store information (/admin/store.json).`,
        hint: 'sapoShopForbidden',
        metadata: { baseUrl: base },
      }
    }
    if (probe.status === 401) {
      return { ok: false, message: `Credentials rejected by ${base} (HTTP 401).`, hint: 'sapoUnauthorized' }
    }
  }

  return {
    ok: false,
    message: `${base} accepted the credentials but refused every endpoint tried (HTTP 403).`,
    hint: 'sapoNoPermission',
  }
}

async function testConnection(context: ConnectionContext): Promise<TestResult> {
  const { accessToken, apiKey, apiSecret, storeDomain } = context.credentials

  if (!storeDomain) return { ok: false, message: 'Store domain is required.', hint: 'sapoNotFound' }
  if (!accessToken && !(apiKey && apiSecret)) {
    return {
      ok: false,
      message: 'Provide either an Access Token, or an API key and secret pair.',
      hint: 'sapoMissingCredentials',
    }
  }

  let base: string
  try {
    base = normaliseBaseUrl(storeDomain)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  // Sapo documents store information at /admin/store.json, answered under a
  // "store" key. There is no /admin/shop.json: Sapo answers it 403, as it does
  // any path that does not exist, which reads like a permission problem.
  const result = await sendRequest(
    { url: `${base}/admin/store.json`, method: 'GET', headers: authHeaders(context) },
    { maxRetries: 0 },
  )

  if (!result.ok) {
    const detail = parseError(result.status, result.data) ?? result.error
    if (result.status === 401) {
      return {
        ok: false,
        message: `Credentials rejected by ${base} (HTTP 401).`,
        hint: 'sapoUnauthorized',
      }
    }
    if (result.status === 403) return verifyWithoutShopScope(base, context)
    if (result.status === 404) {
      return {
        ok: false,
        message: `${base} did not recognise /admin/store.json — check the store domain.`,
        hint: 'sapoNotFound',
      }
    }
    return { ok: false, message: detail ?? 'Connection failed.' }
  }

  const store = (result.data as { store?: { name?: string; domain?: string; currency?: string; timezone?: string } })
    ?.store
  return {
    ok: true,
    message: store?.name ? `Connected to ${store.name}.` : 'Connected.',
    metadata: {
      baseUrl: base,
      shopName: store?.name,
      shopDomain: store?.domain,
      currency: store?.currency,
      timezone: store?.timezone,
    },
  }
}

export const sapoPlugin: ConnectorPlugin = {
  id: 'sapo',
  name: 'Sapo',
  description: {
    vi: 'Đơn hàng, sản phẩm, khách hàng và tồn kho từ Sapo Web và Sapo POS/Omni.',
    en: 'Orders, products, customers and inventory from Sapo Web and Sapo POS/Omni.',
  },
  version: '1.0.0',
  category: 'ecommerce',
  color: '#0088FF',
  docsUrl: 'https://support.sapo.vn/tai-lieu-api',
  auth: {
    type: 'api_key',
    instructions: {
      vi: 'Trong trang quản trị Sapo, vào Ứng dụng → Phát triển ứng dụng riêng để lấy API key/secret hoặc access token. Nhập tên miền cửa hàng dạng cuahang.mysapo.net (Sapo Web) hoặc cuahang.mysapogo.com (Sapo POS/Omni).',
      en: 'In the Sapo admin, go to Apps → Private apps to obtain an API key/secret or access token. Enter the store domain as store.mysapo.net (Sapo Web) or store.mysapogo.com (Sapo POS/Omni).',
    },
    fields: [
      {
        key: 'storeDomain',
        label: { vi: 'Tên miền cửa hàng', en: 'Store domain' },
        type: 'text',
        required: true,
        placeholder: 'cuahang.mysapo.net',
      },
      {
        key: 'accessToken',
        label: { vi: 'Access Token', en: 'Access Token' },
        type: 'password',
        secret: true,
        help: {
          vi: 'Dùng cho ứng dụng OAuth. Nếu dùng private app thì để trống và điền API key/secret bên dưới.',
          en: 'For OAuth apps. Leave empty when using a private app and fill in the key/secret below instead.',
        },
      },
      // Both halves of the pair are secret: together they are the Basic auth
      // header, so the key is no less sensitive than the secret.
      { key: 'apiKey', label: { vi: 'API Key', en: 'API Key' }, type: 'password', secret: true },
      { key: 'apiSecret', label: { vi: 'API Secret', en: 'API Secret' }, type: 'password', secret: true },
    ],
  },
  // Confirmed entries first: the probe and the Hub take the first match.
  endpoints: [...sapoEndpoints, ...sapoDeclaredEndpoints],
  resolveBaseUrl: (context) => normaliseBaseUrl(context.credentials.storeDomain),
  customHeaders: authHeaders,
  actions: [createListPermissionsAction('sapo')],
  hints: [
    'sapoUnauthorized',
    'sapoNotFound',
    'sapoMissingCredentials',
    'sapoShopForbidden',
    'sapoNoPermission',
    ...LIST_PERMISSIONS_HINTS,
  ],
  buildRequest,
  testConnection,
  parseError,
}

export default sapoPlugin
