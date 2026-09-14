import { buildQueryString, sendRequest } from '@/core/plugins/http'
import type {
  ActionFinding,
  ConnectorAction,
  ConnectorActionResult,
  ConnectionContext,
} from '@/core/plugins/types'
import {
  APP_CREDENTIALS_REJECTED,
  BASE_URL,
  MISSING_FIELD,
  advertiserIdFrom,
  authHeaders,
  exchangeAuthCode,
} from './context'

/**
 * Repair tools for a TikTok Ads connection.
 *
 * These exist because "TikTok error 40105" is a dead end for the user: it says
 * the access token is wrong but not *why*, and it says nothing at all about
 * whether the App ID and Secret next to it are correct. Both questions are
 * answerable, and both need provider-specific knowledge — so they live here.
 */

type TikTokBody = {
  code?: number
  message?: string
  data?: Record<string, unknown>
}

function bodyOf(data: unknown): TikTokBody {
  return data && typeof data === 'object' ? (data as TikTokBody) : {}
}

/**
 * Checks App ID + Secret without involving the access token at all.
 *
 * Sends a deliberately invalid auth_code to the exchange endpoint: the app
 * credentials are validated before the code is, so the error that comes back
 * identifies which half is wrong. One request, and an invalid code is never
 * consumed, so nothing is spent doing this.
 */
async function checkAppCredentials(
  appId: string,
  appSecret: string,
): Promise<{ state: 'ok' | 'fail'; detail: string }> {
  const result = await exchangeAuthCode(appId, appSecret, 'adshub-credential-probe')
  const body = bodyOf(result.data)
  const message = body.message ?? result.error ?? 'no response'

  if (body.code === 0) {
    // Vanishingly unlikely, but a valid exchange means the pair is certainly good.
    return { state: 'ok', detail: 'App credentials accepted.' }
  }
  if (APP_CREDENTIALS_REJECTED.test(message)) {
    return { state: 'fail', detail: message }
  }
  if (MISSING_FIELD.test(message)) {
    return { state: 'fail', detail: `Request rejected before the credentials were checked: ${message}` }
  }
  // Any other complaint means it got past the app credentials and objected to
  // the throwaway auth_code instead — which is the answer we wanted.
  return { state: 'ok', detail: `App credentials accepted (rejected only the probe code: ${message})` }
}

async function checkAccessToken(
  context: ConnectionContext,
  advertiserId: string | undefined,
): Promise<{ state: 'ok' | 'fail' | 'skipped'; detail: string; advertiserName?: string }> {
  if (!advertiserId) {
    return { state: 'skipped', detail: 'No default Advertiser ID to read, so the token was not probed on its own.' }
  }

  const result = await sendRequest(
    {
      url: `${BASE_URL}/advertiser/info/${buildQueryString({
        advertiser_ids: [advertiserId],
        fields: ['advertiser_id', 'name'],
      })}`,
      method: 'GET',
      headers: authHeaders(context),
    },
    { maxRetries: 0 },
  )

  const body = bodyOf(result.data)
  if (body.code === 0) {
    const list = (body.data?.list ?? []) as Array<Record<string, string>>
    return { state: 'ok', detail: 'Token accepted.', advertiserName: list[0]?.name }
  }
  return { state: 'fail', detail: `TikTok error ${body.code}: ${body.message ?? result.error ?? 'unknown'}` }
}

async function checkAdvertiserList(
  context: ConnectionContext,
  appId: string,
  appSecret: string,
): Promise<{ state: 'ok' | 'fail'; detail: string; advertisers?: Array<{ id: string; name: string }> }> {
  const result = await sendRequest(
    {
      url: `${BASE_URL}/oauth2/advertiser/get/${buildQueryString({ app_id: appId, secret: appSecret })}`,
      method: 'GET',
      headers: authHeaders(context),
    },
    { maxRetries: 0 },
  )

  const body = bodyOf(result.data)
  if (body.code !== 0) {
    return { state: 'fail', detail: `TikTok error ${body.code}: ${body.message ?? result.error ?? 'unknown'}` }
  }

  const list = (body.data?.list ?? []) as Array<{ advertiser_id: string; advertiser_name: string }>
  return {
    state: list.length ? 'ok' : 'fail',
    detail: list.length
      ? `${list.length} advertiser account(s) authorised.`
      : 'No advertiser account has authorised this app.',
    advertisers: list.map((a) => ({ id: a.advertiser_id, name: a.advertiser_name })),
  }
}

/* ------------------------------------------------------------- diagnose --- */

const diagnose: ConnectorAction = {
  id: 'diagnose',
  label: { vi: 'Chẩn đoán từng thông tin', en: 'Diagnose each credential' },
  description: {
    vi: 'Kiểm tra riêng App ID/Secret và Access Token để biết chính xác cái nào sai, thay vì chỉ nhận một mã lỗi chung.',
    en: 'Tests the App ID/Secret and the Access Token separately, so you learn which one is wrong instead of getting a single opaque code.',
  },
  mutatesCredentials: false,

  async run({ context }): Promise<ConnectorActionResult> {
    const { accessToken, appId, appSecret } = context.credentials
    const advertiserId = advertiserIdFrom(context)
    const findings: ActionFinding[] = []

    /* 1. App credentials, on their own. */
    if (appId && appSecret) {
      const app = await checkAppCredentials(appId, appSecret)
      findings.push({
        label: { vi: 'App ID + App Secret', en: 'App ID + App Secret' },
        state: app.state,
        detail: app.detail,
      })
    } else {
      findings.push({
        label: { vi: 'App ID + App Secret', en: 'App ID + App Secret' },
        state: 'skipped',
        detail:
          'Not provided. Without them no new token can be issued and advertiser accounts cannot be listed.',
      })
    }

    /* 2. The token, on its own. */
    const tokenFinding: ActionFinding = {
      label: { vi: 'Access Token', en: 'Access Token' },
      state: 'unknown',
    }
    if (!accessToken) {
      tokenFinding.state = 'fail'
      tokenFinding.detail = 'Empty.'
    } else {
      const token = await checkAccessToken(context, advertiserId)
      tokenFinding.state = token.state
      tokenFinding.detail = token.advertiserName
        ? `${token.detail} Reached "${token.advertiserName}".`
        : token.detail
    }
    findings.push(tokenFinding)

    /* 3. Token and app credentials working together. */
    let advertisers: Array<{ id: string; name: string }> | undefined
    if (accessToken && appId && appSecret) {
      const list = await checkAdvertiserList(context, appId, appSecret)
      advertisers = list.advertisers
      findings.push({
        label: { vi: 'Tài khoản quảng cáo được uỷ quyền', en: 'Authorised advertiser accounts' },
        state: list.state,
        detail: list.detail,
      })
    }

    const appOk = findings[0].state === 'ok'
    const appChecked = findings[0].state !== 'skipped'
    const tokenOk = tokenFinding.state === 'ok'
    const tokenChecked = tokenFinding.state !== 'skipped'

    /*
     * The verdict names the one thing to fix. Ordering matters: a bad token
     * with good app credentials is the common case and the hint for it is the
     * long "did you paste the auth_code" checklist.
     */
    let hint: string | undefined
    let message: string

    if (tokenChecked && !tokenOk && appChecked && appOk) {
      hint = 'tiktokTokenRejected'
      message = 'App ID and Secret are valid. The Access Token is the problem.'
    } else if (tokenChecked && !tokenOk && appChecked && !appOk) {
      hint = 'tiktokBothWrong'
      message = 'Both the app credentials and the Access Token were rejected.'
    } else if (appChecked && !appOk && tokenOk) {
      hint = 'tiktokAppCredentials'
      message = 'The Access Token works. The App ID / Secret pair was rejected.'
    } else if (!tokenChecked) {
      hint = 'tiktokNeedsProbe'
      message = 'The token could not be tested on its own.'
    } else if (tokenOk) {
      message = advertisers?.length
        ? `Everything checks out. ${advertisers.length} advertiser account(s) reachable.`
        : 'Credentials are valid.'
    } else {
      hint = 'tiktokTokenRejected'
      message = 'The Access Token was rejected.'
    }

    return {
      ok: tokenOk,
      message,
      hint,
      findings,
      metadata: advertisers?.length
        ? { advertisers, advertiserId: advertiserId || advertisers[0].id }
        : undefined,
    }
  },
}

export const tiktokActions: ConnectorAction[] = [diagnose]
