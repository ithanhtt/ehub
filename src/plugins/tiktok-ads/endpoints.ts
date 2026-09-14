import type { EndpointSpec, ParamSpec } from '@/core/plugins/types'
import { advertiserId } from './param-kit'

/**
 * TikTok Business API v1.3 — the confirmed catalogue.
 *
 * Every entry here had its parameters read from the official reference (the
 * portal's own content API, and the SDK generated from the same spec) and was
 * then checked against a live advertiser account: envelope, id field, page
 * size limits, and the accepted value of every enum. The enum lists are the
 * ones TikTok itself returns when a value is rejected, so they match what the
 * API accepts today rather than what an older doc page listed. The much larger
 * set declared from paths alone lives in endpoints-declared.ts and is marked
 * `unverified`.
 *
 * Only read endpoints are listed on purpose. The Hub is an inspection tool
 * first, and a mis-click that pauses a live campaign is a far worse failure
 * than a missing endpoint.
 *
 * TikTok expects array and object query parameters as JSON strings; the shared
 * buildQueryString helper already encodes them that way.
 */

export const options = (...values: string[]) => values.map((value) => ({ value, label: value }))

/*
 * Paging with defaults, unlike the declared catalogue's version: these
 * endpoints are known to accept both params, so sending them always is safe
 * and saves the user a step. The ceiling differs per endpoint — 1,000 for
 * campaigns and reports, 50 for Business Centers, 20 for pixels — and a value
 * above it is rejected outright (40002), so each entry states its own.
 */
export function page(max: number, defaultSize = 20): ParamSpec[] {
  return [
    {
      key: 'page',
      label: { vi: 'Trang', en: 'Page' },
      in: 'query',
      type: 'number',
      defaultValue: 1,
    },
    {
      key: 'page_size',
      label: { vi: 'Số dòng/trang', en: 'Page size' },
      in: 'query',
      type: 'number',
      defaultValue: Math.min(defaultSize, max),
      help: { vi: `Từ 1 đến ${max}.`, en: `From 1 to ${max}.` },
    },
  ]
}

export const pageContract = (max: number) =>
  ({ style: 'page', pageParam: 'page', sizeParam: 'page_size', defaultPageSize: 20, maxPageSize: max }) as const

/** `fields` + `exclude_field_types_in_response`, shared by the campaign/ad group/ad lists. */
function fieldSelection(examples: string): ParamSpec[] {
  return [
    {
      key: 'fields',
      label: { vi: 'Trường trả về', en: 'Fields' },
      in: 'query',
      type: 'string[]',
      placeholder: examples,
      help: {
        vi: 'Để trống để lấy tất cả trường. Tên trường sai sẽ bị TikTok từ chối kèm danh sách trường hợp lệ.',
        en: 'Leave empty for every field. An unknown name is rejected, and TikTok lists the valid ones.',
      },
    },
    {
      key: 'exclude_field_types_in_response',
      label: { vi: 'Bỏ loại trường', en: 'Exclude field types' },
      in: 'query',
      type: 'string[]',
      placeholder: 'NULL_FIELD',
      help: { vi: 'NULL_FIELD: bỏ các trường có giá trị null.', en: 'NULL_FIELD: drop fields whose value is null.' },
    },
  ]
}

const PRIMARY_STATUS = 'STATUS_NOT_DELETE, STATUS_DELIVERY_OK, STATUS_NOT_DELIVERY, STATUS_DISABLE, STATUS_DELETE, STATUS_ALL'

function entityFiltering(placeholder: string, keys: string): ParamSpec {
  return {
    key: 'filtering',
    label: { vi: 'Bộ lọc (JSON)', en: 'Filtering (JSON)' },
    in: 'query',
    type: 'json',
    placeholder,
    help: {
      vi: `Một object. Khoá hay dùng: ${keys}. primary_status nhận: ${PRIMARY_STATUS} (mặc định STATUS_NOT_DELETE).`,
      en: `One object. Common keys: ${keys}. primary_status accepts: ${PRIMARY_STATUS} (default STATUS_NOT_DELETE).`,
    },
  }
}

export const tiktokEndpoints: EndpointSpec[] = [
  {
    id: 'authorized-advertisers',
    group: 'Account',
    name: { vi: 'Danh sách tài khoản quảng cáo', en: 'Authorized advertisers' },
    description: {
      vi: 'Các advertiser mà access token hiện tại được phép truy cập. Dùng để lấy Advertiser ID.',
      en: 'Advertisers the current access token may reach. Use it to discover Advertiser IDs.',
    },
    method: 'GET',
    path: '/oauth2/advertiser/get/',
    resultPath: 'data.list',
    idField: 'advertiser_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1738455508553729',
    params: [
      {
        key: 'app_id',
        label: { vi: 'App ID', en: 'App ID' },
        in: 'query',
        type: 'string',
        required: true,
        satisfiedByConnection: true,
        help: { vi: 'Bỏ trống để dùng App ID của kết nối.', en: 'Leave empty to use the connection App ID.' },
      },
      {
        key: 'secret',
        label: { vi: 'App Secret', en: 'App Secret' },
        in: 'query',
        type: 'string',
        required: true,
        satisfiedByConnection: true,
        help: { vi: 'Bỏ trống để dùng Secret của kết nối.', en: 'Leave empty to use the connection secret.' },
      },
    ],
  },
  {
    id: 'advertiser-info',
    group: 'Account',
    name: { vi: 'Thông tin advertiser', en: 'Advertiser info' },
    method: 'GET',
    path: '/advertiser/info/',
    resultPath: 'data.list',
    idField: 'advertiser_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1739593083610113',
    params: [
      {
        key: 'advertiser_ids',
        label: { vi: 'Danh sách Advertiser ID', en: 'Advertiser IDs' },
        in: 'query',
        type: 'string[]',
        required: true,
        help: { vi: 'Mỗi ID một dòng, hoặc phân tách bằng dấu phẩy.', en: 'One ID per line, or comma separated.' },
      },
      {
        key: 'fields',
        label: { vi: 'Trường trả về', en: 'Fields' },
        in: 'query',
        type: 'string[]',
        // /advertiser/info/ names it `name`, not `advertiser_name` — the
        // latter is rejected outright with error 40002.
        defaultValue: ['advertiser_id', 'name', 'status', 'currency', 'timezone', 'balance'],
        help: {
          vi: 'Để trống để lấy tất cả, trừ company_name_editable, can_use_custom_identity, ads_only_mode (phải yêu cầu riêng).',
          en: 'Empty returns everything except company_name_editable, can_use_custom_identity and ads_only_mode, which must be asked for.',
        },
      },
    ],
  },
  {
    id: 'campaign-get',
    group: 'Campaign',
    name: { vi: 'Danh sách chiến dịch', en: 'List campaigns' },
    method: 'GET',
    path: '/campaign/get/',
    resultPath: 'data.list',
    idField: 'campaign_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1739315828649986',
    pagination: pageContract(1000),
    params: [
      advertiserId(),
      ...fieldSelection('campaign_id\ncampaign_name\noperation_status\nbudget'),
      entityFiltering(
        '{"primary_status":"STATUS_DELIVERY_OK"}',
        'campaign_ids, campaign_name, primary_status, secondary_status, objective_type, buying_types, creation_filter_start_time/end_time',
      ),
      ...page(1000),
    ],
  },
  {
    id: 'adgroup-get',
    group: 'Campaign',
    name: { vi: 'Danh sách nhóm quảng cáo', en: 'List ad groups' },
    method: 'GET',
    path: '/adgroup/get/',
    resultPath: 'data.list',
    idField: 'adgroup_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1739314558673922',
    pagination: pageContract(1000),
    params: [
      advertiserId(),
      ...fieldSelection('adgroup_id\nadgroup_name\ncampaign_id\nbudget'),
      entityFiltering(
        '{"campaign_ids":["123456"]}',
        'campaign_ids, adgroup_ids, adgroup_name, primary_status, secondary_status, optimization_goal, promotion_type',
      ),
      ...page(1000),
    ],
  },
  {
    id: 'ad-get',
    group: 'Campaign',
    name: { vi: 'Danh sách quảng cáo', en: 'List ads' },
    method: 'GET',
    path: '/ad/get/',
    resultPath: 'data.list',
    idField: 'ad_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1735735588640770',
    pagination: pageContract(1000),
    params: [
      advertiserId(),
      ...fieldSelection('ad_id\nad_name\nadgroup_id\ncampaign_id'),
      entityFiltering(
        '{"adgroup_ids":["123456"]}',
        'campaign_ids, adgroup_ids, ad_ids, ad_name, primary_status, secondary_status',
      ),
      ...page(1000),
    ],
  },
  {
    id: 'gmv-max-campaign-get',
    group: 'GMV Max',
    name: { vi: 'Danh sách chiến dịch GMV Max', en: 'List GMV Max campaigns' },
    description: {
      vi: 'Chiến dịch GMV Max không nằm trong /campaign/get/. Để trống Advertiser ID để lấy tất cả chiến dịch của mọi tài khoản trong kết nối, cả Product lẫn LIVE, gộp một danh sách (mỗi dòng có thêm gmv_max_promotion_type; data.summary đếm theo tài khoản, data.failures ghi tài khoản bị từ chối).',
      en: 'GMV Max campaigns are not returned by /campaign/get/. Leave Advertiser ID empty to gather every campaign across all of the connection\'s accounts, Product and LIVE, into one list (each row gains gmv_max_promotion_type; data.summary counts per account, data.failures lists refusals).',
    },
    method: 'GET',
    path: '/gmv_max/campaign/get/',
    resultPath: 'data.list',
    idField: 'campaign_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1826463372290177',
    pagination: pageContract(100),
    params: [
      // A plain input on purpose, not the advertiser picker: blank here means
      // "all advertisers", which neither the picker nor the default fills.
      {
        key: 'advertiser_id',
        label: { vi: 'Advertiser ID', en: 'Advertiser ID' },
        in: 'query',
        type: 'string',
        help: {
          vi: 'Để trống: lấy tất cả chiến dịch GMV Max của mọi tài khoản trong kết nối. Nhập một ID để chỉ lấy tài khoản đó.',
          en: 'Empty: every GMV Max campaign across all of the connection\'s accounts. Enter one ID for just that account.',
        },
      },
      {
        key: 'filtering',
        label: { vi: 'Bộ lọc (JSON)', en: 'Filtering (JSON)' },
        in: 'query',
        type: 'json',
        // TikTok requires gmv_max_promotion_types on every call; when it is
        // left out here, gmv-max.ts asks for both types and merges them.
        placeholder: '{"gmv_max_promotion_types":["PRODUCT_GMV_MAX"],"primary_status":"STATUS_DELIVERY_OK"}',
        help: {
          vi: 'Để trống: cả PRODUCT_GMV_MAX và LIVE_GMV_MAX. Khi có gmv_max_promotion_types thì chỉ lấy loại đó. Tuỳ chọn khác: store_ids (≤ 10), campaign_ids (≤ 100), campaign_name, primary_status (STATUS_DELIVERY_OK, STATUS_DISABLE, STATUS_DELETE), creation_filter_start_time / creation_filter_end_time dạng "YYYY-MM-DD HH:MM:SS" (UTC). Khoá không hợp lệ bị bỏ qua mà không báo lỗi.',
          en: 'Empty: both PRODUCT_GMV_MAX and LIVE_GMV_MAX. With gmv_max_promotion_types set, just those. Other options: store_ids (≤ 10), campaign_ids (≤ 100), campaign_name, primary_status (STATUS_DELIVERY_OK, STATUS_DISABLE, STATUS_DELETE), creation_filter_start_time / creation_filter_end_time as "YYYY-MM-DD HH:MM:SS" (UTC). Unknown keys are ignored silently.',
        },
      },
      {
        key: 'fields',
        label: { vi: 'Trường trả về', en: 'Fields' },
        in: 'query',
        type: 'string[]',
        placeholder: 'campaign_id\ncampaign_name\noperation_status\nsecondary_status',
        help: {
          vi: 'Để trống để lấy cả 9 trường: advertiser_id, campaign_id, campaign_name, create_time, modify_time, objective_type, operation_status, secondary_status, roi_protection_compensation_status.',
          en: 'Empty returns all nine: advertiser_id, campaign_id, campaign_name, create_time, modify_time, objective_type, operation_status, secondary_status, roi_protection_compensation_status.',
        },
      },
      // Honoured for a single account and type; a gathered list walks every
      // page itself and returns them all at once.
      ...page(100, 20),
    ],
  },
  {
    id: 'report-integrated',
    group: 'Report',
    name: { vi: 'Báo cáo hiệu quả (Integrated)', en: 'Integrated report' },
    description: {
      vi: 'Nguồn số liệu chính: chi phí, hiển thị, click, chuyển đổi. Trả tối đa 20.000 quảng cáo; nhiều hơn thì lọc theo campaign_ids/adgroup_ids/ad_ids (≤ 100 ID mỗi lần).',
      en: 'The main metrics source: spend, impressions, clicks and conversions. Covers up to 20,000 ads; beyond that, filter by campaign_ids/adgroup_ids/ad_ids (≤ 100 IDs per call).',
    },
    method: 'GET',
    path: '/report/integrated/get/',
    resultPath: 'data.list',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1740302848100353',
    pagination: pageContract(1000),
    params: [
      {
        ...advertiserId(false),
        help: {
          vi: 'Dùng cho BASIC/AUDIENCE. Để trống sẽ dùng Advertiser ID mặc định của kết nối; báo cáo BC dùng bc_id thay thế.',
          en: 'Used by BASIC/AUDIENCE. Empty uses the connection default; a BC report uses bc_id instead.',
        },
      },
      {
        key: 'report_type',
        label: { vi: 'Loại báo cáo', en: 'Report type' },
        in: 'query',
        type: 'enum',
        required: true,
        defaultValue: 'BASIC',
        options: options('BASIC', 'AUDIENCE', 'PLAYABLE_MATERIAL', 'CATALOG', 'BC', 'TT_SHOP'),
        help: {
          vi: 'CATALOG là báo cáo DSA. TT_SHOP sắp ngừng — báo cáo GMV Max dùng /gmv_max/report/get/.',
          en: 'CATALOG is the DSA report. TT_SHOP is being retired — GMV Max reports use /gmv_max/report/get/.',
        },
      },
      {
        key: 'service_type',
        label: { vi: 'Loại dịch vụ', en: 'Service type' },
        in: 'query',
        type: 'enum',
        options: options('AUCTION', 'RESERVATION'),
        help: {
          vi: 'Mặc định AUCTION. RESERVATION đã ngừng. Không dùng với báo cáo BC.',
          en: 'Defaults to AUCTION. RESERVATION is deprecated. Not supported for BC reports.',
        },
      },
      {
        key: 'data_level',
        label: { vi: 'Cấp dữ liệu', en: 'Data level' },
        in: 'query',
        type: 'enum',
        defaultValue: 'AUCTION_CAMPAIGN',
        options: options(
          'AUCTION_ADVERTISER',
          'AUCTION_CAMPAIGN',
          'AUCTION_ADGROUP',
          'AUCTION_AD',
          'RESERVATION_ADVERTISER',
          'RESERVATION_CAMPAIGN',
          'RESERVATION_ADGROUP',
          'RESERVATION_AD',
        ),
        help: {
          vi: 'Bắt buộc với BASIC, AUDIENCE và CATALOG; bỏ trống với báo cáo BC.',
          en: 'Required for BASIC, AUDIENCE and CATALOG; leave empty for a BC report.',
        },
      },
      {
        key: 'dimensions',
        label: { vi: 'Chiều dữ liệu', en: 'Dimensions' },
        in: 'query',
        type: 'string[]',
        required: true,
        defaultValue: ['campaign_id', 'stat_time_day'],
        help: {
          vi: 'Thêm stat_time_day để có số liệu theo ngày. Mỗi loại báo cáo nhận một bộ chiều khác nhau.',
          en: 'Include stat_time_day to break the report down by day. Each report type accepts its own set.',
        },
      },
      {
        key: 'metrics',
        label: { vi: 'Chỉ số', en: 'Metrics' },
        in: 'query',
        type: 'string[]',
        defaultValue: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'conversion', 'cost_per_conversion'],
      },
      /*
       * Kept required although TikTok only needs them without query_lifetime:
       * with it on, the dates are ignored rather than rejected, so asking for
       * them costs nothing and keeps the form and the permission probe
       * producing a legal request in the common case.
       */
      {
        key: 'start_date',
        label: { vi: 'Từ ngày', en: 'Start date' },
        in: 'query',
        type: 'date',
        required: true,
        placeholder: 'YYYY-MM-DD',
        help: {
          vi: 'Theo múi giờ tài khoản. Khoảng tối đa: 30 ngày nếu có stat_time_day, 1 ngày nếu có stat_time_hour, còn lại 365 ngày.',
          en: 'Ad account time zone. Longest span: 30 days with stat_time_day, 1 day with stat_time_hour, otherwise 365 days.',
        },
      },
      {
        key: 'end_date',
        label: { vi: 'Đến ngày', en: 'End date' },
        in: 'query',
        type: 'date',
        required: true,
        placeholder: 'YYYY-MM-DD',
        help: {
          vi: 'Tính cả ngày này. Bị bỏ qua khi bật query_lifetime.',
          en: 'Inclusive. Ignored when query_lifetime is on.',
        },
      },
      {
        key: 'query_lifetime',
        label: { vi: 'Số liệu trọn đời', en: 'Lifetime metrics' },
        in: 'query',
        type: 'boolean',
        help: {
          vi: 'Chỉ cho BASIC và PLAYABLE_MATERIAL. Bật thì bỏ qua start_date/end_date.',
          en: 'BASIC and PLAYABLE_MATERIAL only. When on, start_date/end_date are ignored.',
        },
      },
      {
        key: 'enable_total_metrics',
        label: { vi: 'Kèm tổng cộng', en: 'Include totals' },
        in: 'query',
        type: 'boolean',
        help: {
          vi: 'Trả thêm data.total_metrics — tổng của mọi trang.',
          en: 'Adds data.total_metrics, summed across every page.',
        },
      },
      {
        key: 'order_field',
        label: { vi: 'Sắp xếp theo', en: 'Order by' },
        in: 'query',
        type: 'string',
        placeholder: 'spend',
        help: { vi: 'Một chỉ số (không phải chỉ số thuộc tính).', en: 'Any metric except attribute metrics.' },
      },
      {
        key: 'order_type',
        label: { vi: 'Chiều sắp xếp', en: 'Order' },
        in: 'query',
        type: 'enum',
        options: options('DESC', 'ASC'),
        help: { vi: 'Mặc định DESC.', en: 'Defaults to DESC.' },
      },
      {
        key: 'filtering',
        label: { vi: 'Bộ lọc (JSON)', en: 'Filtering (JSON)' },
        in: 'query',
        type: 'json',
        placeholder: '[{"field_name":"campaign_ids","filter_type":"IN","filter_value":"[\\"123456\\"]"}]',
        help: {
          vi: 'Một mảng điều kiện. filter_type nhận: IN, NOT_IN, MATCH, CONTAIN_ANY_OF, GREATER_THAN, GREATER_EQUAL, LOWER_THAN, LOWER_EQUAL, BETWEEN, RANGE. filter_value là chuỗi JSON.',
          en: 'An array of conditions. filter_type accepts: IN, NOT_IN, MATCH, CONTAIN_ANY_OF, GREATER_THAN, GREATER_EQUAL, LOWER_THAN, LOWER_EQUAL, BETWEEN, RANGE. filter_value is a JSON string.',
        },
      },
      {
        key: 'advertiser_ids',
        label: { vi: 'Nhiều Advertiser ID', en: 'Advertiser IDs' },
        in: 'query',
        type: 'string[]',
        help: {
          vi: 'Báo cáo gộp nhiều tài khoản (BASIC/AUDIENCE). Khi có, advertiser_id bị bỏ qua.',
          en: 'A multi-account report (BASIC/AUDIENCE). When set, advertiser_id is ignored.',
        },
      },
      {
        key: 'multi_adv_report_in_utc_time',
        label: { vi: 'Nhiều tài khoản theo UTC', en: 'Multi-account in UTC' },
        in: 'query',
        type: 'boolean',
        help: {
          vi: 'Chỉ khi dùng advertiser_ids: bật để trả số liệu theo UTC thay vì múi giờ từng tài khoản.',
          en: 'With advertiser_ids only: report in UTC rather than each account\'s time zone.',
        },
      },
      {
        key: 'bc_id',
        label: { vi: 'Business Center ID', en: 'Business Center ID' },
        in: 'query',
        type: 'string',
        help: {
          vi: 'Dùng cho báo cáo BC, PLAYABLE_MATERIAL, CATALOG thay cho advertiser_id.',
          en: 'Used instead of advertiser_id for BC, PLAYABLE_MATERIAL and CATALOG reports.',
        },
      },
      {
        key: 'query_mode',
        label: { vi: 'Chế độ truy vấn', en: 'Query mode' },
        in: 'query',
        type: 'enum',
        options: options('REGULAR', 'CHUNK'),
        help: {
          vi: 'Sắp ngừng. CHUNK trả nhanh hơn nhưng phân trang khác. Mặc định REGULAR.',
          en: 'Being retired. CHUNK is faster but pages differently. Defaults to REGULAR.',
        },
      },
      ...page(1000, 50),
    ],
  },
  {
    id: 'bc-get',
    group: 'Business Center',
    name: { vi: 'Danh sách Business Center', en: 'List Business Centers' },
    method: 'GET',
    path: '/bc/get/',
    resultPath: 'data.list',
    // Each row is { bc_info, user_role, ext_user_role }: the id is nested.
    idField: 'bc_info.bc_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1737115687501826',
    params: [
      {
        key: 'bc_id',
        label: { vi: 'Business Center ID', en: 'Business Center ID' },
        in: 'query',
        type: 'string',
        help: { vi: 'Để trống để lấy tất cả BC.', en: 'Leave empty for every Business Center.' },
      },
      {
        key: 'scene',
        label: { vi: 'Phạm vi', en: 'Scene' },
        in: 'query',
        type: 'enum',
        options: options('SINGLE_ACCOUNT', 'TIERED_ACCOUNT'),
        help: {
          vi: 'Mặc định SINGLE_ACCOUNT. TIERED_ACCOUNT bắt buộc có bc_id.',
          en: 'Defaults to SINGLE_ACCOUNT. TIERED_ACCOUNT requires bc_id.',
        },
      },
      {
        key: 'filtering',
        label: { vi: 'Bộ lọc (JSON)', en: 'Filtering (JSON)' },
        in: 'query',
        type: 'json',
        placeholder: '{"keyword":"Kascom"}',
        help: { vi: 'Khoá: keyword, keyword_type, relation_type.', en: 'Keys: keyword, keyword_type, relation_type.' },
      },
      ...page(50, 10),
    ],
  },
  {
    id: 'pixel-list',
    group: 'Tracking',
    name: { vi: 'Danh sách Pixel', en: 'List pixels' },
    method: 'GET',
    path: '/pixel/list/',
    resultPath: 'data.pixels',
    idField: 'pixel_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1740858697598978',
    params: [
      advertiserId(),
      { key: 'pixel_id', label: { vi: 'Pixel ID', en: 'Pixel ID' }, in: 'query', type: 'string' },
      { key: 'code', label: { vi: 'Pixel Code', en: 'Pixel code' }, in: 'query', type: 'string' },
      {
        key: 'name',
        label: { vi: 'Tên pixel', en: 'Pixel name' },
        in: 'query',
        type: 'string',
        help: { vi: 'Tìm gần đúng.', en: 'Fuzzy match.' },
      },
      {
        key: 'order_by',
        label: { vi: 'Sắp xếp', en: 'Order by' },
        in: 'query',
        type: 'enum',
        options: options('EARLIEST_CREATE', 'LATEST_CREATE'),
        help: { vi: 'Mặc định EARLIEST_CREATE.', en: 'Defaults to EARLIEST_CREATE.' },
      },
      {
        key: 'filtering',
        label: { vi: 'Bộ lọc (JSON)', en: 'Filtering (JSON)' },
        in: 'query',
        type: 'json',
        placeholder: '{"available_for_catalog_only":true}',
      },
      ...page(20),
    ],
  },
  {
    id: 'identity-get',
    group: 'Tracking',
    name: { vi: 'Danh sách Identity', en: 'List identities' },
    description: {
      vi: 'Khi chọn identity_type, TikTok trả kèm cursor/has_more thay cho page_info.',
      en: 'With identity_type set, TikTok pages by cursor/has_more instead of page_info.',
    },
    method: 'GET',
    path: '/identity/get/',
    resultPath: 'data.identity_list',
    idField: 'identity_id',
    docsUrl: 'https://business-api.tiktok.com/portal/docs?id=1740218420781057',
    params: [
      advertiserId(),
      {
        key: 'identity_type',
        label: { vi: 'Loại identity', en: 'Identity type' },
        in: 'query',
        type: 'enum',
        options: options('CUSTOMIZED_USER', 'AUTH_CODE', 'TT_USER', 'BC_AUTH_TT'),
        help: { vi: 'Để trống để lấy tất cả loại.', en: 'Leave empty for every type.' },
      },
      {
        key: 'identity_authorized_bc_id',
        label: { vi: 'BC ID của identity', en: 'Identity BC ID' },
        in: 'query',
        type: 'string',
        help: { vi: 'Bắt buộc khi identity_type = BC_AUTH_TT.', en: 'Required when identity_type is BC_AUTH_TT.' },
      },
      {
        key: 'filtering',
        label: { vi: 'Bộ lọc (JSON)', en: 'Filtering (JSON)' },
        in: 'query',
        type: 'json',
        help: {
          vi: 'Chỉ có tác dụng khi identity_type = CUSTOMIZED_USER hoặc để trống.',
          en: 'Only applies when identity_type is CUSTOMIZED_USER or empty.',
        },
      },
      ...page(100),
    ],
  },
]
