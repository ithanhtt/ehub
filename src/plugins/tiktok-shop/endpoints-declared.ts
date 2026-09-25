import type { EndpointSpec, ParamSpec } from '@/core/plugins/types'

/**
 * The broader TikTok Shop Partner API surface, declared from paths.
 *
 * endpoints.ts holds the endpoints whose parameters and response were read
 * from the Partner Center docs page by page. Every entry here comes from the
 * path index of an open-source client (EcomPHP/tiktokshop-php, cross-checked
 * against Partner Center where a page was available): the method and the path
 * with its version are known, the parameters are not. So each is marked
 * `unverified` — the Hub badges it and will not persist a dataset from it —
 * and takes its inputs free-form: the path ids, a `query` object for query
 * parameters, and a `body` object pasted from the docs.
 *
 * Paths carry their version. A newer version of an endpoint in endpoints.ts
 * is not declared again; an older one TikTok still serves is left out too, so
 * the Hub never offers two versions of one call.
 *
 * **Writes.** Any non-GET that is not a search or a calculation is marked
 * `mutating`: the Hub asks for confirmation before sending it, and the
 * permission probe never calls it. `assertMethodMatchesPath` refuses a GET on
 * a path whose last segment names a change, for the same reason the TikTok
 * Ads catalogue does — the probe would call it for real.
 *
 * **App types.** `affiliate_creator` and `affiliate_partner` answer to a
 * creator's or an agency partner's authorisation, not a seller's; they are
 * listed for completeness and a seller token is refused there.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** path, method, Vietnamese name, English name, and whether a GET list takes page_size/page_token. */
type Row = readonly [string, Method, string, string, ('paged' | undefined)?]

/** Path prefixes that are not shop-scoped: no shop_cipher is sent to them. */
const UNSCOPED_PREFIXES = ['/authorization/', '/seller/', '/affiliate_creator/', '/affiliate_partner/']

/**
 * Seller-level resources inside otherwise shop-scoped groups: global products
 * and warehouses, and the compliance records (manufacturers, responsible
 * persons). TikTok refuses a shop_cipher on them (36009004, "not required").
 */
const UNSCOPED_SEGMENTS = /\/(global_\w+|compliance)\//

export const isUnscopedPath = (path: string) =>
  UNSCOPED_PREFIXES.some((prefix) => path.startsWith(prefix)) || UNSCOPED_SEGMENTS.test(`${path}/`)

/** POSTs that only read. */
const READ_SEGMENTS = /\/(search|query|recommend|calculate|list|newest|external_order_search)$/

const WRITE_SEGMENTS = new RegExp(
  `/(add|create|update|upload|publish|review|generate|deactivate|activate|recover|approve|reject|ship|deliver|split|combine|uncombine|sync|read|partial_edit|remove_creator|cancel|delete|remove)$`,
)

const shopCipher: ParamSpec = {
  key: 'shop_cipher',
  label: { vi: 'Shop cipher', en: 'Shop cipher' },
  in: 'query',
  type: 'string',
  required: true,
  satisfiedByConnection: true,
  help: { vi: 'Để trống: dùng shop của kết nối.', en: "Leave blank to use the connection's shop." },
}

const pageParams: ParamSpec[] = [
  { key: 'page_size', label: { vi: 'Số dòng/trang', en: 'Page size' }, in: 'query', type: 'number', placeholder: '20', help: { vi: 'Thường tối đa 100.', en: 'Usually at most 100.' } },
  { key: 'page_token', label: { vi: 'Page token', en: 'Page token' }, in: 'query', type: 'string', help: { vi: 'next_page_token của trang trước.', en: 'The previous page’s next_page_token.' } },
]

const queryParam: ParamSpec = {
  key: 'query',
  label: { vi: 'Tham số query (JSON)', en: 'Query parameters (JSON)' },
  in: 'query',
  type: 'json',
  placeholder: '{ "start_date_ge": "2026-09-01", "end_date_lt": "2026-09-08" }',
  help: {
    vi: 'Các tham số query khác theo tài liệu TikTok Shop, dạng object. Không cần app_key, timestamp, sign, shop_cipher — hệ thống tự thêm và ký.',
    en: 'Other query parameters from the TikTok Shop docs, as an object. app_key, timestamp, sign and shop_cipher are added and signed for you.',
  },
}

const bodyParam = (required: boolean): ParamSpec => ({
  key: 'body',
  label: { vi: 'Body (JSON)', en: 'Body (JSON)' },
  in: 'body',
  type: 'json',
  required,
  placeholder: '{ "create_time_ge": 1757350800 }',
  help: {
    vi: 'Dán object JSON theo tài liệu TikTok Shop; được gửi và ký nguyên như vậy.',
    en: 'Paste the JSON object from the TikTok Shop docs; it is sent and signed as is.',
  },
})

/** `/order/202309/orders/{order_id}/price_detail` → `order-202309-orders-order-id-price-detail`. */
const idFromPath = (method: Method, path: string) =>
  `${method === 'GET' ? '' : `${method.toLowerCase()}-`}${path.replace(/^\//, '').replace(/[{}]/g, '').replace(/[/_]/g, '-')}`

function toEndpoint(group: string, [path, method, vi, en, paged]: Row): EndpointSpec {
  const pathParams: ParamSpec[] = [...path.matchAll(/\{(\w+)\}/g)].map(([, key]) => ({
    key,
    label: { vi: key, en: key },
    in: 'path',
    type: 'string',
    required: true,
  }))
  const reads = method === 'GET' || READ_SEGMENTS.test(path)
  return {
    id: idFromPath(method, path),
    group,
    name: { vi, en },
    method,
    path,
    unverified: true,
    mutating: !reads,
    params: [
      ...(isUnscopedPath(path) ? [] : [shopCipher]),
      ...pathParams,
      ...(paged || READ_SEGMENTS.test(path) ? pageParams : []),
      queryParam,
      ...(method === 'GET' ? [] : [bodyParam(method !== 'DELETE' && !READ_SEGMENTS.test(path))]),
    ],
  }
}

function assertMethodMatchesPath(endpoints: EndpointSpec[]): void {
  const wrong = endpoints.filter((e) => e.method === 'GET' && WRITE_SEGMENTS.test(e.path))
  if (wrong.length > 0) {
    throw new Error(
      `TikTok Shop declared catalogue: ${wrong.map((e) => e.path).join(', ')} name a write operation but are declared GET, which would let the permission probe call them.`,
    )
  }
}

function declare(group: string, rows: readonly Row[]): EndpointSpec[] {
  const endpoints = rows.map((row) => toEndpoint(group, row))
  assertMethodMatchesPath(endpoints)
  return endpoints
}

const authorization = declare('Authorization', [
  ['/authorization/202405/category_assets', 'GET', 'Ngành hàng được uỷ quyền', 'Authorized category assets'],
  ['/seller/202309/shops', 'GET', 'Các shop đang hoạt động của seller', 'Active shops of the seller'],
  ['/seller/202309/permissions', 'GET', 'Quyền của seller', 'Seller permissions'],
])

const order = declare('Order', [
  ['/order/202406/orders/external_orders', 'POST', 'Gắn mã đơn ngoài vào đơn', 'Add external order references'],
  ['/order/202406/orders/external_order_search', 'POST', 'Tìm đơn theo mã đơn ngoài', 'Search orders by external reference'],
  ['/order/202406/orders/{order_id}/external_orders', 'GET', 'Mã đơn ngoài của một đơn', 'External references of an order'],
])

const product = declare('Product', [
  ['/product/202309/categories/{category_id}/attributes', 'GET', 'Thuộc tính của ngành hàng', 'Category attributes'],
  ['/product/202309/categories/{category_id}/rules', 'GET', 'Quy tắc của ngành hàng', 'Category rules'],
  ['/product/202309/categories/recommend', 'POST', 'Gợi ý ngành hàng', 'Recommend a category'],
  ['/product/202309/brands', 'POST', 'Tạo thương hiệu riêng', 'Create a custom brand'],
  ['/product/202309/prerequisites', 'GET', 'Điều kiện đăng sản phẩm', 'Listing prerequisites'],
  ['/product/202309/products', 'POST', 'Tạo sản phẩm', 'Create a product'],
  ['/product/202309/products', 'DELETE', 'Xoá sản phẩm', 'Delete products'],
  ['/product/202309/products/{product_id}/partial_edit', 'POST', 'Sửa một phần sản phẩm', 'Partially edit a product'],
  ['/product/202309/products/{product_id}/inventory/update', 'POST', 'Cập nhật tồn kho', 'Update inventory'],
  ['/product/202309/products/{product_id}/prices/update', 'POST', 'Cập nhật giá', 'Update prices'],
  ['/product/202309/products/activate', 'POST', 'Kích hoạt sản phẩm', 'Activate products'],
  ['/product/202309/products/deactivate', 'POST', 'Tạm ẩn sản phẩm', 'Deactivate products'],
  ['/product/202309/products/recover', 'POST', 'Khôi phục sản phẩm đã xoá', 'Recover deleted products'],
  ['/product/202309/images/upload', 'POST', 'Tải ảnh sản phẩm', 'Upload a product image'],
  ['/product/202309/files/upload', 'POST', 'Tải tệp sản phẩm', 'Upload a product file'],
  ['/product/202501/compliance/manufacturers/search', 'POST', 'Tìm nhà sản xuất', 'Search manufacturers'],
  ['/product/202309/compliance/manufacturers', 'POST', 'Tạo nhà sản xuất', 'Create a manufacturer'],
  ['/product/202309/compliance/manufacturers/{manufacturer_id}/partial_edit', 'POST', 'Sửa nhà sản xuất', 'Edit a manufacturer'],
  ['/product/202501/compliance/responsible_persons/search', 'POST', 'Tìm người chịu trách nhiệm', 'Search responsible persons'],
  ['/product/202309/compliance/responsible_persons', 'POST', 'Tạo người chịu trách nhiệm', 'Create a responsible person'],
  ['/product/202309/compliance/responsible_persons/{responsible_person_id}/partial_edit', 'POST', 'Sửa người chịu trách nhiệm', 'Edit a responsible person'],
])

const globalProduct = declare('Global product', [
  ['/product/202309/global_categories', 'GET', 'Ngành hàng toàn cầu', 'Global categories'],
  ['/product/202309/global_categories/recommend', 'POST', 'Gợi ý ngành hàng toàn cầu', 'Recommend a global category'],
  ['/product/202309/categories/{category_id}/global_attributes', 'GET', 'Thuộc tính toàn cầu', 'Global attributes'],
  ['/product/202309/categories/{category_id}/global_rules', 'GET', 'Quy tắc ngành hàng toàn cầu', 'Global category rules'],
  ['/product/202309/global_products/search', 'POST', 'Tìm sản phẩm toàn cầu', 'Search global products'],
  ['/product/202309/global_products', 'POST', 'Tạo sản phẩm toàn cầu', 'Create a global product'],
  ['/product/202309/global_products', 'DELETE', 'Xoá sản phẩm toàn cầu', 'Delete global products'],
  ['/product/202309/global_products/{global_product_id}/publish', 'POST', 'Đăng sản phẩm toàn cầu ra shop', 'Publish a global product'],
  ['/product/202309/global_products/{global_product_id}/inventory/update', 'POST', 'Cập nhật tồn kho toàn cầu', 'Update global inventory'],
])

const fulfillment = declare('Fulfillment', [
  ['/fulfillment/202309/combinable_packages/search', 'GET', 'Kiện hàng có thể gộp', 'Combinable packages', 'paged'],
  ['/fulfillment/202309/packages/{package_id}/shipping_documents', 'GET', 'Chứng từ vận chuyển (vận đơn)', 'Shipping documents'],
  ['/fulfillment/202309/packages/{package_id}/handover_time_slots', 'GET', 'Khung giờ bàn giao', 'Handover time slots'],
  ['/fulfillment/202309/orders/split_attributes', 'GET', 'Thuộc tính tách đơn', 'Order split attributes'],
  ['/fulfillment/202309/orders/{order_id}/shipping_services/query', 'POST', 'Dịch vụ vận chuyển khả dụng', 'Eligible shipping services'],
  ['/fulfillment/202309/packages', 'POST', 'Tạo kiện hàng', 'Create packages'],
  ['/fulfillment/202309/packages/{package_id}/ship', 'POST', 'Giao kiện hàng', 'Ship a package'],
  ['/fulfillment/202309/packages/ship', 'POST', 'Giao nhiều kiện hàng', 'Ship packages in bulk'],
  ['/fulfillment/202309/packages/deliver', 'POST', 'Cập nhật đã giao hàng', 'Update delivery status'],
  ['/fulfillment/202309/packages/{package_id}/shipping_info/update', 'POST', 'Cập nhật vận chuyển của kiện', 'Update package shipping info'],
  ['/fulfillment/202309/orders/{order_id}/shipping_info/update', 'POST', 'Cập nhật vận chuyển của đơn', 'Update order shipping info'],
  ['/fulfillment/202309/orders/{order_id}/packages', 'POST', 'Đánh dấu đã gửi hàng', 'Mark packages as shipped'],
  ['/fulfillment/202309/orders/{order_id}/split', 'POST', 'Tách đơn', 'Split an order'],
  ['/fulfillment/202309/packages/combine', 'POST', 'Gộp kiện hàng', 'Combine packages'],
  ['/fulfillment/202309/packages/{package_id}/uncombine', 'POST', 'Bỏ gộp kiện hàng', 'Uncombine a package'],
  ['/fulfillment/202309/images/upload', 'POST', 'Tải ảnh giao hàng', 'Upload a delivery image'],
  ['/fulfillment/202309/files/upload', 'POST', 'Tải tệp giao hàng', 'Upload a delivery file'],
  ['/supply_chain/202309/packages/sync', 'POST', 'Xác nhận gửi hàng (supply chain)', 'Confirm package shipment (supply chain)'],
])

const logistics = declare('Logistics', [
  ['/logistics/202309/global_warehouses', 'GET', 'Kho toàn cầu', 'Global warehouses'],
  ['/logistics/202309/warehouses/{warehouse_id}/delivery_options', 'GET', 'Phương thức giao của kho', 'Warehouse delivery options'],
  ['/logistics/202309/delivery_options/{delivery_option_id}/shipping_providers', 'GET', 'Đơn vị vận chuyển', 'Shipping providers'],
])

const fbt = declare('Fulfilled by TikTok', [
  ['/fbt/202409/merchants/onboarded_regions', 'GET', 'Khu vực đã tham gia FBT', 'FBT onboarded regions'],
  ['/fbt/202408/warehouses', 'GET', 'Kho FBT', 'FBT warehouses'],
  ['/fbt/202409/inbound_orders', 'GET', 'Đơn nhập kho FBT (ids trong query)', 'FBT inbound orders (ids in query)'],
  ['/fbt/202408/inventory/search', 'POST', 'Tìm tồn kho FBT', 'Search FBT inventory'],
  ['/fbt/202410/inventory_records/search', 'POST', 'Lịch sử tồn kho FBT', 'Search FBT inventory records'],
  ['/fbt/202409/goods/search', 'POST', 'Tìm hàng hoá FBT', 'Search FBT goods'],
])

const finance = declare('Finance', [
])

const promotion = declare('Promotion', [
  ['/promotion/202309/activities', 'POST', 'Tạo chương trình khuyến mãi', 'Create a promotion activity'],
  ['/promotion/202309/activities/{activity_id}/products', 'PUT', 'Thêm/sửa sản phẩm khuyến mãi', 'Update activity products'],
  ['/promotion/202309/activities/{activity_id}/products', 'DELETE', 'Gỡ sản phẩm khỏi khuyến mãi', 'Remove activity products'],
  ['/promotion/202309/activities/{activity_id}/deactivate', 'POST', 'Dừng chương trình khuyến mãi', 'Deactivate an activity'],
])

const returnRefund = declare('Return & refund', [
  ['/return_refund/202309/reject_reasons', 'GET', 'Lý do từ chối', 'Reject reasons'],
  ['/return_refund/202309/refunds/calculate', 'POST', 'Tính tiền hoàn', 'Calculate a refund'],
  ['/return_refund/202309/cancellations', 'POST', 'Huỷ đơn (seller)', 'Cancel an order'],
  ['/return_refund/202309/cancellations/{cancel_id}/approve', 'POST', 'Chấp nhận yêu cầu huỷ', 'Approve a cancellation'],
  ['/return_refund/202309/cancellations/{cancel_id}/reject', 'POST', 'Từ chối yêu cầu huỷ', 'Reject a cancellation'],
  ['/return_refund/202309/returns', 'POST', 'Tạo yêu cầu trả hàng', 'Create a return'],
  ['/return_refund/202309/returns/{return_id}/approve', 'POST', 'Chấp nhận trả hàng', 'Approve a return'],
  ['/return_refund/202309/returns/{return_id}/reject', 'POST', 'Từ chối trả hàng', 'Reject a return'],
])

const analytics = declare('Analytics', [
  ['/analytics/202509/shop_skus/{sku_id}/performance', 'GET', 'Hiệu quả một SKU', 'One SKU’s performance'],
  ['/analytics/202509/shop_videos/{video_id}/products/performance', 'GET', 'Hiệu quả sản phẩm trong một video', 'Product performance within a video', 'paged'],
  // Both bestselling lists need `date` (at most the day before yesterday) and `time_slot` in the query.
  ['/analytics/202511/videos/bestselling', 'GET', 'Video bán chạy', 'Bestselling videos', 'paged'],
  ['/analytics/202511/products/bestselling', 'GET', 'Sản phẩm bán chạy', 'Bestselling products', 'paged'],
])

const affiliateSeller = declare('Affiliate (seller)', [
  ['/affiliate_seller/202406/marketplace_creators/search', 'POST', 'Tìm creator trên marketplace', 'Search marketplace creators'],
  ['/affiliate_seller/202405/open_collaborations/products/search', 'POST', 'Sản phẩm trong hợp tác mở', 'Open collaboration products'],
  ['/affiliate_seller/202409/open_collaborations/search', 'POST', 'Tìm hợp tác mở', 'Search open collaborations'],
  ['/affiliate_seller/202409/target_collaborations/search', 'POST', 'Tìm hợp tác mục tiêu', 'Search target collaborations'],
  ['/affiliate_seller/202409/open_collaboration_settings', 'GET', 'Cài đặt hợp tác mở', 'Open collaboration settings'],
  ['/affiliate_seller/202410/open_collaborations/sample_rules', 'GET', 'Quy tắc gửi mẫu', 'Sample rules'],
  ['/affiliate_seller/202409/sample_applications/search', 'POST', 'Tìm yêu cầu nhận mẫu', 'Search sample applications'],
  ['/affiliate_seller/202409/sample_applications/{application_id}/fulfillments/search', 'POST', 'Tình trạng gửi mẫu', 'Sample fulfilments'],
  ['/affiliate_seller/202412/conversations', 'GET', 'Hội thoại với creator', 'Creator conversations', 'paged'],
  ['/affiliate_seller/202412/conversation/{conversation_id}/messages', 'GET', 'Tin nhắn trong hội thoại', 'Messages in a conversation', 'paged'],
  ['/affiliate_seller/202412/conversations/messages/list/newest', 'GET', 'Tin nhắn chưa đọc mới nhất', 'Latest unread messages'],
  ['/affiliate_seller/202405/open_collaboration_settings', 'POST', 'Sửa cài đặt hợp tác mở', 'Edit open collaboration settings'],
  ['/affiliate_seller/202405/open_collaborations', 'POST', 'Tạo hợp tác mở', 'Create an open collaboration'],
  ['/affiliate_seller/202405/target_collaborations', 'POST', 'Tạo hợp tác mục tiêu', 'Create a target collaboration'],
  ['/affiliate_seller/202405/open_collaborations/{open_collaboration_id}/remove_creator', 'POST', 'Gỡ creator khỏi hợp tác', 'Remove a creator from a collaboration'],
  ['/affiliate_seller/202405/products/{product_id}/promotion_link/generate', 'POST', 'Tạo link quảng bá sản phẩm', 'Generate a product promotion link'],
  ['/affiliate_seller/202410/open_collaborations/sample_rules', 'POST', 'Sửa quy tắc gửi mẫu', 'Edit sample rules'],
  ['/affiliate_seller/202409/sample_applications/{application_id}/review', 'POST', 'Duyệt yêu cầu nhận mẫu', 'Review a sample application'],
  ['/affiliate_seller/202412/conversations', 'POST', 'Mở hội thoại với creator', 'Start a conversation with a creator'],
  ['/affiliate_seller/202412/conversations/{conversation_id}/messages', 'POST', 'Gửi tin nhắn cho creator', 'Send a message to a creator'],
  ['/affiliate_seller/202412/conversations/read', 'POST', 'Đánh dấu hội thoại đã đọc', 'Mark conversations read'],
])

const affiliateCreator = declare('Affiliate (creator app)', [
  ['/affiliate_creator/202405/profiles', 'GET', 'Hồ sơ creator', 'Creator profile'],
  ['/affiliate_creator/202405/showcases/products', 'GET', 'Sản phẩm trong showcase', 'Showcase products', 'paged'],
  ['/affiliate_creator/202509/shop_products', 'GET', 'Sản phẩm của shop (creator)', 'Shop products (creator)', 'paged'],
  ['/affiliate_creator/202405/open_collaborations/products/search', 'POST', 'Tìm sản phẩm hợp tác mở', 'Search open collaboration products'],
  ['/affiliate_creator/202405/target_collaborations/search', 'POST', 'Tìm hợp tác mục tiêu', 'Search target collaborations'],
  ['/affiliate_creator/202405/orders/search', 'POST', 'Đơn affiliate của creator', 'Creator affiliate orders'],
  ['/affiliate_creator/202405/showcases/products/add', 'POST', 'Thêm sản phẩm vào showcase', 'Add showcase products'],
])

const affiliatePartner = declare('Affiliate (partner app)', [
  ['/affiliate_partner/202405/campaigns', 'GET', 'Chiến dịch của partner', 'Partner campaigns', 'paged'],
  ['/affiliate_partner/202405/campaigns/{campaign_id}/products', 'GET', 'Sản phẩm trong chiến dịch', 'Campaign products', 'paged'],
  ['/affiliate_partner/202405/campaigns', 'POST', 'Tạo chiến dịch partner', 'Create a partner campaign'],
  ['/affiliate_partner/202405/campaigns/{campaign_id}/partial_edit', 'POST', 'Sửa chiến dịch partner', 'Edit a partner campaign'],
  ['/affiliate_partner/202405/campaigns/{campaign_id}/publish', 'POST', 'Đăng chiến dịch partner', 'Publish a partner campaign'],
  ['/affiliate_partner/202405/campaigns/{campaign_id}/products/{product_id}/review', 'POST', 'Duyệt sản phẩm vào chiến dịch', 'Review a campaign product'],
  ['/affiliate_partner/202405/campaigns/{campaign_id}/products/{product_id}/promotion_link/generate', 'POST', 'Tạo link quảng bá trong chiến dịch', 'Generate a campaign promotion link'],
])

const customerService = declare('Customer service', [
  ['/customer_service/202309/conversations', 'GET', 'Hội thoại với khách', 'Buyer conversations', 'paged'],
  ['/customer_service/202309/conversations/{conversation_id}/messages', 'GET', 'Tin nhắn với khách', 'Buyer messages', 'paged'],
  ['/customer_service/202309/agents/settings', 'GET', 'Cài đặt nhân viên CSKH', 'Agent settings'],
  ['/customer_service/202309/agents/settings', 'PUT', 'Sửa cài đặt nhân viên CSKH', 'Update agent settings'],
  ['/customer_service/202309/conversations', 'POST', 'Mở hội thoại với khách', 'Start a buyer conversation'],
  ['/customer_service/202309/conversations/{conversation_id}/messages', 'POST', 'Gửi tin nhắn cho khách', 'Send a buyer message'],
  ['/customer_service/202309/conversations/{conversation_id}/messages/read', 'POST', 'Đánh dấu tin nhắn đã đọc', 'Mark messages read'],
  ['/customer_service/202309/images/upload', 'POST', 'Tải ảnh tin nhắn', 'Upload a message image'],
])

const event = declare('Webhook', [
  ['/event/202309/webhooks', 'GET', 'Webhook của shop', 'Shop webhooks'],
  ['/event/202309/webhooks', 'PUT', 'Đặt webhook', 'Update a webhook'],
  ['/event/202309/webhooks', 'DELETE', 'Xoá webhook', 'Delete a webhook'],
])

export const tiktokShopDeclaredEndpoints: EndpointSpec[] = [
  ...authorization,
  ...order,
  ...product,
  ...globalProduct,
  ...fulfillment,
  ...logistics,
  ...fbt,
  ...finance,
  ...promotion,
  ...returnRefund,
  ...analytics,
  ...affiliateSeller,
  ...affiliateCreator,
  ...affiliatePartner,
  ...customerService,
  ...event,
]
