import type { EndpointSpec, ParamSpec } from '@/core/plugins/types'
import { options, page, pageContract } from './endpoints'
import { advertiserId } from './param-kit'

/**
 * GMV Max — every endpoint in the TikTok reference section, with its
 * documented parameters.
 *
 * Read from the portal's own doc content (the same pages as
 * business-api.tiktok.com/portal/docs), then checked against live advertisers
 * that run GMV Max. Where the live API and the page disagree, the live API
 * wins and the entry says so: /gmv_max/video/get/ also accepts ORDER_RATE,
 * /gmv_max/occupied_custom_shop_ads/list/ also accepts SHOP, and
 * /video_anchors/ takes `item_ids` although its doc example sends
 * `item_id_list` (rejected with 40002).
 *
 * Two POST endpoints only read (customized posts, video anchors); they are
 * not `mutating`, so the Hub does not ask for confirmation. The writes are
 * declared from the docs alone and marked `unverified` — they were never
 * called, deliberately. Their body is one JSON object pre-filled with the
 * doc's own example shape.
 *
 * The campaign list itself (/gmv_max/campaign/get/, with its "all
 * advertisers" sweep) stays in endpoints.ts beside the other listings.
 */

const docs = (id: string) => `https://business-api.tiktok.com/portal/docs?id=${id}`

function text(key: string, vi: string, en: string, extra: Partial<ParamSpec> = {}): ParamSpec {
  return { key, label: { vi, en }, in: 'query', type: 'string', ...extra }
}

function list(key: string, vi: string, en: string, extra: Partial<ParamSpec> = {}): ParamSpec {
  return { key, label: { vi, en }, in: 'query', type: 'string[]', ...extra }
}

function choice(key: string, vi: string, en: string, values: string[], extra: Partial<ParamSpec> = {}): ParamSpec {
  return { key, label: { vi, en }, in: 'query', type: 'enum', options: options(...values), ...extra }
}

function flag(key: string, vi: string, en: string, extra: Partial<ParamSpec> = {}): ParamSpec {
  return { key, label: { vi, en }, in: 'query', type: 'boolean', ...extra }
}

function json(key: string, vi: string, en: string, extra: Partial<ParamSpec> = {}): ParamSpec {
  return { key, label: { vi, en }, in: 'query', type: 'json', ...extra }
}

/** POST endpoints read their params from the body; buildRequest merges them there. */
const inBody = (spec: ParamSpec): ParamSpec => ({ ...spec, in: 'body' })

const storeId = text('store_id', 'TikTok Shop ID', 'TikTok Shop ID', {
  required: true,
  help: {
    vi: 'Lấy store_id từ "Cửa hàng dùng cho GMV Max" (/gmv_max/store/list/).',
    en: 'store_id from "TikTok Shops for GMV Max" (/gmv_max/store/list/).',
  },
})

const storeBc = text('store_authorized_bc_id', 'BC được uỷ quyền shop', 'Store authorized BC ID', {
  required: true,
  help: {
    vi: 'store_authorized_bc_id của shop, trả về cùng store_id ở /gmv_max/store/list/.',
    en: 'The shop\'s store_authorized_bc_id, returned with store_id by /gmv_max/store/list/.',
  },
})

const campaignId = text('campaign_id', 'Campaign ID', 'Campaign ID', {
  required: true,
  help: { vi: 'Lấy từ "Danh sách chiến dịch GMV Max".', en: 'From "List GMV Max campaigns".' },
})

/** A write must name its account: silently falling back to the default one could change the wrong ad account. */
const writeAdvertiser = text('advertiser_id', 'Advertiser ID', 'Advertiser ID', {
  required: true,
  help: { vi: 'Bắt buộc nhập — không tự điền tài khoản mặc định cho thao tác ghi.', en: 'Required — writes never fall back to the default account.' },
})

function writeBody(template: Record<string, unknown>, vi: string, en: string): ParamSpec {
  return {
    key: 'body',
    label: { vi: 'Body (JSON)', en: 'Body (JSON)' },
    in: 'body',
    type: 'json',
    required: true,
    defaultValue: template,
    help: { vi, en },
  }
}

const IDENTITY_TYPES = 'TT_USER, BC_AUTH_TT (kèm identity_authorized_bc_id), TTS_TT (kèm store_id), AUTH_CODE'
const IDENTITY_TYPES_EN = 'TT_USER, BC_AUTH_TT (with identity_authorized_bc_id), TTS_TT (with store_id), AUTH_CODE'

const identityFilter = json('identity_list', 'Lọc theo identity (JSON)', 'Identity filter (JSON)', {
  placeholder: '[{"identity_id":"...","identity_type":"TT_USER"}]',
  help: { vi: `Mảng identity. identity_type: ${IDENTITY_TYPES}.`, en: `An array of identities. identity_type: ${IDENTITY_TYPES_EN}.` },
})

const POST_SORT = ['GMV', 'POST_TIME', 'VIDEO_VIEWS', 'VIDEO_LIKES', 'CLICK_THROUGH_RATE', 'PRODUCT_CLICKS']

/* ---------------------------------------------------------------- Campaign --- */

const campaign: EndpointSpec[] = [
  {
    id: 'gmv-max-campaign-info',
    group: 'GMV Max',
    name: { vi: 'Chi tiết chiến dịch GMV Max', en: 'GMV Max campaign details' },
    description: {
      vi: 'Toàn bộ cấu hình: ngân sách, ROI mục tiêu, lịch chạy, sản phẩm, identity, promotion days, auto budget.',
      en: 'Full setup: budget, ROI target, schedule, products, identities, promotion days, auto budget.',
    },
    method: 'GET',
    path: '/campaign/gmv_max/info/',
    docsUrl: docs('1822000968821762'),
    params: [advertiserId(), campaignId],
  },
  {
    id: 'gmv-max-bid-recommend',
    group: 'GMV Max',
    name: { vi: 'Gợi ý ROI mục tiêu và ngân sách', en: 'Recommended ROI target and budget' },
    method: 'GET',
    path: '/gmv_max/bid/recommend/',
    docsUrl: docs('1822001024720897'),
    params: [
      advertiserId(),
      storeId,
      choice('shopping_ads_type', 'Loại chiến dịch', 'Campaign type', ['PRODUCT', 'LIVE'], {
        required: true,
        defaultValue: 'PRODUCT',
      }),
      choice('optimization_goal', 'Mục tiêu tối ưu', 'Optimization goal', ['VALUE'], {
        required: true,
        defaultValue: 'VALUE',
        help: { vi: 'VALUE: tổng doanh thu.', en: 'VALUE: gross revenue.' },
      }),
      list('item_group_ids', 'SPU ID', 'SPU IDs', {
        help: { vi: 'Chỉ cho PRODUCT: gợi ý cho các sản phẩm cụ thể.', en: 'PRODUCT only: recommend for specific products.' },
      }),
      text('identity_id', 'Identity LIVE', 'LIVE identity', {
        help: { vi: 'Bắt buộc khi shopping_ads_type = LIVE.', en: 'Required when shopping_ads_type is LIVE.' },
      }),
    ],
  },
  {
    id: 'gmv-max-session-list',
    group: 'GMV Max',
    name: { vi: 'Session max delivery / creative boost của chiến dịch', en: 'Max delivery / creative boost sessions in a campaign' },
    method: 'GET',
    path: '/campaign/gmv_max/session/list/',
    resultPath: 'data.session_list',
    docsUrl: docs('1835246996436162'),
    params: [advertiserId(), { ...campaignId, help: { vi: 'Chiến dịch Product GMV Max.', en: 'A Product GMV Max campaign.' } }],
  },
  {
    id: 'gmv-max-session-get',
    group: 'GMV Max',
    name: { vi: 'Chi tiết session max delivery / creative boost', en: 'Max delivery / creative boost session details' },
    method: 'GET',
    path: '/campaign/gmv_max/session/get/',
    resultPath: 'data.session_list',
    docsUrl: docs('1835247031331842'),
    params: [
      advertiserId(),
      list('session_ids', 'Session ID', 'Session IDs', {
        required: true,
        help: { vi: 'Tối đa 20. Lấy từ danh sách session của chiến dịch.', en: 'Up to 20. From the campaign\'s session list.' },
      }),
    ],
  },
]

const campaignWrites: EndpointSpec[] = [
  {
    id: 'gmv-max-campaign-create',
    group: 'GMV Max',
    name: { vi: 'Tạo chiến dịch GMV Max', en: 'Create a GMV Max campaign' },
    method: 'POST',
    path: '/campaign/gmv_max/create/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1822000988713089'),
    params: [
      writeAdvertiser,
      writeBody(
        {
          request_id: 'REPLACE_WITH_A_UNIQUE_ID',
          campaign_name: '',
          store_id: '',
          store_authorized_bc_id: '',
          shopping_ads_type: 'PRODUCT',
          product_specific_type: 'ALL',
          optimization_goal: 'VALUE',
          deep_bid_type: 'VO_MIN_ROAS',
          roas_bid: 3,
          budget: 100,
          schedule_type: 'SCHEDULE_FROM_NOW',
          schedule_start_time: 'YYYY-MM-DD HH:MM:SS',
          product_video_specific_type: 'AUTO_SELECTION',
          identity_list: [{ identity_id: '', identity_type: 'TT_USER' }],
        },
        'Bắt buộc: request_id (duy nhất, chống gửi trùng), campaign_name, store_id, store_authorized_bc_id, shopping_ads_type (PRODUCT | LIVE), optimization_goal (VALUE), deep_bid_type (VO_MIN_ROAS) + roas_bid, budget, schedule_type (SCHEDULE_FROM_NOW | SCHEDULE_START_END, kèm schedule_end_time) + schedule_start_time (UTC). PRODUCT: product_specific_type (ALL | CUSTOMIZED_PRODUCTS + item_group_ids), product_video_specific_type (AUTO_SELECTION + identity_list | CUSTOM_SELECTION + item_list). LIVE: identity_list. Tuỳ chọn: promotion_days, auto_budget, affiliate_posts_enabled, custom_anchor_video_list.',
        'Required: request_id (unique, for idempotency), campaign_name, store_id, store_authorized_bc_id, shopping_ads_type (PRODUCT | LIVE), optimization_goal (VALUE), deep_bid_type (VO_MIN_ROAS) + roas_bid, budget, schedule_type (SCHEDULE_FROM_NOW | SCHEDULE_START_END with schedule_end_time) + schedule_start_time (UTC). PRODUCT: product_specific_type (ALL | CUSTOMIZED_PRODUCTS + item_group_ids), product_video_specific_type (AUTO_SELECTION + identity_list | CUSTOM_SELECTION + item_list). LIVE: identity_list. Optional: promotion_days, auto_budget, affiliate_posts_enabled, custom_anchor_video_list.',
      ),
    ],
  },
  {
    id: 'gmv-max-campaign-update',
    group: 'GMV Max',
    name: { vi: 'Cập nhật chiến dịch GMV Max', en: 'Update a GMV Max campaign' },
    method: 'POST',
    path: '/campaign/gmv_max/update/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1822001009002497'),
    params: [
      writeAdvertiser,
      writeBody(
        { campaign_id: '', campaign_name: '' },
        'Bắt buộc: campaign_id. Chỉ gửi trường cần đổi: campaign_name, roas_bid, budget, schedule_type / schedule_end_time, item_group_ids, promotion_days, auto_budget, auto_budget_enabled, affiliate_posts_enabled, item_list, custom_anchor_video_list.',
        'Required: campaign_id. Send only what changes: campaign_name, roas_bid, budget, schedule_type / schedule_end_time, item_group_ids, promotion_days, auto_budget, auto_budget_enabled, affiliate_posts_enabled, item_list, custom_anchor_video_list.',
      ),
    ],
  },
  {
    id: 'gmv-max-creative-update',
    group: 'GMV Max',
    name: { vi: 'Gỡ hoặc thêm lại creative', en: 'Remove or add back creatives' },
    method: 'POST',
    path: '/campaign/gmv_max/creative/update/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1861260625563202'),
    params: [
      writeAdvertiser,
      writeBody(
        { campaign_id: '', action: 'REMOVE', item_list: [{ item_id: '', spu_id_list: [''] }] },
        'Bắt buộc: campaign_id (chiến dịch đang chạy), action (REMOVE | ADD), item_list (tối đa 400; spu_id_list bắt buộc với Product GMV Max). Chờ khoảng 20 phút rồi kiểm tra lại bằng báo cáo GMV Max.',
        'Required: campaign_id (an active campaign), action (REMOVE | ADD), item_list (up to 400; spu_id_list required for Product GMV Max). Allow about 20 minutes, then check with the GMV Max report.',
      ),
    ],
  },
  {
    id: 'gmv-max-session-create',
    group: 'GMV Max',
    name: { vi: 'Tạo session max delivery / creative boost', en: 'Create a max delivery / creative boost session' },
    method: 'POST',
    path: '/campaign/gmv_max/session/create/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1835246967275522'),
    params: [
      writeAdvertiser,
      writeBody(
        {
          campaign_id: '',
          store_id: '',
          session: {
            bid_type: 'NO_BID',
            product_list: [{ spu_id: '' }],
            budget: 50,
            schedule_type: 'SCHEDULE_FROM_NOW',
            schedule_start_time: 'YYYY-MM-DD HH:MM:SS',
          },
        },
        'Bắt buộc: campaign_id (Product GMV Max), store_id, session. session.bid_type: NO_BID (max delivery) hoặc CREATIVE_NO_BID (creative boost, kèm item_id). session.product_list tối đa 1, session.budget là ngân sách ngày riêng. schedule_type SCHEDULE_START_END cần schedule_end_time.',
        'Required: campaign_id (Product GMV Max), store_id, session. session.bid_type: NO_BID (max delivery) or CREATIVE_NO_BID (creative boost, with item_id). session.product_list holds 1 item; session.budget is a separate daily budget. schedule_type SCHEDULE_START_END needs schedule_end_time.',
      ),
    ],
  },
  {
    id: 'gmv-max-session-update',
    group: 'GMV Max',
    name: { vi: 'Cập nhật session max delivery / creative boost', en: 'Update a max delivery / creative boost session' },
    method: 'POST',
    path: '/campaign/gmv_max/session/update/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1835247009119233'),
    params: [
      writeAdvertiser,
      writeBody(
        { campaign_id: '', store_id: '', session_id: '', session: { budget: 50 } },
        'Bắt buộc: campaign_id, store_id, session_id, session. Trong session chỉ gửi trường cần đổi: budget, schedule_type, schedule_start_time (max delivery), schedule_end_time.',
        'Required: campaign_id, store_id, session_id, session. Inside session send only what changes: budget, schedule_type, schedule_start_time (max delivery), schedule_end_time.',
      ),
    ],
  },
  {
    id: 'gmv-max-session-delete',
    group: 'GMV Max',
    name: { vi: 'Xoá session max delivery / creative boost', en: 'Delete a max delivery / creative boost session' },
    method: 'POST',
    path: '/campaign/gmv_max/session/delete/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1835246983475217'),
    params: [writeAdvertiser, writeBody({ session_id: '' }, 'Bắt buộc: session_id.', 'Required: session_id.')],
  },
]

/* ------------------------------------------------------ Shop and products --- */

const shop: EndpointSpec[] = [
  {
    id: 'gmv-max-store-list',
    group: 'GMV Max · Shop',
    name: { vi: 'Cửa hàng dùng cho GMV Max', en: 'TikTok Shops for GMV Max' },
    description: {
      vi: 'Nguồn của store_id và store_authorized_bc_id mà các endpoint GMV Max khác cần. Chỉ dùng shop có is_gmv_max_available = true.',
      en: 'Source of the store_id and store_authorized_bc_id the other GMV Max endpoints need. Use shops with is_gmv_max_available = true.',
    },
    method: 'GET',
    path: '/gmv_max/store/list/',
    resultPath: 'data.store_list',
    idField: 'store_id',
    docsUrl: docs('1822001044479041'),
    params: [advertiserId()],
  },
  {
    id: 'store-product-get',
    group: 'GMV Max · Shop',
    name: { vi: 'Sản phẩm trong TikTok Shop', en: 'Products within a TikTok Shop' },
    method: 'GET',
    path: '/store/product/get/',
    resultPath: 'data.store_products',
    idField: 'item_group_id',
    pagination: pageContract(100),
    docsUrl: docs('1793482248880130'),
    params: [
      text('bc_id', 'Business Center ID', 'Business Center ID', {
        required: true,
        help: { vi: 'Dùng store_authorized_bc_id của shop.', en: 'Use the shop\'s store_authorized_bc_id.' },
      }),
      storeId,
      json('filtering', 'Bộ lọc (JSON)', 'Filtering (JSON)', {
        placeholder: '{"ad_creation_eligible":"GMV_MAX"}',
        help: {
          vi: 'Khoá: item_group_ids (≤ 10), product_name, ad_creation_eligible (CUSTOM_SHOP_ADS | GMV_MAX — khi dùng phải nhập advertiser_id).',
          en: 'Keys: item_group_ids (≤ 10), product_name, ad_creation_eligible (CUSTOM_SHOP_ADS | GMV_MAX — requires advertiser_id).',
        },
      }),
      text('advertiser_id', 'Advertiser ID', 'Advertiser ID', {
        help: { vi: 'Chỉ cần khi lọc ad_creation_eligible.', en: 'Only needed with ad_creation_eligible.' },
      }),
      choice('sort_field', 'Sắp xếp theo', 'Sort by', ['min_price', 'historical_sales']),
      choice('sort_type', 'Chiều sắp xếp', 'Order', ['ASC', 'DESC']),
      ...page(100),
    ],
  },
  {
    id: 'gmv-max-store-usage-check',
    group: 'GMV Max · Shop',
    name: { vi: 'Shop có dùng được cho Product GMV Max không', en: 'Shop availability for Product GMV Max' },
    description: {
      vi: 'Trả về is_running_custom_shop_ads và promote_all_products_allowed (được chọn "tất cả sản phẩm" hay không).',
      en: 'Returns is_running_custom_shop_ads and promote_all_products_allowed (whether "all products" can be promoted).',
    },
    method: 'GET',
    path: '/gmv_max/store/shop_ad_usage_check/',
    docsUrl: docs('1822001084174338'),
    params: [advertiserId(), storeId],
  },
  {
    id: 'gmv-max-exclusive-authorization-get',
    group: 'GMV Max · Shop',
    name: { vi: 'Trạng thái uỷ quyền độc quyền của tài khoản QC', en: 'Ad account exclusive authorization status' },
    method: 'GET',
    path: '/gmv_max/exclusive_authorization/get/',
    docsUrl: docs('1822001184635905'),
    params: [advertiserId(), storeId, storeBc],
  },
  {
    id: 'gmv-max-exclusive-authorization-create',
    group: 'GMV Max · Shop',
    name: { vi: 'Uỷ quyền độc quyền shop cho tài khoản QC', en: 'Grant exclusive authorization for a shop' },
    method: 'POST',
    path: '/gmv_max/exclusive_authorization/create/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1822001200356354'),
    params: [
      writeAdvertiser,
      writeBody(
        { store_id: '', store_authorized_bc_id: '' },
        'Bắt buộc: store_id, store_authorized_bc_id (BC sở hữu shop). advertiser_id ở trên là tài khoản được uỷ quyền độc quyền tạo GMV Max cho shop.',
        'Required: store_id, store_authorized_bc_id (the BC that owns the shop). The advertiser_id above is the account granted exclusive GMV Max rights for the shop.',
      ),
    ],
  },
]

/* ---------------------------------------------------- Identities and posts --- */

const posts: EndpointSpec[] = [
  {
    id: 'gmv-max-identity-get',
    group: 'GMV Max · Identities & posts',
    name: { vi: 'Identity dùng cho GMV Max', en: 'Identities for GMV Max' },
    method: 'GET',
    path: '/gmv_max/identity/get/',
    resultPath: 'data.identity_list',
    idField: 'identity_id',
    docsUrl: docs('1822001101474882'),
    params: [advertiserId(), storeId, storeBc],
  },
  {
    id: 'gmv-max-occupied-check',
    group: 'GMV Max · Identities & posts',
    name: { vi: 'Identity / sản phẩm đang bị Shopping Ads chiếm', en: 'Identity or product occupancy in Shopping Ads' },
    method: 'GET',
    path: '/gmv_max/occupied_custom_shop_ads/list/',
    resultPath: 'data.occupied_custom_shop_ads',
    docsUrl: docs('1822001136924674'),
    params: [
      advertiserId(),
      storeId,
      choice(
        'occupied_asset_type',
        'Loại tài sản',
        'Asset type',
        ['IDENTITY_TT_USER', 'IDENTITY_BC_AUTH_TT', 'IDENTITY_TTS_TT', 'SPU', 'SHOP'],
        {
          required: true,
          defaultValue: 'SPU',
          help: { vi: 'SHOP không có trong tài liệu nhưng API chấp nhận.', en: 'SHOP is not in the docs but the API accepts it.' },
        },
      ),
      list('asset_ids', 'Asset ID', 'Asset IDs', {
        required: true,
        help: { vi: 'Đúng 1 ID: identity ID hoặc SPU ID tuỳ loại.', en: 'Exactly one ID: an identity ID or SPU ID to match the type.' },
      }),
    ],
  },
  {
    id: 'gmv-max-video-get',
    group: 'GMV Max · Identities & posts',
    name: { vi: 'Bài đăng dùng cho Product GMV Max', en: 'Posts for a Product GMV Max campaign' },
    method: 'GET',
    path: '/gmv_max/video/get/',
    resultPath: 'data.item_list',
    docsUrl: docs('1822001168512129'),
    params: [
      advertiserId(),
      storeId,
      storeBc,
      list('spu_id_list', 'SPU ID', 'SPU IDs', {
        help: { vi: 'Bắt buộc 1 SPU khi custom_posts_eligible = true.', en: 'Exactly one SPU when custom_posts_eligible is true.' },
      }),
      flag('custom_posts_eligible', 'Video dùng được cho customized post', 'Eligible for customized posts'),
      choice('sort_field', 'Sắp xếp theo', 'Sort by', [...POST_SORT, 'ORDER_RATE'], {
        help: {
          vi: 'Mặc định GMV. Chỉ khi custom_posts_eligible = false. ORDER_RATE không có trong tài liệu nhưng API chấp nhận.',
          en: 'Defaults to GMV. Only with custom_posts_eligible false. ORDER_RATE is not in the docs but the API accepts it.',
        },
      }),
      choice('sort_type', 'Chiều sắp xếp', 'Order', ['ASC', 'DESC']),
      text('keyword', 'Từ khoá', 'Keyword', { help: { vi: 'Post ID hoặc caption.', en: 'Post ID or caption.' } }),
      flag('need_auth_code_video', 'Gồm video AUTH_CODE', 'Include AUTH_CODE posts'),
      identityFilter,
      ...page(50),
    ],
  },
  {
    id: 'gmv-max-customized-posts-get',
    group: 'GMV Max · Identities & posts',
    name: { vi: 'Danh sách customized TikTok posts', en: 'Customized TikTok posts' },
    description: {
      vi: 'POST nhưng chỉ đọc dữ liệu. Không truyền campaign_id: bài cấp shop; có campaign_id: bài cấp chiến dịch.',
      en: 'A POST that only reads. Without campaign_id: shop-level posts; with it: campaign-level posts.',
    },
    method: 'POST',
    path: '/gmv_max/creation/custom_anchor_video_list/get/',
    resultPath: 'data.item_list',
    docsUrl: docs('1866513156712449'),
    params: [
      advertiserId(),
      inBody(storeId),
      inBody(storeBc),
      inBody(choice('creative_source', 'Nguồn creative', 'Creative source', ['CUSTOMIZED'], { required: true, defaultValue: 'CUSTOMIZED' })),
      inBody(list('spu_id_list', 'SPU ID', 'SPU IDs')),
      inBody(text('campaign_id', 'Campaign ID', 'Campaign ID')),
      inBody(choice('sort_field', 'Sắp xếp theo', 'Sort by', POST_SORT, { help: { vi: 'Mặc định GMV.', en: 'Defaults to GMV.' } })),
      inBody(choice('sort_type', 'Chiều sắp xếp', 'Order', ['ASC', 'DESC'])),
      inBody(text('keyword', 'Từ khoá', 'Keyword', { help: { vi: 'Post ID hoặc caption.', en: 'Post ID or caption.' } })),
      inBody(flag('need_auth_code_video', 'Gồm video AUTH_CODE', 'Include AUTH_CODE posts')),
      inBody(identityFilter),
      ...page(50).map(inBody),
    ],
  },
  {
    id: 'gmv-max-video-anchors',
    group: 'GMV Max · Identities & posts',
    name: { vi: 'Liên kết sản phẩm của video trong customized posts', en: 'Product linkage of videos in customized posts' },
    description: {
      vi: 'POST nhưng chỉ đọc dữ liệu. Tham số là item_ids — ví dụ trong tài liệu ghi item_id_list là sai (TikTok từ chối).',
      en: 'A POST that only reads. The parameter is item_ids — the doc example\'s item_id_list is rejected.',
    },
    method: 'POST',
    path: '/gmv_max/creation/shop_video/video_anchors/',
    resultPath: 'data.video_list',
    docsUrl: docs('1866513161692161'),
    params: [
      advertiserId(),
      inBody(storeId),
      inBody(storeBc),
      inBody(list('item_ids', 'Video (item) ID', 'Video (item) IDs', { required: true })),
      inBody(
        text('campaign_id', 'Campaign ID', 'Campaign ID', {
          help: { vi: 'Bắt buộc nếu video dùng trong customized post cấp chiến dịch.', en: 'Required for videos used in campaign-level customized posts.' },
        }),
      ),
    ],
  },
  {
    id: 'gmv-max-custom-anchor-videos-legacy',
    group: 'GMV Max · Identities & posts',
    name: { vi: '(Sắp ngừng) Chi tiết video trong customized posts', en: '(To be deprecated) Videos in customized posts' },
    method: 'GET',
    path: '/gmv_max/custom_anchor_video_list/get/',
    unverified: true,
    docsUrl: docs('1830215925061633'),
    params: [
      advertiserId(),
      campaignId,
      text('campaign_custom_anchor_video_id', 'ID bộ customized posts', 'Customized post collection ID', { required: true }),
      json('custom_anchor_video_list', 'Danh sách video (JSON)', 'Videos (JSON)', {
        required: true,
        placeholder: '[{"item_id":"...","identity_info":{"identity_id":"...","identity_type":"TT_USER"}}]',
        help: { vi: 'Tối đa 20.', en: 'Up to 20.' },
      }),
    ],
  },
  {
    id: 'gmv-max-customized-posts-create',
    group: 'GMV Max · Identities & posts',
    name: { vi: 'Tạo customized TikTok posts cấp shop', en: 'Create shop-level customized TikTok posts' },
    method: 'POST',
    path: '/gmv_max/creation/custom_anchor_video_list/create/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1866513154013585'),
    params: [
      writeAdvertiser,
      writeBody(
        {
          store_id: '',
          store_authorized_bc_id: '',
          custom_anchor_video_list: [{ item_id: '', identity_info: { identity_id: '', identity_type: 'TT_USER' }, spu_id_list: [''] }],
        },
        `Bắt buộc: store_id, store_authorized_bc_id, custom_anchor_video_list — mỗi mục có item_id (lấy từ "Bài đăng dùng cho Product GMV Max"), identity_info, spu_id_list (1 SPU). identity_type: ${IDENTITY_TYPES}.`,
        `Required: store_id, store_authorized_bc_id, custom_anchor_video_list — each with item_id (from "Posts for a Product GMV Max campaign"), identity_info, spu_id_list (1 SPU). identity_type: ${IDENTITY_TYPES_EN}.`,
      ),
    ],
  },
  {
    id: 'gmv-max-customized-posts-delete',
    group: 'GMV Max · Identities & posts',
    name: { vi: 'Xoá customized TikTok posts', en: 'Delete customized TikTok posts' },
    method: 'POST',
    path: '/gmv_max/creation/custom_anchor_video_list/delete/',
    mutating: true,
    unverified: true,
    docsUrl: docs('1866513159202306'),
    params: [
      writeAdvertiser,
      writeBody(
        { store_id: '', store_authorized_bc_id: '', custom_anchor_video_list: [{ item_id: '', spu_id_list: [''] }] },
        'Bắt buộc: store_id, store_authorized_bc_id, custom_anchor_video_list (tối đa 200; item_id + spu_id_list cần gỡ). Thêm campaign_id nếu là bài cấp chiến dịch.',
        'Required: store_id, store_authorized_bc_id, custom_anchor_video_list (up to 200; item_id + spu_id_list to unlink). Add campaign_id for campaign-level posts.',
      ),
    ],
  },
]

/* -------------------------------------------------------------- Reporting --- */

const METRICS_VI =
  'Tổng quan: cost, net_cost, orders, cost_per_order, gross_revenue, roi. Cấp chiến dịch thêm: campaign_name, operation_status, schedule_*, target_roi_budget, bid_type, max_delivery_budget, roas_bid. Cấp sản phẩm (item_group_id): product_name, product_image_url, product_status. Cấp creative (item_id): title, tt_account_name, creative_delivery_status, product_impressions, product_clicks, product_click_rate, ad_click_rate, ad_conversion_rate, ad_video_view_rate_2s/6s/p25/p50/p75/p100. LIVE: live_views, cost_per_live_view, cost_per_10_second_live_view, live_follows, all_shops_orders/gross_revenue/roi/cost_per_order; cấp livestream (room_id): live_name, live_status, live_launched_time, live_duration.'
const METRICS_EN =
  'Overview: cost, net_cost, orders, cost_per_order, gross_revenue, roi. Campaign level adds: campaign_name, operation_status, schedule_*, target_roi_budget, bid_type, max_delivery_budget, roas_bid. Product level (item_group_id): product_name, product_image_url, product_status. Creative level (item_id): title, tt_account_name, creative_delivery_status, product_impressions, product_clicks, product_click_rate, ad_click_rate, ad_conversion_rate, ad_video_view_rate_2s/6s/p25/p50/p75/p100. LIVE: live_views, cost_per_live_view, cost_per_10_second_live_view, live_follows, all_shops_orders/gross_revenue/roi/cost_per_order; livestream level (room_id): live_name, live_status, live_launched_time, live_duration.'

const report: EndpointSpec[] = [
  {
    id: 'gmv-max-report',
    group: 'GMV Max · Report',
    name: { vi: 'Báo cáo chiến dịch GMV Max', en: 'GMV Max campaign report' },
    description: {
      vi: 'Chi phí, đơn hàng, doanh thu, ROI của GMV Max — không có trong báo cáo Integrated. Mỗi lần một shop.',
      en: 'GMV Max cost, orders, revenue and ROI — not available in the Integrated report. One shop per call.',
    },
    method: 'GET',
    path: '/gmv_max/report/get/',
    resultPath: 'data.list',
    pagination: pageContract(1000),
    docsUrl: docs('1824721673497601'),
    params: [
      advertiserId(),
      list('store_ids', 'TikTok Shop ID', 'TikTok Shop ID', {
        required: true,
        help: { vi: 'Đúng 1 shop (API từ chối từ 2 trở lên).', en: 'Exactly one shop (two or more are rejected).' },
      }),
      { key: 'start_date', label: { vi: 'Từ ngày', en: 'Start date' }, in: 'query', type: 'date', required: true, help: { vi: 'Theo múi giờ tài khoản.', en: 'Ad account time zone.' } },
      { key: 'end_date', label: { vi: 'Đến ngày', en: 'End date' }, in: 'query', type: 'date', required: true, help: { vi: 'Tính cả ngày này.', en: 'Inclusive.' } },
      list('dimensions', 'Chiều dữ liệu', 'Dimensions', {
        required: true,
        defaultValue: ['campaign_id'],
        help: {
          vi: 'advertiser_id, campaign_id, stat_time_day, stat_time_hour, item_group_id (sản phẩm), item_id (bài đăng), room_id (livestream), duration. Mỗi nhóm chỉ số nhận một bộ chiều khác nhau.',
          en: 'advertiser_id, campaign_id, stat_time_day, stat_time_hour, item_group_id (product), item_id (post), room_id (livestream), duration. Each metric group accepts its own set.',
        },
      }),
      list('metrics', 'Chỉ số', 'Metrics', {
        required: true,
        defaultValue: ['cost', 'orders', 'cost_per_order', 'gross_revenue', 'roi'],
        help: { vi: METRICS_VI, en: METRICS_EN },
      }),
      flag('enable_total_metrics', 'Kèm tổng cộng', 'Include totals'),
      json('filtering', 'Bộ lọc (JSON)', 'Filtering (JSON)', {
        placeholder: '{"gmv_max_promotion_types":["PRODUCT_GMV_MAX"],"campaign_statuses":["STATUS_DELIVERY_OK"]}',
        help: {
          vi: 'Khoá: gmv_max_promotion_types, campaign_ids (≤ 100), campaign_name, campaign_statuses (STATUS_DELIVERY_OK, STATUS_DISABLE, STATUS_DELETE, STATUS_NOT_DELIVERY, STATUS_ALL), item_group_ids (≤ 100), creative_types, creative_delivery_statuses, search_word, room_ids (≤ 100). Mặc định không gồm chiến dịch đã xoá.',
          en: 'Keys: gmv_max_promotion_types, campaign_ids (≤ 100), campaign_name, campaign_statuses (STATUS_DELIVERY_OK, STATUS_DISABLE, STATUS_DELETE, STATUS_NOT_DELIVERY, STATUS_ALL), item_group_ids (≤ 100), creative_types, creative_delivery_statuses, search_word, room_ids (≤ 100). Deleted campaigns are excluded by default.',
        },
      }),
      text('sort_field', 'Sắp xếp theo', 'Sort by', { placeholder: 'cost', help: { vi: 'Một chỉ số, ví dụ cost, gross_revenue.', en: 'A metric, e.g. cost or gross_revenue.' } }),
      choice('sort_type', 'Chiều sắp xếp', 'Order', ['DESC', 'ASC'], { help: { vi: 'Mặc định DESC.', en: 'Defaults to DESC.' } }),
      ...page(1000, 50),
    ],
  },
]

export const tiktokGmvMaxEndpoints: EndpointSpec[] = [...campaign, ...campaignWrites, ...shop, ...posts, ...report]
