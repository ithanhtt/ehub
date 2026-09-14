import type { EndpointSpec } from '@/core/plugins/types'
import { advertiserId, bcId, bodyParam, pageParams } from './param-kit'

/**
 * The bulk TikTok Business API surface, declared from the endpoint index.
 *
 * ## Why this file is separate from endpoints.ts
 *
 * `endpoints.ts` holds endpoints whose parameters, response envelope and id
 * field were read from the docs and confirmed against a live account. Every
 * entry here was declared from its path alone: the method and the owning
 * parameter are inferred, and nothing about the response shape is known.
 *
 * Both kinds are genuinely useful and they are not interchangeable, so the
 * difference is recorded in the data (`unverified: true`) rather than left to
 * whoever reads the file. The Hub shows a badge, refuses to persist a dataset
 * from one, and the permission probe treats a rejection here as information
 * about the *request* as much as about the token.
 *
 * ## What is inferred, and how
 *
 * **Method.** TikTok names the operation in the last path segment, so the verb
 * decides: `create`, `update`, `delete`, `assign`, `bind`, … are POST; `get`,
 * `list`, `info`, `check`, … are GET. Where a segment is ambiguous the row is
 * declared POST, because guessing "write" is the safe error: a mutating
 * endpoint is confirmed before it fires and is never touched by the permission
 * probe, whereas a write path mistakenly declared GET would be called for real
 * by that probe. `assertMethodMatchesPath` below turns that rule into a check
 * rather than a habit.
 *
 * **Body.** A write endpoint takes one free-form JSON object, pasted from the
 * docs. Generating typed fields would mean inventing them.
 *
 * **Response.** `data.list` is declared only for paths ending `/get/` or
 * `/list/`, where the TikTok envelope is near-universal. When it is wrong the
 * Records tab is simply empty and the raw JSON tab still shows everything — a
 * visible miss, not a silent wrong answer.
 */

type Scope = 'advertiser' | 'bc' | 'none'

/** path, method, owning parameter, Vietnamese name, English name. */
type Row = readonly [string, 'GET' | 'POST', Scope, string, string]

/**
 * Path segments that name a state change.
 *
 * `authorization` and `attribute` are nouns, not verbs, and both name
 * operations that grant or set something — they are listed here deliberately,
 * on the "guess write" rule above.
 */
const WRITE_VERBS = [
  'create',
  'update',
  'delete',
  'add',
  'assign',
  'unassign',
  'bind',
  'unbind',
  'invite',
  'disable',
  'submit',
  'appeal',
  'share',
  'authorize',
  'authorization',
  'subscribe',
  'unsubscribe',
  'review',
  'attribute',
] as const

/** Matches only a whole final segment, so `review_info` is not `review`. */
const WRITE_PATH = new RegExp(`/(${WRITE_VERBS.join('|')})/$`)

/** `/bc/asset_group/create/` -> `bc-asset-group-create`. */
function idFromPath(path: string): string {
  return path.replace(/^\/|\/$/g, '').replace(/[/_]/g, '-')
}

function ownerParams(scope: Scope): EndpointSpec['params'] {
  if (scope === 'advertiser') return [advertiserId()]
  if (scope === 'bc') return [bcId()]
  return []
}

function toEndpoint(group: string, [path, method, scope, vi, en]: Row): EndpointSpec {
  const isRead = method === 'GET'

  return {
    id: idFromPath(path),
    group,
    name: { vi, en },
    method,
    path,
    unverified: true,
    mutating: !isRead,
    resultPath: isRead && /\/(get|list)\/$/.test(path) ? 'data.list' : undefined,
    params: isRead ? [...ownerParams(scope), ...pageParams] : [...ownerParams(scope), bodyParam],
  }
}

/**
 * Fails the build if a declared method contradicts its path.
 *
 * This runs at module load rather than in a test script because the cost of
 * being wrong is asymmetric: a write path left as GET is a live call made by
 * the permission probe against a real ad account. Nothing should be able to
 * import a catalogue that contains one.
 */
function assertMethodMatchesPath(endpoints: EndpointSpec[]): void {
  const wrong = endpoints.filter((e) => WRITE_PATH.test(e.path) && e.method === 'GET')
  if (wrong.length > 0) {
    throw new Error(
      `TikTok declared catalogue: ${wrong.map((e) => e.path).join(', ')} name a write ` +
        `operation but are declared GET, which would let the permission probe call them.`,
    )
  }
}

function declare(group: string, rows: readonly Row[]): EndpointSpec[] {
  const endpoints = rows.map((row) => toEndpoint(group, row))
  assertMethodMatchesPath(endpoints)
  return endpoints
}

/* ------------------------------------------------------- Business Center --- */

/*
 * `/oauth2/advertiser/get/` is intentionally absent: it is already curated in
 * endpoints.ts as `authorized-advertisers`, with its app_id/secret params
 * filled from the connection. Declaring it again would shadow the better entry.
 */
const businessCenter = declare('Business Center', [
  ['/bc/advertiser/qualification/get/', 'GET', 'bc', 'Hồ sơ pháp lý tài khoản QC', 'Ad account qualification'],
  ['/bc/advertiser/attribute/', 'POST', 'bc', 'Đặt thuộc tính tài khoản QC', 'Set ad account attributes'],
  ['/bc/advertiser/disable/', 'POST', 'bc', 'Vô hiệu hoá tài khoản QC', 'Disable ad account'],
  ['/bc/advertiser/unionpay_info/check/', 'GET', 'bc', 'Kiểm tra thông tin UnionPay', 'Check UnionPay info'],
  ['/bc/advertiser/unionpay_info/submit/', 'POST', 'bc', 'Gửi thông tin UnionPay', 'Submit UnionPay info'],
  ['/bc/account/transaction/get/', 'GET', 'bc', 'Giao dịch tài khoản', 'Account transactions'],
  ['/bc/account/cost/get/', 'GET', 'bc', 'Chi phí tài khoản', 'Account cost'],
  ['/bc/account/budget/changelog/get/', 'GET', 'bc', 'Lịch sử thay đổi ngân sách', 'Budget changelog'],
  ['/bc/invoice/billing_report/get/', 'GET', 'bc', 'Báo cáo hoá đơn', 'Billing report'],
  ['/bc/pixel/get/', 'GET', 'bc', 'Pixel của Business Center', 'Business Center pixels'],
  ['/bc/asset/account/authorization/', 'POST', 'bc', 'Uỷ quyền tài khoản vào BC', 'Authorize account into BC'],
  ['/bc/asset/advertiser/assign/', 'POST', 'bc', 'Gán tài sản cho tài khoản QC', 'Assign asset to advertiser'],
  ['/bc/asset/advertiser/unassign/', 'POST', 'bc', 'Bỏ gán tài sản', 'Unassign asset'],
  ['/bc/asset/advertiser/assigned/', 'GET', 'bc', 'Tài sản đã gán', 'Assigned assets'],
  ['/bc/asset_group/create/', 'POST', 'bc', 'Tạo nhóm tài sản', 'Create asset group'],
  ['/bc/asset_group/get/', 'GET', 'bc', 'Chi tiết nhóm tài sản', 'Asset group detail'],
  ['/bc/asset_group/list/', 'GET', 'bc', 'Danh sách nhóm tài sản', 'List asset groups'],
  ['/bc/asset_group/update/', 'POST', 'bc', 'Cập nhật nhóm tài sản', 'Update asset group'],
  ['/bc/asset_group/delete/', 'POST', 'bc', 'Xoá nhóm tài sản', 'Delete asset group'],
  ['/bc/member/assign/', 'POST', 'bc', 'Gán thành viên', 'Assign member'],
  ['/bc/child/invite/', 'POST', 'bc', 'Mời BC con', 'Invite child BC'],
  ['/bc/child/unbind/', 'POST', 'bc', 'Huỷ liên kết BC con', 'Unbind child BC'],
  ['/bc/oa/create/', 'POST', 'bc', 'Tạo tài khoản OA', 'Create OA account'],
  ['/bc/inspiration_tool/audience_insight/', 'GET', 'bc', 'Insight đối tượng', 'Audience insight'],
  ['/bc/inspiration_tool/ad_performance/', 'GET', 'bc', 'Hiệu quả quảng cáo (BC)', 'Ad performance (BC)'],
  ['/asset/bind/quota/', 'GET', 'bc', 'Hạn mức liên kết tài sản', 'Asset binding quota'],
])

/* --------------------------------------------------------------- Campaign --- */

const campaign = declare('Campaign', [
  ['/campaign/quota/info/', 'GET', 'advertiser', 'Hạn mức chiến dịch', 'Campaign quota'],
  ['/campaign/spc/quota/get/', 'GET', 'advertiser', 'Hạn mức Smart Performance', 'Smart Performance quota'],
  ['/campaign_label/get/', 'GET', 'advertiser', 'Nhãn chiến dịch', 'Campaign labels'],
  ['/business/spark_ad/create/', 'POST', 'advertiser', 'Tạo Spark Ad', 'Create Spark Ad'],
  ['/ttms/account/list/', 'GET', 'advertiser', 'Danh sách tài khoản TTMS', 'List TTMS accounts'],
  ['/smart_plus/campaign/get/', 'GET', 'advertiser', 'Chiến dịch Smart+', 'Smart+ campaigns'],
  ['/smart_plus/campaign/create/', 'POST', 'advertiser', 'Tạo chiến dịch Smart+', 'Create Smart+ campaign'],
  ['/smart_plus/campaign/update/', 'POST', 'advertiser', 'Cập nhật chiến dịch Smart+', 'Update Smart+ campaign'],
  ['/smart_plus/campaign/status/update/', 'POST', 'advertiser', 'Đổi trạng thái chiến dịch Smart+', 'Update Smart+ campaign status'],
  ['/smart_plus/campaign/review/', 'POST', 'advertiser', 'Gửi chiến dịch Smart+ đi duyệt', 'Submit Smart+ campaign for review'],
  ['/smart_plus/campaign/copy/task/create/', 'POST', 'advertiser', 'Tạo tác vụ nhân bản chiến dịch', 'Create campaign copy task'],
  ['/smart_plus/campaign/copy/task/check/', 'GET', 'advertiser', 'Trạng thái tác vụ nhân bản', 'Campaign copy task status'],
  ['/smart_plus/adgroup/get/', 'GET', 'advertiser', 'Nhóm quảng cáo Smart+', 'Smart+ ad groups'],
  ['/smart_plus/adgroup/create/', 'POST', 'advertiser', 'Tạo nhóm quảng cáo Smart+', 'Create Smart+ ad group'],
  ['/smart_plus/adgroup/update/', 'POST', 'advertiser', 'Cập nhật nhóm quảng cáo Smart+', 'Update Smart+ ad group'],
  ['/smart_plus/adgroup/status/update/', 'POST', 'advertiser', 'Đổi trạng thái nhóm QC Smart+', 'Update Smart+ ad group status'],
  ['/smart_plus/adgroup/budget/update/', 'POST', 'advertiser', 'Đổi ngân sách nhóm QC Smart+', 'Update Smart+ ad group budget'],
  ['/smart_plus/ad/get/', 'GET', 'advertiser', 'Quảng cáo Smart+', 'Smart+ ads'],
  ['/smart_plus/mmt/ad/get/', 'GET', 'advertiser', 'Quảng cáo Smart+ (MMT)', 'Smart+ ads (MMT)'],
  ['/smart_plus/ad/create/', 'POST', 'advertiser', 'Tạo quảng cáo Smart+', 'Create Smart+ ad'],
  ['/smart_plus/ad/update/', 'POST', 'advertiser', 'Cập nhật quảng cáo Smart+', 'Update Smart+ ad'],
  ['/smart_plus/ad/status/update/', 'POST', 'advertiser', 'Đổi trạng thái quảng cáo Smart+', 'Update Smart+ ad status'],
  ['/smart_plus/ad/material_status/update/', 'POST', 'advertiser', 'Đổi trạng thái nguyên liệu Smart+', 'Update Smart+ material status'],
  ['/smart_plus/ad/review_info/', 'GET', 'advertiser', 'Kết quả duyệt quảng cáo Smart+', 'Smart+ ad review result'],
  ['/smart_plus/material/review_info/', 'GET', 'advertiser', 'Kết quả duyệt nguyên liệu Smart+', 'Smart+ material review result'],
  ['/smart_plus/ad/appeal/', 'POST', 'advertiser', 'Khiếu nại quảng cáo Smart+', 'Appeal Smart+ ad'],
  ['/changelog/get/', 'GET', 'advertiser', 'Lịch sử thay đổi', 'Changelog'],
  ['/changelog/task/create/', 'POST', 'advertiser', 'Tạo tác vụ xuất lịch sử', 'Create changelog export task'],
  ['/changelog/task/check/', 'GET', 'advertiser', 'Trạng thái tác vụ xuất lịch sử', 'Changelog task status'],
  ['/changelog/task/download/', 'GET', 'advertiser', 'Tải file lịch sử thay đổi', 'Download changelog file'],
  ['/search_ad/negative_keyword/get/', 'GET', 'advertiser', 'Từ khoá loại trừ', 'Negative keywords'],
  ['/search_ad/negative_keyword/add/', 'POST', 'advertiser', 'Thêm từ khoá loại trừ', 'Add negative keywords'],
  ['/search_ad/negative_keyword/update/', 'POST', 'advertiser', 'Cập nhật từ khoá loại trừ', 'Update negative keywords'],
  ['/search_ad/negative_keyword/delete/', 'POST', 'advertiser', 'Xoá từ khoá loại trừ', 'Delete negative keywords'],
  ['/account/optimization/account/', 'GET', 'advertiser', 'Gợi ý tối ưu cấp tài khoản', 'Account-level optimisation tips'],
  ['/account/optimization/entity/', 'GET', 'advertiser', 'Gợi ý tối ưu theo đối tượng', 'Entity-level optimisation tips'],
])

/*
 * GMV Max is not declared here: every GMV Max endpoint, with its documented
 * parameters, lives in endpoints-gmv-max.ts. Two of the rows this file used
 * to carry were wrong in ways a path cannot show — /creation/…/get/ and
 * /shop_video/video_anchors/ are POST reads, not GETs.
 */

/* --------------------------------------------------------------- Showcase --- */

const showcase = declare('Showcase', [
  ['/showcase/product/get/', 'GET', 'advertiser', 'Sản phẩm Showcase', 'Showcase products'],
  ['/showcase/identity/get/', 'GET', 'advertiser', 'Identity Showcase', 'Showcase identities'],
  ['/showcase/region/get/', 'GET', 'advertiser', 'Khu vực Showcase', 'Showcase regions'],
])

/* ----------------------------------------------------------------- Report --- */

const report = declare('Report', [
  ['/report/subscription/get/', 'GET', 'advertiser', 'Đăng ký báo cáo', 'Report subscriptions'],
  ['/report/subscription/subscribe/', 'POST', 'advertiser', 'Đăng ký nhận báo cáo', 'Subscribe to report'],
  ['/report/subscription/update/', 'POST', 'advertiser', 'Cập nhật đăng ký báo cáo', 'Update report subscription'],
  ['/report/subscription/unsubscribe/', 'POST', 'advertiser', 'Huỷ đăng ký báo cáo', 'Unsubscribe from report'],
  ['/report/ad_benchmark/get/', 'GET', 'advertiser', 'Chỉ số tham chiếu ngành', 'Ad benchmark'],
  ['/report/video_performance/get/', 'GET', 'advertiser', 'Hiệu quả video', 'Video performance'],
  ['/report/bid_protection/status/get/', 'GET', 'advertiser', 'Trạng thái bảo vệ giá thầu', 'Bid protection status'],
  ['/report/bid_protection/detail/get/', 'GET', 'advertiser', 'Chi tiết bảo vệ giá thầu', 'Bid protection detail'],
  ['/creative_fatigue/get/', 'GET', 'advertiser', 'Độ bào mòn creative', 'Creative fatigue'],
  ['/gmv_max/video_list/report/get/', 'GET', 'advertiser', 'Báo cáo video GMV Max', 'GMV Max video report'],
  ['/smart_plus/material_report/overview/', 'GET', 'advertiser', 'Tổng quan nguyên liệu Smart+', 'Smart+ material overview'],
  ['/smart_plus/material_report/breakdown/', 'GET', 'advertiser', 'Chi tiết nguyên liệu Smart+', 'Smart+ material breakdown'],
  ['/mmm/api/create/', 'POST', 'advertiser', 'Tạo tác vụ MMM', 'Create MMM task'],
  ['/mmm/api/check/', 'GET', 'advertiser', 'Trạng thái tác vụ MMM', 'MMM task status'],
  ['/mmm/api/download/', 'GET', 'advertiser', 'Tải kết quả MMM', 'Download MMM result'],
  ['/mmm/api/history/', 'GET', 'advertiser', 'Lịch sử tác vụ MMM', 'MMM task history'],
])

/* --------------------------------------------------------------- Creative --- */

const creative = declare('Creative', [
  ['/creative/portfolio/list/', 'GET', 'advertiser', 'Danh sách portfolio', 'List portfolios'],
  ['/creative/asset/share/', 'POST', 'advertiser', 'Chia sẻ tài sản creative', 'Share creative asset'],
  ['/creative/asset/delete/', 'POST', 'advertiser', 'Xoá tài sản creative', 'Delete creative asset'],
  ['/creative/shareable_link/create/', 'POST', 'advertiser', 'Tạo link chia sẻ', 'Create shareable link'],
  ['/creative/shared_folder/detail/', 'GET', 'advertiser', 'Chi tiết thư mục chia sẻ', 'Shared folder detail'],
  ['/creative/shared_folder/partner/', 'GET', 'advertiser', 'Đối tác thư mục chia sẻ', 'Shared folder partners'],
  ['/creative/shared_folder/associated_advertiser/', 'GET', 'advertiser', 'Tài khoản QC liên kết thư mục', 'Advertisers linked to folder'],
  ['/creative/shared_folder/create/', 'POST', 'advertiser', 'Tạo thư mục chia sẻ', 'Create shared folder'],
  ['/creative/shared_folder/advertiser/authorize/', 'POST', 'advertiser', 'Uỷ quyền thư mục chia sẻ', 'Authorize shared folder'],
  ['/creative/auto_message/get/', 'GET', 'advertiser', 'Tin nhắn tự động', 'Auto messages'],
  ['/creative/auto_message/create/', 'POST', 'advertiser', 'Tạo tin nhắn tự động', 'Create auto message'],
  ['/creative/pre_review/task/get/', 'GET', 'advertiser', 'Tác vụ tiền duyệt', 'Pre-review task'],
  ['/creative/pre_review/task/create/', 'POST', 'advertiser', 'Tạo tác vụ tiền duyệt', 'Create pre-review task'],
  ['/creative/gmv_max/pre_review/task/get/', 'GET', 'advertiser', 'Tác vụ tiền duyệt GMV Max', 'GMV Max pre-review task'],
  ['/creative/gmv_max/pre_review/task/create/', 'POST', 'advertiser', 'Tạo tiền duyệt GMV Max', 'Create GMV Max pre-review task'],
  ['/creative/app_center/user/record/', 'GET', 'advertiser', 'Lịch sử App Center', 'App Center user record'],
  ['/creative/app_center/advanced_function/check/', 'GET', 'advertiser', 'Kiểm tra tính năng nâng cao', 'Advanced function check'],
  ['/smart_plus/ad/preview/', 'GET', 'advertiser', 'Xem trước quảng cáo Smart+', 'Preview Smart+ ad'],
  ['/file/name/check/', 'GET', 'advertiser', 'Kiểm tra tên file', 'Check file name'],
  ['/file/delete/', 'POST', 'advertiser', 'Xoá file', 'Delete file'],
  ['/file/video/ad/bind/', 'POST', 'advertiser', 'Gắn video vào quảng cáo', 'Bind video to ad'],
  ['/file/video/ad/task/get/', 'GET', 'advertiser', 'Trạng thái tác vụ gắn video', 'Video bind task status'],
  ['/video/fix/task/create/', 'POST', 'advertiser', 'Tạo tác vụ sửa video', 'Create video fix task'],
  ['/video/fix/task/get/', 'GET', 'advertiser', 'Trạng thái tác vụ sửa video', 'Video fix task status'],
  ['/identity/delete/', 'POST', 'advertiser', 'Xoá identity', 'Delete identity'],
])

/* -------------------------------------------------------------- Discovery --- */

const discovery = declare('Discovery', [
  ['/discovery/search/', 'GET', 'advertiser', 'Tìm kiếm nội dung', 'Search content'],
  ['/discovery/search/recommend/', 'GET', 'advertiser', 'Gợi ý tìm kiếm', 'Search recommendations'],
  ['/discovery/cml/list/', 'GET', 'advertiser', 'Danh sách CML', 'CML list'],
  ['/discovery/cml/video_list/', 'GET', 'advertiser', 'Video CML', 'CML videos'],
  ['/discovery/cml/post/list/', 'GET', 'advertiser', 'Bài đăng CML', 'CML posts'],
  ['/discovery/cml/trending_list/', 'GET', 'advertiser', 'CML đang thịnh hành', 'Trending CML'],
  ['/discovery/trending/search/', 'GET', 'advertiser', 'Tìm kiếm thịnh hành', 'Trending search'],
  ['/discovery/trending/search/keyword/', 'GET', 'advertiser', 'Từ khoá thịnh hành', 'Trending keywords'],
  ['/discovery/trending/hashtag/list/', 'GET', 'advertiser', 'Hashtag thịnh hành', 'Trending hashtags'],
  ['/discovery/trending/hashtag/detail/get/', 'GET', 'advertiser', 'Chi tiết hashtag thịnh hành', 'Trending hashtag detail'],
  ['/discovery/hashtag/post/list/', 'GET', 'advertiser', 'Bài đăng theo hashtag', 'Posts by hashtag'],
])

/* ------------------------------------------------------------ TikTok Shop --- */

const shop = declare('TikTok Shop', [
  ['/store/list/', 'GET', 'advertiser', 'Danh sách cửa hàng', 'List stores'],
])

/* -------------------------------------------------------------- Diagnosis --- */

const diagnosis = declare('Diagnosis', [
  ['/tool/diagnosis/get/', 'GET', 'advertiser', 'Chẩn đoán quảng cáo', 'Ad diagnosis'],
])

export const tiktokDeclaredEndpoints: EndpointSpec[] = [
  ...businessCenter,
  ...campaign,
  ...showcase,
  ...report,
  ...creative,
  ...discovery,
  ...shop,
  ...diagnosis,
]
