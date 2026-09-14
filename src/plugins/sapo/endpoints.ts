import type { EndpointSpec, PaginationSpec, ParamSpec } from '@/core/plugins/types'

/**
 * Sapo Open API catalogue (read-only).
 *
 * Sapo follows the Shopify-style admin API: `/admin/<resource>.json`, a
 * `page` + `limit` pager, and a sibling `/count.json` for totals. Responses
 * wrap the collection in a key named after the resource, which is what each
 * `resultPath` points at.
 */

const pager: ParamSpec[] = [
  { key: 'page', label: { vi: 'Trang', en: 'Page' }, in: 'query', type: 'number', defaultValue: 1 },
  {
    key: 'limit',
    label: { vi: 'Số dòng/trang', en: 'Limit' },
    in: 'query',
    type: 'number',
    defaultValue: 50,
    help: { vi: 'Tối đa 250.', en: 'Maximum 250.' },
  },
]

const dateRange = (prefix: 'created_on' | 'modified_on'): ParamSpec[] => [
  {
    key: `${prefix}_min`,
    label: { vi: 'Từ ngày', en: 'From date' },
    in: 'query',
    type: 'date',
    placeholder: 'YYYY-MM-DD',
  },
  {
    key: `${prefix}_max`,
    label: { vi: 'Đến ngày', en: 'To date' },
    in: 'query',
    type: 'date',
    placeholder: 'YYYY-MM-DD',
  },
]

const pageContract: PaginationSpec = {
  style: 'page',
  pageParam: 'page',
  sizeParam: 'limit',
  defaultPageSize: 50,
  maxPageSize: 250,
}

export const pathId = (key: string, vi: string, en: string): ParamSpec => ({
  key,
  label: { vi, en },
  in: 'path',
  type: 'string',
  required: true,
})

export const orderIdParam = pathId('order_id', 'Order ID', 'Order ID')
export const productIdParam = pathId('product_id', 'Product ID', 'Product ID')
export const customerIdParam = pathId('customer_id', 'Customer ID', 'Customer ID')
export const blogIdParam = pathId('blog_id', 'Blog ID', 'Blog ID')

/** A `/count.json` sibling, which answers `{ "count": n }`. */
function countOf(
  id: string,
  group: string,
  vi: string,
  en: string,
  path: string,
  params: ParamSpec[] = [],
): EndpointSpec {
  return { id, group, name: { vi, en }, method: 'GET', path, params }
}

export const sapoEndpoints: EndpointSpec[] = [
  {
    id: 'shop',
    group: 'Store',
    name: { vi: 'Thông tin cửa hàng', en: 'Store info' },
    description: {
      vi: 'Endpoint nhẹ nhất, dùng để kiểm tra kết nối. Sapo đặt ở /admin/store.json — không có /admin/shop.json.',
      en: 'The lightest endpoint; used to verify the connection. Sapo serves it at /admin/store.json — there is no /admin/shop.json.',
    },
    method: 'GET',
    path: '/admin/store.json',
    resultPath: 'store',
    params: [],
  },
  {
    id: 'orders',
    group: 'Order',
    name: { vi: 'Danh sách đơn hàng', en: 'List orders' },
    method: 'GET',
    path: '/admin/orders.json',
    resultPath: 'orders',
    idField: 'id',
    pagination: { style: 'page', pageParam: 'page', sizeParam: 'limit', defaultPageSize: 50, maxPageSize: 250 },
    params: [
      ...pager,
      ...dateRange('created_on'),
      {
        key: 'customer_id',
        label: { vi: 'Customer ID', en: 'Customer ID' },
        in: 'query',
        type: 'string',
        help: { vi: 'Chỉ lấy đơn của một khách hàng.', en: 'Only this customer\'s orders.' },
      },
      /*
       * No default, and no "any": this store answers status=any (and =all)
       * with zero orders, so the old default made the list look empty.
       * Leaving it blank already returns every status.
       */
      {
        key: 'status',
        label: { vi: 'Trạng thái đơn', en: 'Order status' },
        in: 'query',
        type: 'enum',
        options: [
          { value: 'open', label: 'open' },
          { value: 'closed', label: 'closed' },
          { value: 'cancelled', label: 'cancelled' },
        ],
        help: {
          vi: 'Để trống: mọi trạng thái. cancelled cần kèm khoảng ngày (không có ngày Sapo trả lỗi 500).',
          en: 'Empty: every status. cancelled needs a date range (without one Sapo answers 500).',
        },
      },
      {
        key: 'financial_status',
        label: { vi: 'Trạng thái thanh toán', en: 'Financial status' },
        in: 'query',
        type: 'enum',
        options: [
          { value: 'pending', label: 'pending' },
          { value: 'paid', label: 'paid' },
          { value: 'partially_paid', label: 'partially_paid' },
          { value: 'refunded', label: 'refunded' },
          { value: 'voided', label: 'voided' },
        ],
      },
      {
        key: 'fulfillment_status',
        label: { vi: 'Trạng thái giao hàng', en: 'Fulfillment status' },
        in: 'query',
        type: 'enum',
        options: [
          { value: 'shipped', label: 'shipped' },
          { value: 'partial', label: 'partial' },
          { value: 'unshipped', label: 'unshipped' },
        ],
      },
    ],
  },
  {
    id: 'orders-count',
    group: 'Order',
    name: { vi: 'Đếm đơn hàng', en: 'Count orders' },
    method: 'GET',
    path: '/admin/orders/count.json',
    resultPath: undefined,
    params: [...dateRange('created_on')],
  },
  {
    id: 'order-detail',
    group: 'Order',
    name: { vi: 'Chi tiết đơn hàng', en: 'Order detail' },
    method: 'GET',
    path: '/admin/orders/{id}.json',
    resultPath: 'order',
    params: [
      { key: 'id', label: { vi: 'Order ID', en: 'Order ID' }, in: 'path', type: 'string', required: true },
    ],
  },
  {
    id: 'products',
    group: 'Product',
    name: { vi: 'Danh sách sản phẩm', en: 'List products' },
    method: 'GET',
    path: '/admin/products.json',
    resultPath: 'products',
    idField: 'id',
    pagination: { style: 'page', pageParam: 'page', sizeParam: 'limit', defaultPageSize: 50, maxPageSize: 250 },
    params: [
      ...pager,
      ...dateRange('created_on'),
      { key: 'vendor', label: { vi: 'Nhà cung cấp', en: 'Vendor' }, in: 'query', type: 'string' },
      {
        key: 'published_status',
        label: { vi: 'Trạng thái đăng bán', en: 'Published status' },
        in: 'query',
        type: 'enum',
        options: [
          { value: 'published', label: 'published' },
          { value: 'unpublished', label: 'unpublished' },
          { value: 'any', label: 'any' },
        ],
      },
    ],
  },
  {
    id: 'products-count',
    group: 'Product',
    name: { vi: 'Đếm sản phẩm', en: 'Count products' },
    method: 'GET',
    path: '/admin/products/count.json',
    params: [],
  },
  {
    id: 'variants',
    group: 'Product',
    name: { vi: 'Danh sách phiên bản sản phẩm', en: 'List variants' },
    method: 'GET',
    path: '/admin/variants.json',
    resultPath: 'variants',
    idField: 'id',
    pagination: { style: 'page', pageParam: 'page', sizeParam: 'limit', defaultPageSize: 50, maxPageSize: 250 },
    params: [...pager],
  },
  {
    id: 'customers',
    group: 'Customer',
    name: { vi: 'Danh sách khách hàng', en: 'List customers' },
    method: 'GET',
    path: '/admin/customers.json',
    resultPath: 'customers',
    idField: 'id',
    pagination: { style: 'page', pageParam: 'page', sizeParam: 'limit', defaultPageSize: 50, maxPageSize: 250 },
    params: [...pager, ...dateRange('created_on')],
  },
  {
    id: 'customers-count',
    group: 'Customer',
    name: { vi: 'Đếm khách hàng', en: 'Count customers' },
    method: 'GET',
    path: '/admin/customers/count.json',
    params: [],
  },
  {
    id: 'locations',
    group: 'Store',
    name: { vi: 'Danh sách chi nhánh / kho', en: 'List locations' },
    method: 'GET',
    path: '/admin/locations.json',
    resultPath: 'locations',
    idField: 'id',
    params: [],
  },
  {
    id: 'collections',
    group: 'Product',
    name: { vi: 'Nhóm sản phẩm tự chọn', en: 'Custom collections' },
    method: 'GET',
    path: '/admin/custom_collections.json',
    resultPath: 'custom_collections',
    idField: 'id',
    pagination: { style: 'page', pageParam: 'page', sizeParam: 'limit', defaultPageSize: 50, maxPageSize: 250 },
    params: [...pager],
  },

  /*
   * Everything below was confirmed against a live Sapo Web store: the path
   * answers 200, the envelope key is the one declared, and where records came
   * back each carries the `id` declared as idField. Paths that only answered
   * an empty list, or that the store's app could not reach, are declared in
   * endpoints-declared.ts instead.
   */

  /* Order */
  {
    id: 'order-events',
    group: 'Order',
    name: { vi: 'Lịch sử sự kiện của đơn', en: 'Order events' },
    method: 'GET',
    path: '/admin/orders/{order_id}/events.json',
    resultPath: 'events',
    idField: 'id',
    params: [orderIdParam],
  },
  countOf(
    'order-transactions-count',
    'Order',
    'Đếm giao dịch thanh toán của đơn',
    'Count order transactions',
    '/admin/orders/{order_id}/transactions/count.json',
    [orderIdParam],
  ),
  {
    id: 'order-fulfillments-count',
    group: 'Order',
    name: { vi: 'Đếm vận đơn của đơn', en: 'Count order fulfillments' },
    description: {
      vi: 'Khác các endpoint đếm khác, Sapo trả về { "int": n } thay vì { "count": n }.',
      en: 'Unlike the other count endpoints, Sapo answers { "int": n } rather than { "count": n }.',
    },
    method: 'GET',
    path: '/admin/orders/{order_id}/fulfillments/count.json',
    params: [orderIdParam],
  },
  {
    id: 'order-tags',
    group: 'Order',
    name: { vi: 'Tag đơn hàng', en: 'Order tags' },
    method: 'GET',
    path: '/admin/orders/tags.json',
    resultPath: 'tags',
    params: [],
  },
  {
    id: 'order-sources',
    group: 'Order',
    name: { vi: 'Nguồn đơn hàng', en: 'Order sources' },
    method: 'GET',
    path: '/admin/order_sources.json',
    resultPath: 'sources',
    idField: 'id',
    params: [],
  },

  /* Product */
  {
    id: 'product-detail',
    group: 'Product',
    name: { vi: 'Chi tiết sản phẩm', en: 'Product detail' },
    method: 'GET',
    path: '/admin/products/{id}.json',
    resultPath: 'product',
    params: [pathId('id', 'Product ID', 'Product ID')],
  },
  {
    id: 'product-variants',
    group: 'Product',
    name: { vi: 'Phiên bản của một sản phẩm', en: 'Variants of a product' },
    method: 'GET',
    path: '/admin/products/{product_id}/variants.json',
    resultPath: 'variants',
    idField: 'id',
    params: [productIdParam],
  },
  countOf(
    'product-variants-count',
    'Product',
    'Đếm phiên bản của sản phẩm',
    'Count variants of a product',
    '/admin/products/{product_id}/variants/count.json',
    [productIdParam],
  ),
  countOf(
    'product-images-count',
    'Product',
    'Đếm ảnh sản phẩm',
    'Count product images',
    '/admin/products/{product_id}/images/count.json',
    [productIdParam],
  ),
  countOf(
    'product-metafields-count',
    'Product',
    'Đếm metafield của sản phẩm',
    'Count product metafields',
    '/admin/products/{product_id}/metafields/count.json',
    [productIdParam],
  ),
  {
    id: 'product-events',
    group: 'Product',
    name: { vi: 'Lịch sử sự kiện của sản phẩm', en: 'Product events' },
    method: 'GET',
    path: '/admin/products/{product_id}/events.json',
    resultPath: 'events',
    idField: 'id',
    params: [productIdParam],
  },
  {
    id: 'variant-detail',
    group: 'Product',
    name: { vi: 'Chi tiết phiên bản', en: 'Variant detail' },
    method: 'GET',
    path: '/admin/variants/{id}.json',
    resultPath: 'variant',
    params: [pathId('id', 'Variant ID', 'Variant ID')],
  },
  countOf('collections-count', 'Product', 'Đếm nhóm sản phẩm tự chọn', 'Count custom collections', '/admin/custom_collections/count.json'),
  countOf('smart-collections-count', 'Product', 'Đếm nhóm sản phẩm tự động', 'Count smart collections', '/admin/smart_collections/count.json'),
  countOf('collects-count', 'Product', 'Đếm liên kết sản phẩm – nhóm', 'Count collects', '/admin/collects/count.json'),

  /* Customer */
  {
    id: 'customer-detail',
    group: 'Customer',
    name: { vi: 'Chi tiết khách hàng', en: 'Customer detail' },
    method: 'GET',
    path: '/admin/customers/{id}.json',
    resultPath: 'customer',
    params: [pathId('id', 'Customer ID', 'Customer ID')],
  },
  {
    id: 'customer-addresses',
    group: 'Customer',
    name: { vi: 'Địa chỉ của khách hàng', en: 'Customer addresses' },
    method: 'GET',
    path: '/admin/customers/{customer_id}/addresses.json',
    resultPath: 'addresses',
    idField: 'id',
    params: [customerIdParam],
  },
  {
    id: 'customer-tags',
    group: 'Customer',
    name: { vi: 'Tag khách hàng', en: 'Customer tags' },
    method: 'GET',
    path: '/admin/customers/tags.json',
    resultPath: 'tags',
    params: [],
  },

  /* Content */
  {
    id: 'blogs',
    group: 'Content',
    name: { vi: 'Danh sách blog', en: 'List blogs' },
    method: 'GET',
    path: '/admin/blogs.json',
    resultPath: 'blogs',
    idField: 'id',
    pagination: pageContract,
    params: [...pager],
  },
  countOf('blogs-count', 'Content', 'Đếm blog', 'Count blogs', '/admin/blogs/count.json'),
  {
    id: 'blog-detail',
    group: 'Content',
    name: { vi: 'Chi tiết blog', en: 'Blog detail' },
    method: 'GET',
    path: '/admin/blogs/{id}.json',
    resultPath: 'blog',
    params: [pathId('id', 'Blog ID', 'Blog ID')],
  },
  {
    id: 'blog-articles',
    group: 'Content',
    name: { vi: 'Bài viết của blog', en: 'Blog articles' },
    method: 'GET',
    path: '/admin/blogs/{blog_id}/articles.json',
    resultPath: 'articles',
    idField: 'id',
    pagination: pageContract,
    params: [blogIdParam, ...pager],
  },
  countOf('blog-articles-count', 'Content', 'Đếm bài viết của blog', 'Count blog articles', '/admin/blogs/{blog_id}/articles/count.json', [blogIdParam]),
  {
    id: 'article-authors',
    group: 'Content',
    name: { vi: 'Tác giả bài viết', en: 'Article authors' },
    method: 'GET',
    path: '/admin/articles/authors.json',
    resultPath: 'authors',
    params: [],
  },
  {
    id: 'pages',
    group: 'Content',
    name: { vi: 'Trang nội dung', en: 'List pages' },
    method: 'GET',
    path: '/admin/pages.json',
    resultPath: 'pages',
    idField: 'id',
    pagination: pageContract,
    params: [...pager],
  },
  countOf('pages-count', 'Content', 'Đếm trang nội dung', 'Count pages', '/admin/pages/count.json'),
  countOf('comments-count', 'Content', 'Đếm bình luận', 'Count comments', '/admin/comments/count.json'),
  countOf('redirects-count', 'Content', 'Đếm chuyển hướng URL', 'Count redirects', '/admin/redirects/count.json'),

  /* Store */
  {
    id: 'countries',
    group: 'Store',
    name: { vi: 'Quốc gia', en: 'Countries' },
    method: 'GET',
    path: '/admin/countries.json',
    resultPath: 'countries',
    idField: 'id',
    params: [],
  },
  {
    id: 'country-detail',
    group: 'Store',
    name: { vi: 'Chi tiết quốc gia', en: 'Country detail' },
    method: 'GET',
    path: '/admin/countries/{id}.json',
    resultPath: 'country',
    params: [pathId('id', 'Country ID', 'Country ID')],
  },
  {
    id: 'policies',
    group: 'Store',
    name: { vi: 'Chính sách cửa hàng', en: 'Store policies' },
    method: 'GET',
    path: '/admin/policies.json',
    resultPath: 'policies',
    params: [],
  },
  {
    id: 'payment-methods',
    group: 'Store',
    name: { vi: 'Phương thức thanh toán', en: 'Payment methods' },
    method: 'GET',
    path: '/admin/payment_methods.json',
    resultPath: 'payment_methods',
    idField: 'id',
    params: [],
  },
  {
    id: 'users',
    group: 'Store',
    name: { vi: 'Tài khoản nhân viên', en: 'Staff accounts' },
    method: 'GET',
    path: '/admin/users.json',
    resultPath: 'users',
    idField: 'id',
    params: [],
  },

  /* App */
  countOf('script-tags-count', 'App', 'Đếm script tag', 'Count script tags', '/admin/script_tags/count.json'),
  countOf('webhooks-count', 'App', 'Đếm webhook', 'Count webhooks', '/admin/webhooks/count.json'),
  countOf('metafields-count', 'App', 'Đếm metafield', 'Count metafields', '/admin/metafields/count.json'),
]
