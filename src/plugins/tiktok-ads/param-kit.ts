import type { ParamSpec } from '@/core/plugins/types'

/**
 * Param pieces shared by the curated catalogue and the declared one.
 *
 * Both files need the same advertiser_id and paging shapes, and a copy in each
 * would drift — the help text is what tells the user they can leave the field
 * blank, and it must say the same thing everywhere.
 */

/**
 * The advertiser the call acts on.
 *
 * `satisfiedByConnection` is the contract with the browser: the field may be
 * left blank because `resolveParams` fills it from the connection server-side,
 * where the credentials actually live.
 */
export const advertiserId = (required = true): ParamSpec => ({
  key: 'advertiser_id',
  label: { vi: 'Advertiser ID', en: 'Advertiser ID' },
  in: 'query',
  type: 'string',
  required,
  satisfiedByConnection: true,
  // Both keys are written by testConnection: every advertiser the token can
  // reach, and the one it settled on as the default.
  choicesFrom: { list: 'advertisers', auto: 'advertiserId' },
  help: {
    vi: 'Để trống sẽ dùng Advertiser ID mặc định đã lưu trong kết nối.',
    en: 'Leave empty to use the default Advertiser ID stored on the connection.',
  },
})

/**
 * The Business Center the call acts on.
 *
 * Not `satisfiedByConnection`: a connection stores no bc_id, so promising the
 * form it can be blank would only move the failure to the provider. The help
 * points at the endpoint that lists the ids instead.
 */
export const bcId = (required = true): ParamSpec => ({
  key: 'bc_id',
  label: { vi: 'Business Center ID', en: 'Business Center ID' },
  in: 'query',
  type: 'string',
  required,
  help: {
    vi: 'Lấy bằng endpoint "Danh sách Business Center" (/bc/get/).',
    en: 'Obtain one from the "List Business Centers" endpoint (/bc/get/).',
  },
})

/**
 * Paging, declared without a `pagination` contract on purpose.
 *
 * A `PaginationSpec` is a claim that the Hub can walk the whole collection and
 * upsert each row, and that needs a confirmed id field. These two params are
 * the weaker, true statement: the provider accepts them if you send them.
 *
 * No `defaultValue`, so nothing is sent unless the user asks for it — an
 * unexpected query param is rejected outright by some TikTok endpoints.
 */
export const pageParams: ParamSpec[] = [
  {
    key: 'page',
    label: { vi: 'Trang', en: 'Page' },
    in: 'query',
    type: 'number',
    placeholder: '1',
  },
  {
    key: 'page_size',
    label: { vi: 'Số dòng/trang', en: 'Page size' },
    in: 'query',
    type: 'number',
    placeholder: '10',
  },
]

/**
 * The whole request body, as one JSON object.
 *
 * Write endpoints each take their own field set and TikTok publishes no
 * machine-readable spec to generate them from, so the honest declaration is a
 * single object the user pastes from the docs. `buildRequest` spreads it at the
 * top level, so the provider sees its own field names rather than a nested
 * "body" key.
 */
export const bodyParam: ParamSpec = {
  key: 'body',
  label: { vi: 'Body (JSON)', en: 'Body (JSON)' },
  in: 'body',
  type: 'json',
  required: true,
  placeholder: '{ "campaign_name": "..." }',
  help: {
    vi: 'Dán nguyên object JSON theo tài liệu TikTok. advertiser_id / bc_id ở trên sẽ được gộp vào body, không cần khai lại.',
    en: 'Paste the JSON object straight from the TikTok docs. The advertiser_id / bc_id above is merged into the body, so there is no need to repeat it.',
  },
}
