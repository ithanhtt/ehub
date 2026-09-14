import { sendRequest, type HttpResult } from '@/core/plugins/http'
import type { BuildRequestArgs, PreparedRequest } from '@/core/plugins/types'

/**
 * "Every GMV Max campaign this connection can see."
 *
 * /gmv_max/campaign/get/ answers for one advertiser and one promotion type at
 * a time, at most 100 rows a page. Left blank in the Hub, the advertiser field
 * means all of them: each advertiser the token reaches (stored on the
 * connection by its test) is asked for each type, every page is walked, and
 * the rows come back as a single list — so Send and "save as dataset" both get
 * the whole set from one click.
 *
 * Each row gains `gmv_max_promotion_type`, because TikTok's own rows do not
 * say whether a campaign is Product or LIVE GMV Max. An advertiser that
 * refuses the call is listed in `data.failures` rather than sinking the rest.
 */

export const GMV_MAX_CAMPAIGN_LIST = 'gmv-max-campaign-get'

const PROMOTION_TYPES = ['PRODUCT_GMV_MAX', 'LIVE_GMV_MAX'] as const
const PAGE_SIZE = 100
/** Parallel requests. TikTok limits per app; four keeps a 24-account sweep quick without tripping it. */
const CONCURRENCY = 4

type Row = Record<string, unknown>
type Job = { advertiserId: string; type: string }
type Outcome = { rows: unknown[]; total: number; error?: string }

const isRecord = (value: unknown): value is Row =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Codes worth waiting out, from TikTok's return-code appendix: 40100 / 40132 /
 * 40133 are its rate limits (answered as HTTP 200), 50000 / 50002 / 51305 its
 * own transient failures. A sweep of 48+ requests is exactly what trips the
 * first group, and a campaign list that silently lost an account's second page
 * to one of them would look complete.
 */
const TRANSIENT_CODES = new Set([40100, 40132, 40133, 50000, 50002, 51305])
const TRANSIENT_RETRIES = 3

const codeOf = (body: unknown) => (isRecord(body) && typeof body.code === 'number' ? body.code : 0)

export async function sendPatiently(prepared: PreparedRequest): Promise<HttpResult> {
  let response = await sendRequest(prepared, { maxRetries: 2 })
  for (let attempt = 1; attempt <= TRANSIENT_RETRIES && TRANSIENT_CODES.has(codeOf(response.data)); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt))
    response = await sendRequest(prepared, { maxRetries: 2 })
  }
  return response
}

function advertisersOf(metadata: Row): Array<{ id: string; name?: string }> {
  if (Array.isArray(metadata.advertisers)) {
    return metadata.advertisers.flatMap((item) =>
      isRecord(item) && item.id ? [{ id: String(item.id), name: item.name ? String(item.name) : undefined }] : [],
    )
  }
  return Array.isArray(metadata.advertiserIds) ? metadata.advertiserIds.map((id) => ({ id: String(id) })) : []
}

export async function gatherGmvMaxCampaigns(
  { endpoint, params, context }: BuildRequestArgs,
  build: (args: BuildRequestArgs) => PreparedRequest,
  parseError: (status: number, body: unknown) => string | null,
): Promise<{ result: HttpResult; prepared: PreparedRequest } | null> {
  if (endpoint.id !== GMV_MAX_CAMPAIGN_LIST) return null

  const filtering = isRecord(params.filtering) ? params.filtering : {}
  const requestedTypes = Array.isArray(filtering.gmv_max_promotion_types)
    ? filtering.gmv_max_promotion_types.map(String).filter(Boolean)
    : []
  const chosen = typeof params.advertiser_id === 'string' ? params.advertiser_id.trim() : ''

  // One account and one type is an ordinary paged call; leave it alone.
  if (chosen && requestedTypes.length === 1) return null

  const known = advertisersOf(context.metadata)
  const advertisers = chosen ? [{ id: chosen, name: known.find((a) => a.id === chosen)?.name }] : known
  // Nothing stored yet (the connection was never tested): let the single call
  // run, so TikTok's own "advertiser_id is required" explains what is missing.
  if (advertisers.length === 0) return null

  const types = requestedTypes.length > 0 ? requestedTypes : [...PROMOTION_TYPES]
  // The merged list must still say whose campaign each row is.
  const fields =
    Array.isArray(params.fields) && params.fields.length > 0
      ? [...new Set([...params.fields.map(String), 'advertiser_id', 'campaign_id'])]
      : undefined

  const jobs: Job[] = advertisers.flatMap((a) => types.map((type) => ({ advertiserId: a.id, type })))
  const outcomes: Outcome[] = new Array(jobs.length)
  const started = Date.now()
  let first: PreparedRequest | undefined

  const runJob = async (job: Job): Promise<Outcome> => {
    const rows: unknown[] = []
    let total = 0
    for (let page = 1; ; page++) {
      const prepared = build({
        endpoint,
        context,
        params: {
          ...params,
          advertiser_id: job.advertiserId,
          filtering: { ...filtering, gmv_max_promotion_types: [job.type] },
          fields,
          page,
          page_size: PAGE_SIZE,
        },
      })
      first ??= prepared

      const response = await sendPatiently(prepared)
      const error = parseError(response.status, response.data) ?? (response.ok ? null : (response.error ?? `HTTP ${response.status}`))
      if (error) return { rows, total, error }

      const data = isRecord(response.data) && isRecord(response.data.data) ? response.data.data : {}
      const pageInfo = isRecord(data.page_info) ? data.page_info : {}
      for (const row of Array.isArray(data.list) ? data.list : []) {
        rows.push(isRecord(row) ? { ...row, gmv_max_promotion_type: job.type } : row)
      }
      total = Number(pageInfo.total_number ?? rows.length)
      if (page >= Number(pageInfo.total_page ?? 1)) return { rows, total }
    }
  }

  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++
      outcomes[index] = await runJob(jobs[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))

  // Job order, not arrival order: the same sweep always lists rows the same way.
  const nameOf = (id: string) => advertisers.find((a) => a.id === id)?.name
  const list = outcomes.flatMap((outcome) => outcome.rows)
  const summary = jobs.flatMap((job, i) =>
    outcomes[i].total > 0
      ? [{ advertiser_id: job.advertiserId, advertiser_name: nameOf(job.advertiserId), gmv_max_promotion_type: job.type, total: outcomes[i].total }]
      : [],
  )
  const failures = jobs.flatMap((job, i) =>
    outcomes[i].error
      ? [{ advertiser_id: job.advertiserId, advertiser_name: nameOf(job.advertiserId), gmv_max_promotion_type: job.type, error: outcomes[i].error }]
      : [],
  )

  const everyCallFailed = failures.length === jobs.length
  const payload = {
    // Non-zero only when nothing succeeded, so parseError reports it as a failure.
    code: everyCallFailed ? 1 : 0,
    // Partial is still a success (the rows are real), but it must not read as complete.
    message: everyCallFailed
      ? `All ${jobs.length} requests failed. First: ${failures[0]?.error}`
      : failures.length > 0
        ? `Partial: ${failures.length} of ${jobs.length} account/type requests failed — see data.failures.`
        : 'OK',
    data: {
      list,
      page_info: { page: 1, page_size: list.length, total_number: list.length, total_page: 1 },
      gathered: { advertisers: advertisers.length, promotion_types: types, requests: jobs.length },
      summary,
      failures,
    },
  }

  return {
    prepared: first ?? build({ endpoint, params, context }),
    result: {
      ok: true,
      status: 200,
      durationMs: Date.now() - started,
      bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      data: payload,
      contentType: 'application/json',
    },
  }
}
