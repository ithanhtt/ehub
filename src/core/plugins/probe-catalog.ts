import 'server-only'

import { sendRequest, type HttpResult } from './http'
import { coerceParams, validateParams } from './params'
import type { ActionFinding, ConnectionContext, ConnectorPlugin, EndpointSpec, PreparedRequest } from './types'

/**
 * Asks the provider which catalogue endpoints this connection may actually use.
 *
 * There is no permissions API to consult — neither TikTok nor Sapo exposes one,
 * and neither publishes a spec — so the only honest answer comes from trying.
 * Each read endpoint is called once with the smallest legal request, and the
 * response says whether the token is allowed there.
 *
 * Deliberately narrow: only GET endpoints, only one page, and mutating ones are
 * skipped without being touched. A permission probe that paused a campaign to
 * find out whether it could would be worse than no probe.
 */

export type EndpointProbe = {
  endpointId: string
  group: string
  method: string
  path: string
  state: 'allowed' | 'denied' | 'error' | 'skipped'
  detail: string
}

/**
 * Provider codes that mean "not permitted" rather than "bad request".
 *
 * From TikTok's return-code appendix: 40001 no permission, 40118 allowlist
 * only, 40125 developer lacks permission, 40101–40103 credentials rejected or
 * expired. 40100 used to sit here and is in fact the app-level rate limit —
 * a throttled probe must never read as a refusal.
 */
const PERMISSION_CODES = new Set([
  40001, 40101, 40102, 40103, 40118, 40125,
  // TikTok Shop (Partner Center, "Common errors"): 105005 the app lacks the scope.
  105005,
])

/** TikTok throttles with HTTP 200 and a code: app-level, per field value, per advertiser. */
const THROTTLE_CODES = new Set([40100, 40132, 40133])

function isThrottled(result: HttpResult): boolean {
  const code = extractCode(result.data)
  return result.status === 429 || (code !== null && THROTTLE_CODES.has(code))
}

const MINIMAL_PAGE_SIZE = 1

export interface ProbeOptions {
  /** Cap the number of requests so a large catalogue cannot stall the UI. */
  limit?: number
  /** How many probes are in flight at once. */
  concurrency?: number
}

/*
 * A catalogue of 150 endpoints made the original sequential loop the binding
 * constraint: ~80 probable requests at a few hundred milliseconds each is a
 * minute of staring at a spinner, and the old budget of 40 hid half the
 * catalogue behind "budget reached" rather than answering the question.
 *
 * Six at a time is chosen against the provider, not the client: TikTok rate
 * limits per app, and a probe that trips that limit reports "denied" for
 * endpoints the token can actually reach - the one wrong answer this tool must
 * never give. Six keeps a full catalogue under ten seconds with headroom.
 */
const DEFAULT_LIMIT = 120
const DEFAULT_CONCURRENCY = 6

/** Pauses of 1.5s, 3s, … 9s: about half a minute before a probe gives up. */
const RATE_LIMIT_RETRIES = 6
const RATE_LIMIT_WAIT_MS = 1_500

/**
 * Shared by every worker, so one 429 pauses them all. Separate backoffs let
 * six workers take turns draining the same bucket, and the unlucky one runs
 * out of retries while the others are still being served.
 */
type Throttle = { until: number }

export async function probeCatalog(
  plugin: ConnectorPlugin,
  context: ConnectionContext,
  options: ProbeOptions = {},
): Promise<EndpointProbe[]> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)

  /*
   * Deciding what to call is separated from calling it. Every skip reason is
   * settled up front, in catalogue order, so the request budget is spent on a
   * known set and the returned record stays in catalogue order whatever
   * sequence the responses arrive in. (`summariseProbe` regroups it by state
   * for display; this is the faithful version.)
   */
  const results: EndpointProbe[] = []
  const pending: Array<{ index: number; endpoint: EndpointSpec; params: Record<string, unknown> }> = []

  for (const endpoint of plugin.endpoints) {
    const base = {
      endpointId: endpoint.id,
      group: endpoint.group,
      method: endpoint.method,
      path: endpoint.path,
    }
    const index = results.length

    if (endpoint.method !== 'GET' || endpoint.mutating) {
      results.push({ ...base, state: 'skipped', detail: 'Not probed: only read endpoints are tried.' })
      continue
    }

    if (pending.length >= limit) {
      results.push({ ...base, state: 'skipped', detail: 'Not probed: request budget reached.' })
      continue
    }

    const params = minimalProbeParams(endpoint)
    const resolved = plugin.resolveParams
      ? plugin.resolveParams({ endpoint, params, context })
      : params

    // An endpoint we cannot even form a legal request for tells us nothing
    // about permission, so it is reported as untried rather than as denied.
    const issues = validateParams(endpoint, resolved)
    if (issues.length > 0) {
      results.push({
        ...base,
        state: 'skipped',
        detail: `Not probed: needs ${issues.map((i) => i.key).join(', ')}.`,
      })
      continue
    }

    results.push({ ...base, state: 'skipped', detail: 'Not probed.' })
    pending.push({ index, endpoint, params: resolved })
  }

  let next = 0
  const throttle: Throttle = { until: 0 }
  const worker = async () => {
    while (next < pending.length) {
      const job = pending[next++]
      results[job.index] = await probeOne(plugin, context, job.endpoint, job.params, results[job.index], throttle)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker))

  return results
}

/** Sends once the shared pause, if any, has passed. */
async function throttledSend(prepared: PreparedRequest, throttle: Throttle) {
  const wait = throttle.until - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  return sendRequest(prepared, { maxRetries: 0, timeoutMs: 15_000 })
}

/** Calls one endpoint and reads permission out of the answer. */
async function probeOne(
  plugin: ConnectorPlugin,
  context: ConnectionContext,
  endpoint: EndpointSpec,
  params: Record<string, unknown>,
  base: EndpointProbe,
  throttle: Throttle,
): Promise<EndpointProbe> {
  const prepared = plugin.buildRequest({ endpoint, params, context })

  // A throttled probe says nothing about permission. Sapo's bucket holds 40
  // calls (x-sapo-api-call-limit), which a full catalogue overruns, and TikTok
  // answers its limits with HTTP 200 and 40100/40133; waiting it out beats
  // reporting the tail of the catalogue as untried — or worse, as refused.
  let result = await throttledSend(prepared, throttle)
  for (let attempt = 1; isThrottled(result) && attempt <= RATE_LIMIT_RETRIES; attempt++) {
    throttle.until = Math.max(throttle.until, Date.now() + RATE_LIMIT_WAIT_MS * attempt)
    result = await throttledSend(prepared, throttle)
  }

  const bodyError = plugin.parseError?.(result.status, result.data) ?? null
  if (!bodyError && result.ok) {
    return { ...base, state: 'allowed', detail: `HTTP ${result.status}` }
  }

  const code = extractCode(result.data)
  const message = bodyError ?? result.error ?? `HTTP ${result.status}`

  return {
    ...base,
    state:
      (code !== null && PERMISSION_CODES.has(code)) || result.status === 401 || result.status === 403
        ? 'denied'
        : 'error',
    detail: message,
  }
}

/**
 * The smallest request the endpoint will accept.
 *
 * Defaults first, then a page size of one so a probe never pulls a real page
 * of data, then a placeholder for anything still required. The point is a
 * legal request, not a useful one.
 */
export function minimalProbeParams(endpoint: EndpointSpec): Record<string, unknown> {
  const raw: Record<string, unknown> = {}

  for (const spec of endpoint.params) {
    if (spec.defaultValue !== undefined) raw[spec.key] = spec.defaultValue
  }
  if (endpoint.pagination?.sizeParam) raw[endpoint.pagination.sizeParam] = MINIMAL_PAGE_SIZE
  if (endpoint.pagination?.pageParam) raw[endpoint.pagination.pageParam] = 1

  /*
   * An endpoint may accept a page size without declaring a full pagination
   * contract - that is exactly what a path-declared entry does, since walking
   * the collection needs a confirmed id field. Honour the param anyway, or the
   * probe pulls a real page of live data purely to learn one bit.
   */
  // `page_size` is TikTok's name for it, `limit` is Sapo's.
  for (const key of ['page_size', 'limit']) {
    if (endpoint.params.some((p) => p.key === key)) raw[key] = MINIMAL_PAGE_SIZE
  }

  for (const spec of endpoint.params) {
    if (!spec.required || raw[spec.key] !== undefined || spec.satisfiedByConnection) continue
    raw[spec.key] =
      spec.type === 'number'
        ? 1
        : spec.type === 'date'
          ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
          : spec.type === 'boolean'
            ? false
            : spec.type === 'json'
              ? {}
              : spec.type === 'string[]'
                ? []
                : spec.type === 'enum'
                  ? (spec.options?.[0]?.value ?? '')
                  : ''
  }

  return coerceParams(endpoint, raw)
}

function extractCode(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'number' ? code : null
}

/** Condenses the probe into the checklist a connector action returns. */
export function summariseProbe(probes: EndpointProbe[]): {
  findings: ActionFinding[]
  allowed: number
  denied: number
  skipped: number
} {
  const allowed = probes.filter((p) => p.state === 'allowed')
  const denied = probes.filter((p) => p.state === 'denied')
  const errored = probes.filter((p) => p.state === 'error')
  const skipped = probes.filter((p) => p.state === 'skipped')

  /*
   * Grouped by state, not by catalogue position.
   *
   * `probeCatalog` returns catalogue order because that is the faithful record
   * of what was tried. A person reading the result wants the opposite: a
   * hundred and fifty lines of "allowed" is not the answer, the refusals are.
   * Denied first, then the endpoints that errored for some other reason, then
   * what worked, then what was never tried. Catalogue order is kept inside
   * each group, so related endpoints still sit together.
   */
  const RANK: Record<EndpointProbe['state'], number> = { denied: 0, error: 1, allowed: 2, skipped: 3 }

  const findings: ActionFinding[] = [...probes]
    .sort((a, b) => RANK[a.state] - RANK[b.state])
    .map((probe) => ({
      label: { vi: `${probe.method} ${probe.path}`, en: `${probe.method} ${probe.path}` },
      state:
        probe.state === 'allowed'
          ? 'ok'
          : probe.state === 'denied'
            ? 'fail'
            : probe.state === 'error'
              ? 'warn'
              : 'skipped',
      detail: `${probe.endpointId} · ${probe.detail}`,
    }))

  return {
    findings,
    allowed: allowed.length,
    denied: denied.length,
    skipped: skipped.length + errored.length,
  }
}
