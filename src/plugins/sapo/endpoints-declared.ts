import type { EndpointSpec, ParamSpec } from '@/core/plugins/types'
import { pathId, sapoEndpoints } from './endpoints'

/**
 * The broader Sapo admin API surface, declared from paths.
 *
 * endpoints.ts holds what was confirmed against a live store — status,
 * envelope key and record id all seen. Everything here is either a path that
 * answered 200 with an empty list (so no record was there to confirm), or a
 * path taken from the Sapo docs at support.sapo.vn. Both are marked
 * `unverified`: the Hub badges them and will not persist a dataset from one.
 *
 * A 403 proves nothing here. Sapo answers 403 for a path that does not exist
 * at all (`/admin/definitely_not_a_resource.json`, probed), exactly as it does
 * for a missing permission — so a path is only listed when it answered 200 or
 * appears in the docs, never on the strength of a probe alone. Resources a
 * store may expose but the docs never mention (locations, inventory, checkouts,
 * draft orders, gift cards…) are left out for the same reason.
 *
 * **Method.** Sapo is REST: one path serves several verbs, so the method is
 * declared per row rather than inferred. Paths ending in an action segment
 * (`close.json`, `spam.json`, …) are writes; `assertMethodMatchesPath`
 * refuses a GET on one, because the permission probe would call it for real.
 *
 * **Body.** A write takes one JSON object pasted from the docs —
 * `{ "order": { … } }` — which buildRequest sends as it is.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** path, method, Vietnamese name, English name, response envelope key, extra params. */
type Row = readonly [string, Method, string, string, string?, ParamSpec[]?]

const ACTION_SEGMENTS = [
  'close',
  'open',
  'reopen',
  'cancel',
  'complete',
  'default',
  'spam',
  'not_spam',
  'approve',
  'remove',
  'restore',
  'order',
] as const

const WRITE_PATH = new RegExp(`/(${ACTION_SEGMENTS.join('|')})\\.json$`)

/** Paging without a `pagination` contract: sent only when the user fills it in. */
const pageParams: ParamSpec[] = [
  { key: 'page', label: { vi: 'Trang', en: 'Page' }, in: 'query', type: 'number', placeholder: '1' },
  {
    key: 'limit',
    label: { vi: 'Số dòng/trang', en: 'Limit' },
    in: 'query',
    type: 'number',
    placeholder: '50',
    help: { vi: 'Tối đa 250.', en: 'Maximum 250.' },
  },
]

const bodyParam: ParamSpec = {
  key: 'body',
  label: { vi: 'Body (JSON)', en: 'Body (JSON)' },
  in: 'body',
  type: 'json',
  required: true,
  placeholder: '{ "order": { "note": "..." } }',
  help: {
    vi: 'Dán nguyên object JSON theo tài liệu Sapo, gồm cả khoá bọc ngoài như "order", "product".',
    en: 'Paste the JSON object straight from the Sapo docs, including the wrapping key such as "order" or "product".',
  },
}

/** Theme assets are addressed by a `key` query param, not by a path id. */
const assetKey = (required: boolean): ParamSpec => ({
  key: 'key',
  label: { vi: 'Asset key', en: 'Asset key' },
  in: 'query',
  type: 'string',
  required,
  placeholder: 'templates/index.bwt',
})

/** Placeholder names differ between files; the URL they describe does not. */
const shapeOf = (method: string, path: string) => `${method} ${path.replace(/\{\w+\}/g, '{}')}`

/** `/admin/orders/{order_id}/close.json` + POST -> `orders-order-id-close-post`. */
function idFor(path: string, method: Method): string {
  const slug = path
    .replace(/^\/admin\//, '')
    .replace(/\.json$/, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
  return method === 'GET' ? slug : `${slug}-${method.toLowerCase()}`
}

/** A collection read — not a count, not a single `{id}` record. */
function isListRead(path: string): boolean {
  return !/\/count\.json$/.test(path) && !/\}\.json$/.test(path)
}

function toEndpoint(group: string, [path, method, vi, en, resultPath, extra = []]: Row): EndpointSpec {
  const pathParams = [...path.matchAll(/\{(\w+)\}/g)].map(([, key]) => pathId(key, key, key))
  const isRead = method === 'GET'

  return {
    id: idFor(path, method),
    group,
    name: { vi, en },
    method,
    path,
    unverified: true,
    mutating: !isRead,
    resultPath: isRead ? resultPath : undefined,
    params: [
      ...pathParams,
      ...extra,
      ...(isRead && isListRead(path) && extra.length === 0 ? pageParams : []),
      ...(method === 'POST' || method === 'PUT' ? [bodyParam] : []),
    ],
  }
}

function assertMethodMatchesPath(endpoints: EndpointSpec[]): void {
  const wrong = endpoints.filter((e) => WRITE_PATH.test(e.path) && e.method === 'GET')
  if (wrong.length > 0) {
    throw new Error(
      `Sapo declared catalogue: ${wrong.map((e) => e.path).join(', ')} name a write ` +
        `operation but are declared GET, which would let the permission probe call them.`,
    )
  }
}

function declare(group: string, rows: readonly Row[]): EndpointSpec[] {
  const endpoints = rows.map((row) => toEndpoint(group, row))
  assertMethodMatchesPath(endpoints)
  return endpoints
}

/* ------------------------------------------------------------------ Order --- */

const order = declare('Order', [
  ['/admin/orders.json', 'POST', 'Tạo đơn hàng', 'Create order'],
  ['/admin/orders/{id}.json', 'PUT', 'Cập nhật đơn hàng', 'Update order'],
  ['/admin/orders/{id}.json', 'DELETE', 'Xoá đơn hàng', 'Delete order'],
  ['/admin/orders/{id}/close.json', 'POST', 'Lưu trữ đơn hàng', 'Close order'],
  ['/admin/orders/{id}/open.json', 'POST', 'Bỏ lưu trữ đơn hàng', 'Re-open order'],
  ['/admin/orders/{id}/cancel.json', 'POST', 'Huỷ đơn hàng', 'Cancel order'],
  ['/admin/orders/{order_id}/transactions.json', 'GET', 'Giao dịch thanh toán của đơn', 'Order transactions', 'transactions'],
  ['/admin/orders/{order_id}/transactions/{id}.json', 'GET', 'Chi tiết giao dịch', 'Transaction detail', 'transaction'],
  ['/admin/orders/{order_id}/transactions.json', 'POST', 'Tạo giao dịch', 'Create transaction'],
  ['/admin/orders/{order_id}/fulfillments.json', 'GET', 'Vận đơn của đơn', 'Order fulfillments', 'fulfillments'],
  ['/admin/orders/{order_id}/fulfillments/{id}.json', 'GET', 'Chi tiết vận đơn', 'Fulfillment detail', 'fulfillment'],
  ['/admin/orders/{order_id}/fulfillments.json', 'POST', 'Tạo vận đơn', 'Create fulfillment'],
  ['/admin/orders/{order_id}/fulfillments/{id}.json', 'PUT', 'Cập nhật vận đơn', 'Update fulfillment'],
  ['/admin/orders/{order_id}/fulfillments/{id}/complete.json', 'POST', 'Hoàn thành vận đơn', 'Complete fulfillment'],
  ['/admin/orders/{order_id}/fulfillments/{id}/cancel.json', 'POST', 'Huỷ vận đơn', 'Cancel fulfillment'],
  ['/admin/orders/{order_id}/refunds.json', 'GET', 'Hoàn tiền của đơn', 'Order refunds', 'refunds'],
  ['/admin/orders/{order_id}/refunds/{id}.json', 'GET', 'Chi tiết hoàn tiền', 'Refund detail', 'refund'],
  ['/admin/orders/{order_id}/metafields.json', 'GET', 'Metafield của đơn', 'Order metafields', 'metafields'],
])

/* ---------------------------------------------------------------- Product --- */

const product = declare('Product', [
  ['/admin/products.json', 'POST', 'Tạo sản phẩm', 'Create product'],
  ['/admin/products/{id}.json', 'PUT', 'Cập nhật sản phẩm', 'Update product'],
  ['/admin/products/{id}.json', 'DELETE', 'Xoá sản phẩm', 'Delete product'],
  ['/admin/products/{product_id}/images.json', 'GET', 'Ảnh của sản phẩm', 'Product images', 'images'],
  ['/admin/products/{product_id}/images/{id}.json', 'GET', 'Chi tiết ảnh sản phẩm', 'Product image detail', 'image'],
  ['/admin/products/{product_id}/images.json', 'POST', 'Thêm ảnh sản phẩm', 'Create product image'],
  ['/admin/products/{product_id}/images/{id}.json', 'PUT', 'Cập nhật ảnh sản phẩm', 'Update product image'],
  ['/admin/products/{product_id}/images/{id}.json', 'DELETE', 'Xoá ảnh sản phẩm', 'Delete product image'],
  ['/admin/products/{product_id}/variants.json', 'POST', 'Tạo phiên bản', 'Create variant'],
  ['/admin/variants/{id}.json', 'PUT', 'Cập nhật phiên bản', 'Update variant'],
  ['/admin/products/{product_id}/variants/{id}.json', 'DELETE', 'Xoá phiên bản', 'Delete variant'],
  ['/admin/variants/{variant_id}/metafields.json', 'GET', 'Metafield của phiên bản', 'Variant metafields', 'metafields'],
  ['/admin/products/{product_id}/metafields.json', 'GET', 'Metafield của sản phẩm', 'Product metafields', 'metafields'],
  ['/admin/products/{product_id}/metafields/{id}.json', 'GET', 'Chi tiết metafield sản phẩm', 'Product metafield detail', 'metafield'],
  ['/admin/products/{product_id}/metafields.json', 'POST', 'Tạo metafield sản phẩm', 'Create product metafield'],
  ['/admin/products/{product_id}/metafields/{id}.json', 'PUT', 'Cập nhật metafield sản phẩm', 'Update product metafield'],
  ['/admin/products/{product_id}/metafields/{id}.json', 'DELETE', 'Xoá metafield sản phẩm', 'Delete product metafield'],
  ['/admin/custom_collections/{id}.json', 'GET', 'Chi tiết nhóm sản phẩm tự chọn', 'Custom collection detail', 'custom_collection'],
  ['/admin/custom_collections.json', 'POST', 'Tạo nhóm sản phẩm tự chọn', 'Create custom collection'],
  ['/admin/custom_collections/{id}.json', 'PUT', 'Cập nhật nhóm sản phẩm tự chọn', 'Update custom collection'],
  ['/admin/custom_collections/{id}.json', 'DELETE', 'Xoá nhóm sản phẩm tự chọn', 'Delete custom collection'],
  ['/admin/smart_collections.json', 'GET', 'Nhóm sản phẩm tự động', 'Smart collections', 'smart_collections'],
  ['/admin/smart_collections/{id}.json', 'GET', 'Chi tiết nhóm sản phẩm tự động', 'Smart collection detail', 'smart_collection'],
  ['/admin/smart_collections.json', 'POST', 'Tạo nhóm sản phẩm tự động', 'Create smart collection'],
  ['/admin/smart_collections/{id}.json', 'PUT', 'Cập nhật nhóm sản phẩm tự động', 'Update smart collection'],
  ['/admin/smart_collections/{id}/order.json', 'PUT', 'Đổi thứ tự sản phẩm trong nhóm', 'Set smart collection sort order'],
  ['/admin/smart_collections/{id}.json', 'DELETE', 'Xoá nhóm sản phẩm tự động', 'Delete smart collection'],
  ['/admin/collects.json', 'GET', 'Liên kết sản phẩm – nhóm', 'Collects', 'collects'],
  ['/admin/collects/{id}.json', 'GET', 'Chi tiết liên kết sản phẩm – nhóm', 'Collect detail', 'collect'],
  ['/admin/collects.json', 'POST', 'Gắn sản phẩm vào nhóm', 'Create collect'],
  ['/admin/collects/{id}.json', 'DELETE', 'Gỡ sản phẩm khỏi nhóm', 'Delete collect'],
])

/* --------------------------------------------------------------- Customer --- */

const customer = declare('Customer', [
  ['/admin/customers.json', 'POST', 'Tạo khách hàng', 'Create customer'],
  ['/admin/customers/{id}.json', 'PUT', 'Cập nhật khách hàng', 'Update customer'],
  ['/admin/customers/{id}.json', 'DELETE', 'Xoá khách hàng', 'Delete customer'],
  ['/admin/customers/{customer_id}/addresses/{id}.json', 'GET', 'Chi tiết địa chỉ', 'Customer address detail', 'customer_address'],
  ['/admin/customers/{customer_id}/addresses.json', 'POST', 'Thêm địa chỉ', 'Create customer address'],
  ['/admin/customers/{customer_id}/addresses/{id}.json', 'PUT', 'Cập nhật địa chỉ', 'Update customer address'],
  ['/admin/customers/{customer_id}/addresses/{id}.json', 'DELETE', 'Xoá địa chỉ', 'Delete customer address'],
  ['/admin/customers/{customer_id}/addresses/{id}/default.json', 'PUT', 'Đặt địa chỉ mặc định', 'Set default address'],
  ['/admin/customers/{customer_id}/metafields.json', 'GET', 'Metafield của khách hàng', 'Customer metafields', 'metafields'],
])

/* ---------------------------------------------------------------- Content --- */

const content = declare('Content', [
  ['/admin/blogs.json', 'POST', 'Tạo blog', 'Create blog'],
  ['/admin/blogs/{id}.json', 'PUT', 'Cập nhật blog', 'Update blog'],
  ['/admin/blogs/{id}.json', 'DELETE', 'Xoá blog', 'Delete blog'],
  ['/admin/blogs/{blog_id}/articles/{id}.json', 'GET', 'Chi tiết bài viết', 'Article detail', 'article'],
  ['/admin/blogs/{blog_id}/articles.json', 'POST', 'Tạo bài viết', 'Create article'],
  ['/admin/blogs/{blog_id}/articles/{id}.json', 'PUT', 'Cập nhật bài viết', 'Update article'],
  ['/admin/blogs/{blog_id}/articles/{id}.json', 'DELETE', 'Xoá bài viết', 'Delete article'],
  ['/admin/blogs/{blog_id}/articles/tags.json', 'GET', 'Tag bài viết của blog', 'Blog article tags', 'tags'],
  ['/admin/articles/tags.json', 'GET', 'Tag bài viết', 'Article tags', 'tags'],
  ['/admin/pages/{id}.json', 'GET', 'Chi tiết trang nội dung', 'Page detail', 'page'],
  ['/admin/pages.json', 'POST', 'Tạo trang nội dung', 'Create page'],
  ['/admin/pages/{id}.json', 'PUT', 'Cập nhật trang nội dung', 'Update page'],
  ['/admin/pages/{id}.json', 'DELETE', 'Xoá trang nội dung', 'Delete page'],
  ['/admin/comments.json', 'GET', 'Bình luận', 'Comments', 'comments'],
  ['/admin/comments/{id}.json', 'GET', 'Chi tiết bình luận', 'Comment detail', 'comment'],
  ['/admin/comments.json', 'POST', 'Tạo bình luận', 'Create comment'],
  ['/admin/comments/{id}.json', 'PUT', 'Cập nhật bình luận', 'Update comment'],
  ['/admin/comments/{id}/spam.json', 'POST', 'Đánh dấu spam', 'Mark comment as spam'],
  ['/admin/comments/{id}/not_spam.json', 'POST', 'Bỏ đánh dấu spam', 'Mark comment as not spam'],
  ['/admin/comments/{id}/approve.json', 'POST', 'Duyệt bình luận', 'Approve comment'],
  ['/admin/comments/{id}/remove.json', 'POST', 'Gỡ bình luận', 'Remove comment'],
  ['/admin/comments/{id}/restore.json', 'POST', 'Khôi phục bình luận', 'Restore comment'],
  ['/admin/redirects.json', 'GET', 'Chuyển hướng URL', 'Redirects', 'redirects'],
  ['/admin/redirects/{id}.json', 'GET', 'Chi tiết chuyển hướng', 'Redirect detail', 'redirect'],
  ['/admin/redirects.json', 'POST', 'Tạo chuyển hướng', 'Create redirect'],
  ['/admin/redirects/{id}.json', 'PUT', 'Cập nhật chuyển hướng', 'Update redirect'],
  ['/admin/redirects/{id}.json', 'DELETE', 'Xoá chuyển hướng', 'Delete redirect'],
])

/* ------------------------------------------------------------------ Theme --- */

const theme = declare('Theme', [
  ['/admin/themes.json', 'GET', 'Danh sách giao diện', 'Themes', 'themes'],
  ['/admin/themes/{id}.json', 'GET', 'Chi tiết giao diện', 'Theme detail', 'theme'],
  ['/admin/themes.json', 'POST', 'Tạo giao diện', 'Create theme'],
  ['/admin/themes/{id}.json', 'PUT', 'Cập nhật giao diện', 'Update theme'],
  ['/admin/themes/{id}.json', 'DELETE', 'Xoá giao diện', 'Delete theme'],
  ['/admin/themes/{theme_id}/assets.json', 'GET', 'File của giao diện', 'Theme assets', 'assets', [assetKey(false)]],
  ['/admin/themes/{theme_id}/assets.json', 'PUT', 'Tạo hoặc cập nhật file giao diện', 'Create or update asset'],
  ['/admin/themes/{theme_id}/assets.json', 'DELETE', 'Xoá file giao diện', 'Delete asset', undefined, [assetKey(true)]],
])

/* --------------------------------------------------------------- Discount --- */

const discount = declare('Discount', [
  ['/admin/price_rules.json', 'GET', 'Chương trình khuyến mãi', 'Price rules', 'price_rules'],
  ['/admin/price_rules/{id}.json', 'GET', 'Chi tiết khuyến mãi', 'Price rule detail', 'price_rule'],
  ['/admin/price_rules.json', 'POST', 'Tạo khuyến mãi', 'Create price rule'],
  ['/admin/price_rules/{id}.json', 'PUT', 'Cập nhật khuyến mãi', 'Update price rule'],
  ['/admin/price_rules/{id}.json', 'DELETE', 'Xoá khuyến mãi', 'Delete price rule'],
  ['/admin/price_rules/{price_rule_id}/discount_codes.json', 'GET', 'Mã giảm giá', 'Discount codes', 'discount_codes'],
  ['/admin/price_rules/{price_rule_id}/discount_codes/{id}.json', 'GET', 'Chi tiết mã giảm giá', 'Discount code detail', 'discount_code'],
  ['/admin/price_rules/{price_rule_id}/discount_codes.json', 'POST', 'Tạo mã giảm giá', 'Create discount code'],
  ['/admin/price_rules/{price_rule_id}/discount_codes/{id}.json', 'PUT', 'Cập nhật mã giảm giá', 'Update discount code'],
  ['/admin/price_rules/{price_rule_id}/discount_codes/{id}.json', 'DELETE', 'Xoá mã giảm giá', 'Delete discount code'],
])

/* ------------------------------------------------------------------ Store --- */

const store = declare('Store', [
  ['/admin/events.json', 'GET', 'Sự kiện của cửa hàng', 'Store events', 'events'],
  ['/admin/events/{id}.json', 'GET', 'Chi tiết sự kiện', 'Event detail', 'event'],
  ['/admin/events/count.json', 'GET', 'Đếm sự kiện', 'Count events'],
  ['/admin/countries/{country_id}/provinces.json', 'GET', 'Tỉnh/thành của quốc gia', 'Provinces of a country', 'provinces'],
  ['/admin/carrier_services.json', 'GET', 'Dịch vụ vận chuyển', 'Carrier services', 'carrier_services'],
  ['/admin/carrier_services/{id}.json', 'GET', 'Chi tiết dịch vụ vận chuyển', 'Carrier service detail', 'carrier_service'],
  ['/admin/carrier_services.json', 'POST', 'Tạo dịch vụ vận chuyển', 'Create carrier service'],
  ['/admin/carrier_services/{id}.json', 'PUT', 'Cập nhật dịch vụ vận chuyển', 'Update carrier service'],
  ['/admin/carrier_services/{id}.json', 'DELETE', 'Xoá dịch vụ vận chuyển', 'Delete carrier service'],
])

/* -------------------------------------------------------------------- App --- */

const app = declare('App', [
  ['/admin/metafields.json', 'GET', 'Metafield của cửa hàng', 'Shop metafields', 'metafields'],
  ['/admin/metafields/{id}.json', 'GET', 'Chi tiết metafield', 'Metafield detail', 'metafield'],
  ['/admin/metafields.json', 'POST', 'Tạo metafield', 'Create metafield'],
  ['/admin/metafields/{id}.json', 'PUT', 'Cập nhật metafield', 'Update metafield'],
  ['/admin/metafields/{id}.json', 'DELETE', 'Xoá metafield', 'Delete metafield'],
  ['/admin/script_tags.json', 'GET', 'Script tag', 'Script tags', 'script_tags'],
  ['/admin/script_tags/{id}.json', 'GET', 'Chi tiết script tag', 'Script tag detail', 'script_tag'],
  ['/admin/script_tags.json', 'POST', 'Tạo script tag', 'Create script tag'],
  ['/admin/script_tags/{id}.json', 'PUT', 'Cập nhật script tag', 'Update script tag'],
  ['/admin/script_tags/{id}.json', 'DELETE', 'Xoá script tag', 'Delete script tag'],
  ['/admin/webhooks.json', 'GET', 'Webhook', 'Webhooks', 'webhooks'],
  ['/admin/webhooks/{id}.json', 'GET', 'Chi tiết webhook', 'Webhook detail', 'webhook'],
  ['/admin/webhooks.json', 'POST', 'Tạo webhook', 'Create webhook'],
  ['/admin/webhooks/{id}.json', 'PUT', 'Cập nhật webhook', 'Update webhook'],
  ['/admin/webhooks/{id}.json', 'DELETE', 'Xoá webhook', 'Delete webhook'],
])

/*
 * The curated entry wins over a declared one for the same method and URL:
 * the Hub and the permission probe both take the first match, and the curated
 * one carries the confirmed envelope and id field.
 */
const curated = new Set(sapoEndpoints.map((e) => shapeOf(e.method, e.path)))

export const sapoDeclaredEndpoints: EndpointSpec[] = [
  ...order,
  ...product,
  ...customer,
  ...content,
  ...theme,
  ...discount,
  ...store,
  ...app,
].filter((e) => !curated.has(shapeOf(e.method, e.path)))
