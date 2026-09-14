import { buildQueryString, sendRequest } from '@/core/plugins/http'
import { applyPathParams, partitionParams } from '@/core/plugins/params'
import type {
  BuildRequestArgs,
  ConnectorPlugin,
  ConnectionContext,
  CredentialResolution,
  TestResult,
} from '@/core/plugins/types'
import { createListPermissionsAction, LIST_PERMISSIONS_HINTS } from '@/core/plugins/list-permissions'
import { tiktokActions } from './actions'
import {
  APP_CREDENTIALS_REJECTED,
  BASE_URL,
  CODE_ALREADY_USED,
  advertiserIdFrom,
  authHeaders,
  exchangeAuthCode,
} from './context'
import { tiktokDeclaredEndpoints } from './endpoints-declared'
import { tiktokEndpoints } from './endpoints'
import { tiktokGmvMaxEndpoints } from './endpoints-gmv-max'
import { GMV_MAX_CAMPAIGN_LIST, gatherGmvMaxCampaigns } from './gmv-max'

/**
 * TikTok Ads connector.
 *
 * Two provider quirks shape this file:
 *  1. Authentication is a bare `Access-Token` header, not a Bearer scheme.
 *  2. Failures come back as HTTP 200 with a non-zero `code` in the body, so
 *     `parseError` is what actually decides whether a call succeeded.
 */

/**
 * Supplies the values a saved connection already knows, so the common case is
 * a form the user can submit without retyping their advertiser id.
 */
function resolveParams({ endpoint, params, context }: BuildRequestArgs): Record<string, unknown> {
  const resolved = { ...params }

  // The GMV Max campaign list reads a blank advertiser as "every advertiser"
  // (gmv-max.ts), so the default account must not be slipped in for it.
  if (
    endpoint.id !== GMV_MAX_CAMPAIGN_LIST &&
    endpoint.params.some((p) => p.key === 'advertiser_id') &&
    !resolved.advertiser_id
  ) {
    const fallback = advertiserIdFrom(context)
    if (fallback) resolved.advertiser_id = fallback
  }

  // Same idea for the app credentials used by the advertiser-discovery call.
  if (endpoint.id === 'authorized-advertisers') {
    if (!resolved.app_id && context.credentials.appId) resolved.app_id = context.credentials.appId
    if (!resolved.secret && context.credentials.appSecret) resolved.secret = context.credentials.appSecret
  }

  return resolved
}

/**
 * Assembles a POST payload.
 *
 * A declared write endpoint carries its whole payload in one `body` param,
 * because TikTok publishes no spec to generate typed fields from. That object
 * is spread at the top level so the provider sees its own field names instead
 * of a nested "body" key, and the owning params (advertiser_id, bc_id) are
 * merged over it — TikTok reads those from the body on POST.
 *
 * Merge order puts the declared params last on purpose: the advertiser the
 * user selected on the form wins over a stale id left inside pasted JSON.
 */
function bodyPayload(body: Record<string, unknown>, query: Record<string, unknown>) {
  const { body: freeForm, ...rest } = body
  const spread =
    freeForm && typeof freeForm === 'object' && !Array.isArray(freeForm)
      ? (freeForm as Record<string, unknown>)
      : {}

  return { ...spread, ...rest, ...query }
}

function buildRequest({ endpoint, params, context }: BuildRequestArgs) {
  const { query, body, path } = partitionParams(endpoint, params)
  const url = `${BASE_URL}${applyPathParams(endpoint.path, path)}`
  const isBodyMethod = endpoint.method === 'POST' || endpoint.method === 'PUT'

  return {
    url: isBodyMethod ? url : `${url}${buildQueryString(query)}`,
    method: endpoint.method,
    headers: authHeaders(context),
    body: isBodyMethod ? JSON.stringify(bodyPayload(body, query)) : undefined,
    redactedUrl: isBodyMethod
      ? url
      : `${url}${buildQueryString({ ...query, secret: query.secret ? '••••••••' : undefined })}`,
  }
}

function parseError(status: number, body: unknown): string | null {
  if (status !== 200) return null
  if (!body || typeof body !== 'object') return null
  const payload = body as { code?: number; message?: string; request_id?: string }
  if (payload.code === undefined || payload.code === 0) return null
  return `TikTok error ${payload.code}: ${payload.message ?? 'unknown error'}`
}

function errorCodeOf(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'number' ? code : null
}

/**
 * Turns a TikTok error code into the field the user should actually look at.
 *
 * Established by probing the live API with deliberately broken combinations:
 *
 *   app_id + secret both wrong, token wrong  -> 40105
 *   no app params at all,       token wrong  -> 40105
 *   app_id + secret both wrong, token empty  -> 40104
 *   app_id + secret wrong (token exchange)   -> 40002
 *
 * The load-bearing finding is that TikTok validates the **token first**: 40105
 * appears even when app_id and secret are garbage. So a user who sees 40105 is
 * looking at a token problem, and inspecting their App ID is wasted effort —
 * which is exactly the wrong turn this mapping exists to prevent.
 */
function hintForCode(code: number | null): string | undefined {
  switch (code) {
    case 40104:
      return 'tiktokTokenEmpty'
    case 40105:
      return 'tiktokTokenRejected'
    case 40002:
    case 40001:
      return 'tiktokAppCredentials'
    // Per TikTok's return-code appendix, 40101 is "secret and app ID do not
    // match" and 40100 the app-level rate limit — neither is a missing scope,
    // which is what both used to be reported as.
    case 40101:
      return 'tiktokAppCredentials'
    case 40100:
    case 40132:
    case 40133:
      return 'tiktokRateLimited'
    case 40125:
      return 'tiktokPermission'
    default:
      return code === null ? undefined : 'tiktokUnknown'
  }
}

/** Lists the advertisers an app may reach. Needs app credentials *and* the token. */
async function probeAdvertiserList(context: ConnectionContext, appId: string, appSecret: string) {
  return sendRequest(
    {
      url: `${BASE_URL}/oauth2/advertiser/get/${buildQueryString({ app_id: appId, secret: appSecret })}`,
      method: 'GET',
      headers: authHeaders(context),
    },
    { maxRetries: 0 },
  )
}

/*
 * The two advertiser endpoints disagree on the name field, and TikTok rejects
 * the wrong one outright:
 *
 *   /oauth2/advertiser/get/  returns  advertiser_name
 *   /advertiser/info/        wants    name        (advertiser_name -> 40002)
 *
 * Getting this wrong is not cosmetic. /advertiser/info/ is the token-only
 * probe, so a bad field name there makes a perfectly valid token report as
 * rejected — the exact opposite of the truth. Found by testing against a real
 * app; no offline check could have caught it.
 */

/** Reads one advertiser. Needs only the token, so it isolates token validity. */
async function probeAdvertiserInfo(context: ConnectionContext, advertiserId: string) {
  return sendRequest(
    {
      url: `${BASE_URL}/advertiser/info/${buildQueryString({
        advertiser_ids: [advertiserId],
        fields: ['advertiser_id', 'name', 'currency', 'timezone'],
      })}`,
      method: 'GET',
      headers: authHeaders(context),
    },
    { maxRetries: 0 },
  )
}

/**
 * Verifies a connection, and when it fails, says which credential is at fault.
 *
 * Two probes, tried in order, because they fail for different reasons:
 *
 *   1. advertiser list — proves the token *and* the app credentials, and
 *      discovers which accounts are reachable.
 *   2. advertiser info — proves only the token.
 *
 * If (1) fails but (2) succeeds, the token is fine and the App ID/Secret pair
 * is the problem. Reporting that as a working connection with a warning
 * matters: every data endpoint in the catalogue authenticates with the token
 * alone, so the connection is genuinely usable and the old code would have
 * blocked it outright.
 */
async function testConnection(context: ConnectionContext): Promise<TestResult> {
  const { accessToken, appId, appSecret } = context.credentials
  const advertiserId = advertiserIdFrom(context)

  if (!accessToken) {
    return { ok: false, message: 'Access Token is missing.', hint: 'tiktokTokenEmpty' }
  }

  let listFailure: { message: string; code: number | null } | null = null

  if (appId && appSecret) {
    const result = await probeAdvertiserList(context, appId, appSecret)
    const error = parseError(result.status, result.data) ?? result.error

    if (!error) {
      const list = (
        result.data as { data?: { list?: Array<{ advertiser_id: string; advertiser_name: string }> } }
      )?.data?.list

      if (list?.length) {
        return {
          ok: true,
          message: `Connected. ${list.length} advertiser account(s) available.`,
          metadata: {
            advertisers: list.map((a) => ({ id: a.advertiser_id, name: a.advertiser_name })),
            advertiserId: advertiserId || list[0].advertiser_id,
          },
        }
      }
      return {
        ok: false,
        message: 'The token works, but no advertiser account has authorised this app.',
        hint: 'tiktokNoAdvertiser',
      }
    }

    listFailure = { message: error, code: errorCodeOf(result.data) }
  }

  // Fall back to the token-only probe so a mismatched app credential cannot
  // hide a working token.
  if (advertiserId) {
    const result = await probeAdvertiserInfo(context, advertiserId)
    const error = parseError(result.status, result.data) ?? result.error

    if (!error) {
      const info = (result.data as { data?: { list?: Array<Record<string, string>> } })?.data?.list?.[0]
      const metadata = info
        ? { advertiserId, currency: info.currency, timezone: info.timezone }
        : { advertiserId }

      if (listFailure) {
        return {
          ok: true,
          message: `Access token is valid, but the app credentials were rejected (${listFailure.message}).`,
          hint: 'tiktokAppCredentials',
          metadata,
        }
      }
      return {
        ok: true,
        message: info ? `Connected to ${info.name}.` : 'Connected.',
        metadata,
      }
    }

    const code = errorCodeOf(result.data)
    return { ok: false, message: error, hint: hintForCode(code) }
  }

  if (listFailure) {
    return { ok: false, message: listFailure.message, hint: hintForCode(listFailure.code) }
  }

  return {
    ok: false,
    message: 'Nothing to verify the token against.',
    hint: 'tiktokNeedsProbe',
  }
}


/**
 * Turns whatever the user pasted into a stored access token.
 *
 * An auth_code and an access token are two answers to the same question, so
 * the form accepts either and this decides what to do with it. The auth_code
 * never reaches storage: it is single-use, and a spent one sitting in the
 * credential bag would look like a working credential while being worthless.
 */
async function resolveCredentials({
  credentials,
}: {
  credentials: Record<string, string>
  previous: Record<string, string>
}): Promise<CredentialResolution> {
  const { appId, appSecret, authCode, accessToken } = credentials

  // Never store it, whatever happens below.
  const stored = { ...credentials }
  delete stored.authCode

  if (!authCode) {
    if (accessToken) return { ok: true, credentials: stored }
    return {
      ok: false,
      credentials: stored,
      message: 'Neither an auth_code nor an Access Token was provided.',
      hint: 'tiktokNeedsCodeOrToken',
    }
  }

  if (!appId || !appSecret) {
    return {
      ok: false,
      credentials: stored,
      message: 'App ID and App Secret are required to exchange an auth_code.',
      hint: 'tiktokExchangeNeedsApp',
    }
  }

  const result = await exchangeAuthCode(appId, appSecret, authCode)
  const body = (result.data ?? {}) as { code?: number; message?: string; data?: Record<string, unknown> }

  if (body.code !== 0) {
    const message = body.message ?? result.error ?? 'unknown error'
    return {
      ok: false,
      credentials: stored,
      message: `TikTok error ${body.code}: ${message}`,
      hint: APP_CREDENTIALS_REJECTED.test(message)
        ? 'tiktokAppCredentials'
        : CODE_ALREADY_USED.test(message)
          ? 'tiktokCodeAlreadyUsed'
          : 'tiktokExchangeFailed',
    }
  }

  const issued = body.data?.access_token
  if (typeof issued !== 'string' || !issued) {
    return {
      ok: false,
      credentials: stored,
      message: 'TikTok accepted the code but returned no access_token.',
      hint: 'tiktokExchangeFailed',
    }
  }

  const advertiserIds = Array.isArray(body.data?.advertiser_ids)
    ? (body.data.advertiser_ids as unknown[]).map(String)
    : []

  return {
    ok: true,
    // The freshly issued token replaces anything that was there.
    credentials: {
      ...stored,
      accessToken: issued,
      ...(advertiserIds.length && !stored.advertiserId ? { advertiserId: advertiserIds[0] } : {}),
    },
    message: `Access Token issued from the auth_code.${
      advertiserIds.length ? ` ${advertiserIds.length} advertiser id(s) returned.` : ''
    }`,
    hint: 'tiktokExchangeOk',
    metadata: {
      ...(advertiserIds.length ? { advertiserIds } : {}),
      ...(body.data?.scope ? { scope: body.data.scope } : {}),
      tokenIssuedAt: new Date().toISOString(),
    },
  }
}

export const tiktokAdsPlugin: ConnectorPlugin = {
  id: 'tiktok-ads',
  name: 'TikTok Ads',
  description: {
    vi: 'Chiến dịch, nhóm quảng cáo, quảng cáo và báo cáo hiệu quả từ TikTok Business API v1.3.',
    en: 'Campaigns, ad groups, ads and performance reports from the TikTok Business API v1.3.',
  },
  version: '1.0.0',
  category: 'ads',
  color: '#FE2C55',
  docsUrl: 'https://business-api.tiktok.com/portal/docs',
  auth: {
    type: 'api_key',
    instructions: {
      vi: 'Lấy App ID và App Secret ở TikTok Developer Portal. Rồi điền MỘT trong hai: auth_code (lấy từ URL TikTok chuyển về sau khi uỷ quyền app) hoặc Access Token nếu bạn đã có. Nhấn lưu là xong — nếu bạn dán auth_code, hệ thống tự đổi thành Access Token.',
      en: 'Get the App ID and App Secret from the TikTok Developer Portal, then fill in ONE of two things: the auth_code from the URL TikTok redirects to after you authorise the app, or an Access Token if you already have one. Saving is the only step — an auth_code is exchanged for a token automatically.',
    },
    fields: [
      /*
       * App ID and Secret are required; the Access Token above is not.
       *
       * That looks backwards until you follow how TikTok issues tokens: the
       * app credentials are what mint one, and what lists the advertiser
       * accounts. A connection holding only a token can read data today but
       * cannot be repaired when that token is revoked. So the app is the unit
       * we insist on, and the token is the part this app can fetch for you.
       */
      {
        key: 'appId',
        label: { vi: 'App ID', en: 'App ID' },
        type: 'text',
        required: true,
        help: {
          vi: 'Lấy ở TikTok Developer Portal. Cần để đổi auth_code lấy token và để liệt kê tài khoản quảng cáo.',
          en: 'From the TikTok Developer Portal. Needed to exchange an auth_code for a token and to list advertiser accounts.',
        },
      },
      {
        key: 'appSecret',
        label: { vi: 'App Secret', en: 'App Secret' },
        type: 'password',
        secret: true,
        required: true,
      },
      /*
       * Two ways to arrive at a token, and the user picks whichever they have.
       *
       * auth_code is transient: resolveCredentials trades it for an access
       * token during the save, so one form does the whole job. Asking people
       * to save first and then find a separate tool was a step too many, and
       * it was the step where an auth_code got pasted into the token box.
       */
      {
        key: 'authCode',
        label: { vi: 'auth_code (dán vào đây nếu chưa có token)', en: 'auth_code (paste this if you have no token)' },
        type: 'password',
        secret: true,
        transient: true,
        help: {
          vi: 'Sau khi uỷ quyền app, TikTok chuyển về một URL dạng …/callback/?auth_code=XXXX — dán giá trị XXXX vào đây. Hệ thống sẽ tự đổi thành Access Token khi lưu. Mã này chỉ dùng được một lần và hết hạn nhanh.',
          en: 'After you authorise the app, TikTok redirects to …/callback/?auth_code=XXXX — paste XXXX here. It is exchanged for an Access Token when you save. The code is single-use and short-lived.',
        },
      },
      {
        key: 'accessToken',
        label: { vi: 'Access Token (nếu đã có sẵn)', en: 'Access Token (if you already have one)' },
        type: 'password',
        secret: true,
        help: {
          vi: 'Chỉ cần điền MỘT trong hai: auth_code ở trên, hoặc Access Token ở đây.',
          en: 'Fill in just ONE of the two: the auth_code above, or an Access Token here.',
        },
      },
      {
        key: 'advertiserId',
        label: { vi: 'Advertiser ID mặc định', en: 'Default Advertiser ID' },
        type: 'text',
        help: {
          vi: 'Không bắt buộc — kiểm tra kết nối sẽ tự tìm và ghi nhớ.',
          en: 'Optional — the connection test discovers and remembers one.',
        },
      },
    ],
  },
  /*
   * Confirmed entries first, so the permission probe spends its request
   * budget on the endpoints whose result is unambiguous before it starts
   * guessing at declared ones.
   */
  endpoints: [...tiktokEndpoints, ...tiktokGmvMaxEndpoints, ...tiktokDeclaredEndpoints],
  runEndpoint: (args) => gatherGmvMaxCampaigns(args, buildRequest, parseError),
  actions: [...tiktokActions, createListPermissionsAction('tiktok-ads')],
  hints: [
    'tiktokTokenRejected',
    'tiktokRateLimited',
    'tiktokTokenEmpty',
    'tiktokAppCredentials',
    'tiktokNoAdvertiser',
    'tiktokPermission',
    'tiktokNeedsProbe',
    'tiktokUnknown',
    'tiktokNeedsCodeOrToken',
    'tiktokCodeAlreadyUsed',
    'tiktokBothWrong',
    'tiktokExchangeOk',
    'tiktokExchangeFailed',
    'tiktokExchangeNeedsApp',
    ...LIST_PERMISSIONS_HINTS,
  ],
  resolveBaseUrl: () => BASE_URL,
  customHeaders: authHeaders,
  resolveCredentials,
  resolveParams,
  buildRequest,
  testConnection,
  parseError,
}

export default tiktokAdsPlugin
